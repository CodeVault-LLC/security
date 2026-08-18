import { PgBoss } from "pg-boss";

import {
  JOB_QUEUES,
  type JobPayloadMap,
} from "@codevault/server/services/jobs";

import type { WorkerContext } from "./context.js";
import { verifyArtifactIntegrity } from "./jobs/artifact-integrity.js";
import { generateArtifactPreview } from "./jobs/artifact-preview.js";
import { refreshIntelligence } from "./jobs/intelligence-refresh.js";
import { runPriorArtCheck } from "./jobs/prior-art.js";
import { generateReportPdf } from "./jobs/report-pdf.js";

/**
 * Job registration.
 *
 * Concurrency is set per queue rather than globally: a PDF render holds a
 * browser and hundreds of megabytes, while a prior-art check mostly waits on
 * other people's HTTP servers, and treating them the same would either starve
 * one or exhaust memory on the other.
 */

export interface QueueOptions {
  connectionString: string;
  schema?: string;
}

interface Handler<Name extends keyof JobPayloadMap> {
  queue: Name;
  concurrency: number;
  /** Seconds before a stalled job is considered failed and retried. */
  expireInSeconds: number;
  run(context: WorkerContext, data: JobPayloadMap[Name]): Promise<void>;
}

const HANDLERS = [
  {
    queue: JOB_QUEUES.priorArt,
    concurrency: 3,
    expireInSeconds: 300,
    run: runPriorArtCheck,
  } satisfies Handler<"prior-art-check">,
  {
    queue: JOB_QUEUES.artifactIntegrity,
    concurrency: 2,
    expireInSeconds: 3_600,
    run: verifyArtifactIntegrity,
  } satisfies Handler<"artifact-integrity">,
  {
    queue: JOB_QUEUES.artifactPreview,
    concurrency: 4,
    expireInSeconds: 300,
    run: generateArtifactPreview,
  } satisfies Handler<"artifact-preview">,
  {
    queue: JOB_QUEUES.reportPdf,
    // One at a time: each render launches Chromium.
    concurrency: 1,
    expireInSeconds: 900,
    run: generateReportPdf,
  } satisfies Handler<"report-pdf">,
  {
    queue: JOB_QUEUES.intelligenceRefresh,
    concurrency: 2,
    expireInSeconds: 300,
    run: refreshIntelligence,
  } satisfies Handler<"intelligence-refresh">,
];

export interface RunningQueue {
  stop(): Promise<void>;
}

export async function startQueue(
  context: WorkerContext,
  options: QueueOptions,
): Promise<RunningQueue> {
  const boss = new PgBoss({
    connectionString: options.connectionString,
    schema: options.schema ?? "codevault_jobs",
  });

  boss.on("error", (error: Error) => {
    context.log(`queue error: ${error.message}`);
  });

  await boss.start();

  for (const handler of HANDLERS) {
    await boss.createQueue(handler.queue);

    await boss.work(
      handler.queue,
      {
        batchSize: 1,
        pollingIntervalSeconds: 2,
      },
      async (jobs) => {
        for (const job of jobs) {
          const data = job.data as JobPayloadMap[typeof handler.queue];

          context.log(`${handler.queue} started (${job.id})`);

          // A throw marks the job failed and lets pg-boss retry it with the
          // backoff configured where the job was sent.
          await handler.run(context, data as never);

          context.log(`${handler.queue} finished (${job.id})`);
        }
      },
    );
  }

  context.log(`listening on ${HANDLERS.length} queues`);

  return {
    async stop() {
      await boss.stop({ graceful: true });
    },
  };
}
