import { PgBoss } from "pg-boss";

export interface JobTransactionDatabase {
  executeSql(text: string, values?: unknown[]): Promise<{ rows: unknown[] }>;
}

/**
 * Background job queue.
 *
 * pg-boss keeps jobs in the same PostgreSQL instance as the data they operate
 * on, which is why CodeVault needs no message broker: a queue that is a table
 * gets transactions, backups and point-in-time recovery for free.
 */

export const JOB_QUEUES = {
  priorArt: "prior-art-check",
  reportPdf: "report-pdf",
  artifactPreview: "artifact-preview",
  intelligenceRefresh: "intelligence-refresh",
  artifactDelete: "artifact-delete",
  gmailSend: "gmail-send",
} as const;

export type JobQueueName = (typeof JOB_QUEUES)[keyof typeof JOB_QUEUES];

export interface PriorArtJobData {
  checkId: string;
  findingId: string;
  caseId: string;
  keywords: string[];
  skipAiSynthesis: boolean;
}

export interface ReportPdfJobData {
  exportId: string;
  reportId: string;
  caseId: string;
  requestedBy: string;
}

export interface ArtifactPreviewJobData {
  artifactId: string;
  caseId: string;
}

export interface IntelligenceRefreshJobData {
  findingId: string;
  cveIds: string[];
}

export interface ArtifactDeleteJobData {
  artifactId: string;
  objectKey: string;
  previewObjectKey: string | null;
}

export interface GmailSendJobData {
  deliveryId: string;
}

export interface JobPayloadMap {
  "prior-art-check": PriorArtJobData;
  "report-pdf": ReportPdfJobData;
  "artifact-preview": ArtifactPreviewJobData;
  "intelligence-refresh": IntelligenceRefreshJobData;
  "artifact-delete": ArtifactDeleteJobData;
  "gmail-send": GmailSendJobData;
}

export interface JobQueue {
  start(): Promise<void>;
  stop(): Promise<void>;
  send<Name extends JobQueueName>(
    queue: Name,
    data: JobPayloadMap[Name],
    options?: { db?: JobTransactionDatabase; singletonKey?: string },
  ): Promise<string | null>;
  instance(): PgBoss;
}

export interface JobQueueOptions {
  connectionString: string;
  /** Its own schema keeps queue tables out of the application namespace. */
  schema?: string;
}

export function createJobQueue(options: JobQueueOptions): JobQueue {
  const boss = new PgBoss({
    connectionString: options.connectionString,
    schema: options.schema ?? "codevault_jobs",
  });

  let started = false;

  return {
    async start() {
      if (started) {
        return;
      }

      await boss.start();

      for (const queue of Object.values(JOB_QUEUES)) {
        await boss.createQueue(queue);
      }

      started = true;
    },

    async stop() {
      if (!started) {
        return;
      }

      await boss.stop({ graceful: true });
      started = false;
    },

    async send(queue, data, sendOptions) {
      return boss.send(queue, data, {
        // Gmail delivery owns its ambiguity state machine. A generic queue
        // retry could duplicate an email after a network timeout.
        retryLimit: queue === JOB_QUEUES.gmailSend ? 0 : 3,
        retryDelay: 30,
        retryBackoff: true,
        ...(sendOptions?.db === undefined ? {} : { db: sendOptions.db }),
        ...(sendOptions?.singletonKey === undefined
          ? {}
          : { singletonKey: sendOptions.singletonKey }),
      });
    },

    instance() {
      return boss;
    },
  };
}
