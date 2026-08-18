import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open } from "node:fs/promises";
import { basename } from "node:path";

import type { BrowserWindow } from "electron";
import { dialog } from "electron";

import type { AvatarUpload } from "@codevault/contracts";

import type { ApiClient } from "./api-client.js";
import type { SessionStore } from "./session-store.js";

const MAX_AVATAR_BYTES = 5 * 1024 * 1024;

export type AvatarTarget = "USER" | "ORGANIZATION";

export async function selectAndUploadAvatar(options: {
  window: BrowserWindow;
  target: AvatarTarget;
  apiClient: ApiClient;
  sessionStore: SessionStore;
}): Promise<AvatarUpload | null> {
  const selection = await dialog.showOpenDialog(options.window, {
    title:
      options.target === "USER"
        ? "Choose your avatar"
        : "Choose organization avatar",
    properties: ["openFile", "dontAddToRecent"],
    filters: [{ name: "JPEG or PNG", extensions: ["jpg", "jpeg", "png"] }],
  });
  const path = selection.filePaths[0];
  if (selection.canceled || !path) return null;

  const before = await lstat(path);
  if (
    !before.isFile() ||
    before.isSymbolicLink() ||
    before.size < 1 ||
    before.size > MAX_AVATAR_BYTES
  ) {
    throw new Error("Choose a regular JPEG or PNG file no larger than 5 MiB.");
  }
  // Windows does not implement O_NOFOLLOW. The pre/post lstat and opened-file
  // identity checks retain the same TOCTOU protection there.
  const noFollowFlag = process.platform === "win32" ? 0 : constants.O_NOFOLLOW;
  const handle = await open(path, constants.O_RDONLY | noFollowFlag);
  let bytes: Buffer;
  try {
    const opened = await handle.stat();
    if (
      opened.dev !== before.dev ||
      opened.ino !== before.ino ||
      opened.size !== before.size
    ) {
      throw new Error("The selected file changed before it could be opened.");
    }
    bytes = await handle.readFile();
    const after = await handle.stat();
    if (
      after.dev !== before.dev ||
      after.ino !== before.ino ||
      after.size !== bytes.byteLength
    ) {
      throw new Error("The selected file changed while it was being read.");
    }
  } finally {
    await handle.close();
  }

  const started = await options.apiClient.request<AvatarUpload>(
    "/v1/avatar-uploads",
    {
      method: "POST",
      body: {
        target: options.target,
        originalFilename: basename(path),
        declaredSizeBytes: bytes.byteLength,
        declaredSha256: createHash("sha256").update(bytes).digest("hex"),
      },
    },
  );
  const session = options.sessionStore.current();
  if (!session)
    throw new Error("The session expired before the upload started.");
  const response = await fetch(
    new URL(`/v1/avatar-uploads/${started.id}/content`, session.serverUrl),
    {
      method: "PUT",
      headers: {
        authorization: `Bearer ${session.token}`,
        "content-type": "application/octet-stream",
        "content-length": String(bytes.byteLength),
      },
      body: bytes,
    },
  );
  if (!response.ok) throw new Error("The avatar upload was rejected.");
  return (await response.json()) as AvatarUpload;
}

export async function loadAvatarDataUrl(
  sessionStore: SessionStore,
  avatarId: string,
): Promise<string> {
  const session = sessionStore.current();
  if (!session) throw new Error("Authentication is required.");
  const response = await fetch(
    new URL(`/v1/avatars/${avatarId}/content`, session.serverUrl),
    {
      headers: {
        authorization: `Bearer ${session.token}`,
        accept: "image/webp",
      },
    },
  );
  if (
    !response.ok ||
    response.headers.get("content-type")?.split(";", 1)[0] !== "image/webp"
  ) {
    throw new Error("The avatar derivative was unavailable.");
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  if (
    bytes.byteLength > 512 * 1024 ||
    bytes.toString("ascii", 0, 4) !== "RIFF" ||
    bytes.toString("ascii", 8, 12) !== "WEBP"
  ) {
    throw new Error("The avatar derivative failed local validation.");
  }
  return `data:image/webp;base64,${bytes.toString("base64")}`;
}
