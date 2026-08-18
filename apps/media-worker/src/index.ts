import { createDatabase } from "@codevault/db";

import { runOneMediaJob, MediaProcessingTimeout } from "./claim-job.js";
import { assertPatchedVips } from "./sanitize-image.js";
import { createMediaStorage } from "./storage.js";

function required(name: string): string {
  const value = process.env[name];
  if (!value)
    throw new Error(`Required media-worker setting ${name} is missing.`);
  return value;
}

async function main(): Promise<void> {
  assertPatchedVips();
  const dbHandle = createDatabase({
    connectionString: required("MEDIA_DATABASE_URL"),
    maxConnections: 1,
    ssl: process.env.DATABASE_SSL === "true",
  });
  const storage = createMediaStorage({
    endpoint: required("S3_ENDPOINT"),
    region: process.env.S3_REGION ?? "us-east-1",
    bucket: required("S3_BUCKET"),
    accessKeyId: required("MEDIA_S3_ACCESS_KEY_ID"),
    secretAccessKey: required("MEDIA_S3_SECRET_ACCESS_KEY"),
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE !== "false",
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
