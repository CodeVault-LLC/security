import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

import { sql } from "drizzle-orm";

import type { Database } from "@codevault/db";

import {
  ImageRejectedError,
  sanitizeImage,
  type ImageRejectionCode,
} from "./sanitize-image.js";
import type { MediaStorage } from "./storage.js";

interface ClaimedJob extends Record<string, unknown> {
  job_id: string;
  target_id: string;
  input_object_key: string;
  attempt_count: number;
  observed_size_bytes: string | number;
  observed_sha256: string;
}

export class MediaProcessingTimeout extends Error {
  constructor() {
    super("The native media processing deadline was exceeded.");
    this.name = "MediaProcessingTimeout";
  }
}

function matchesDigest(actualHex: string, expectedHex: string): boolean {
  const actual = Buffer.from(actualHex, "hex");
  const expected = Buffer.from(expectedHex, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

async function failJob(
  db: Database,
  jobId: string,
  leaseToken: string,
  code: string,
  retryable: boolean,
): Promise<void> {
  await db.execute(sql`
    SELECT public.fail_media_job(
      ${jobId}::uuid, ${leaseToken}, ${code}, ${retryable}
    ) AS failed
  `);
}

async function withDeadline<T>(
  promise: Promise<T>,
  milliseconds: number,
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new MediaProcessingTimeout()),
          milliseconds,
        );
        timer.unref();
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Claims and processes at most one job through the function-only DB API. */
export async function runOneMediaJob(
  db: Database,
  storage: MediaStorage,
  workerId = `media-${process.pid}`,
): Promise<boolean> {
  const leaseToken = randomBytes(32).toString("base64url");
  const result = await db.execute<ClaimedJob>(sql`
    SELECT * FROM public.claim_media_job(${workerId}, ${leaseToken})
  `);
  const job = result.rows[0];
  if (!job) return false;

  let outputKey: string | null = null;
  try {
    const input = await storage.getObject(job.input_object_key);
    const digest = createHash("sha256").update(input).digest("hex");
    if (
      input.byteLength !== Number(job.observed_size_bytes) ||
      !matchesDigest(digest, job.observed_sha256)
    ) {
      await failJob(db, job.job_id, leaseToken, "INTEGRITY_MISMATCH", false);
      await storage.deleteObject(job.input_object_key).catch(() => undefined);
      return true;
    }

    const sanitized = await withDeadline(sanitizeImage(input), 10_000);
    // The database capability binds this deterministic key to the claimed
    // avatar. A compromised decoder cannot redirect the row to another
    // derivative, and retries safely overwrite only their own output.
    outputKey = `derivatives/avatars/${job.target_id}.webp`;
    await storage.putObject(outputKey, sanitized.bytes, "image/webp");
    const completion = await db.execute<{ completed: boolean }>(sql`
      SELECT public.complete_media_job(
        ${job.job_id}::uuid, ${leaseToken}, ${outputKey}, ${sanitized.sha256},
        ${sanitized.width}, ${sanitized.height}
      ) AS completed
    `);
    if (completion.rows[0]?.completed !== true) {
      await storage.deleteObject(outputKey).catch(() => undefined);
      throw new Error("The media lease expired before completion.");
    }
    await storage.deleteObject(job.input_object_key).catch(() => undefined);
    return true;
  } catch (error) {
    if (outputKey) await storage.deleteObject(outputKey).catch(() => undefined);
    const deterministic = error instanceof ImageRejectedError;
    const code: ImageRejectionCode | "PROCESSING_LIMIT" | "STORAGE_FAILURE" =
      deterministic
        ? error.code
        : error instanceof MediaProcessingTimeout
          ? "PROCESSING_LIMIT"
          : "STORAGE_FAILURE";
    await failJob(
      db,
      job.job_id,
      leaseToken,
      code,
      !deterministic && !(error instanceof MediaProcessingTimeout),
    ).catch(() => undefined);
    if (deterministic || error instanceof MediaProcessingTimeout) {
      await storage.deleteObject(job.input_object_key).catch(() => undefined);
    }
    if (error instanceof MediaProcessingTimeout) throw error;
    return true;
  }
}
