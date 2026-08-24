import { open, rm } from "node:fs/promises";

import { hashSelection } from "./file-uploads.js";

/** Downloads an artifact to a new file and removes it unless its digest matches. */
export async function downloadVerifiedFile(
  url: string,
  destination: string,
  expectedSha256: string,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  try {
    await downloadFile(url, destination, fetchImpl);

    const downloaded = await hashSelection(destination);
    if (downloaded.sha256 !== expectedSha256) {
      throw new Error("Downloaded report failed verification.");
    }
  } catch (error: unknown) {
    await rm(destination, { force: true });
    throw error;
  }
}

export async function downloadFile(
  url: string,
  destination: string,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const response = await fetchImpl(url);
  if (!response.ok || response.body === null) {
    throw new Error(
      `Object storage rejected the download (${response.status}).`,
    );
  }

  const handle = await open(destination, "wx", 0o600);
  const reader = response.body.getReader();
  try {
    let position = 0;
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      await handle.write(next.value, 0, next.value.byteLength, position);
      position += next.value.byteLength;
    }
  } finally {
    reader.releaseLock();
    await handle.close();
  }
}
