import { createDatabase } from "@codevault/db";
import { resolveSecretSettings } from "@codevault/core/configuration";

import { runOneMediaJob, MediaProcessingTimeout } from "./claim-job.js";
import { assertPatchedVips } from "./sanitize-image.js";
import { createMediaStorage } from "./storage.js";

const environment = resolveSecretSettings(process.env, [
  "MEDIA_DATABASE_URL",
  "MEDIA_S3_ACCESS_KEY_ID",
  "MEDIA_S3_SECRET_ACCESS_KEY",
]);

function required(name: string): string {
  const value = environment[name];
  if (!value)
    throw new Error(`Required media-worker setting ${name} is missing.`);
  return value;
}

export function assertMediaCredentialPosture(
  candidate: Record<string, string | undefined>,
): void {
  if (candidate.NODE_ENV !== "production") return;

  const databasePassword = new URL(
    candidate.MEDIA_DATABASE_URL ?? "postgres://missing",
  ).password;
  const knownDevelopmentValues = new Set([
    "codevault_media_dev_password",
    "change-me",
    "replace-me",
  ]);
  if (
    knownDevelopmentValues.has(databasePassword) ||
    knownDevelopmentValues.has(candidate.MEDIA_S3_SECRET_ACCESS_KEY ?? "") ||
    candidate.MEDIA_S3_ACCESS_KEY_ID === "codevault-media"
  ) {
    throw new Error(
      "Production media-worker configuration contains a known development credential.",
    );
  }
}

async function main(): Promise<void> {
  assertMediaCredentialPosture(environment);
  assertPatchedVips();
  const dbHandle = createDatabase({
    connectionString: required("MEDIA_DATABASE_URL"),
    maxConnections: 1,
    ssl: environment.DATABASE_SSL === "true",
  });
  const storage = createMediaStorage({
    endpoint: required("S3_ENDPOINT"),
    region: environment.S3_REGION ?? "us-east-1",
    bucket: required("S3_BUCKET"),
    accessKeyId: required("MEDIA_S3_ACCESS_KEY_ID"),
    secretAccessKey: required("MEDIA_S3_SECRET_ACCESS_KEY"),
    forcePathStyle: environment.S3_FORCE_PATH_STYLE !== "false",
  });
  let stopping = false;
  let decoderTimedOut = false;
  process.on("SIGTERM", () => {
    stopping = true;
  });
  process.on("SIGINT", () => {
    stopping = true;
  });

  try {
    while (!stopping) {
      const processed = await runOneMediaJob(dbHandle.db, storage);
      if (!processed)
        await new Promise((resolve) => setTimeout(resolve, 1_000));
    }
  } catch (error) {
    if (error instanceof MediaProcessingTimeout) {
      // Native decoders cannot be safely cancelled in-process. The container
      // supervisor starts a clean process after a deadline breach.
      decoderTimedOut = true;
    } else {
      throw error;
    }
  } finally {
    await dbHandle.close();
  }
  if (decoderTimedOut) process.exit(70);
}

if (import.meta.main) await main();
