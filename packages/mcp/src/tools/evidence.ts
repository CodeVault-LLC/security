import type { McpServer } from "@modelcontextprotocol/server";
import { ARTIFACT_KINDS, CONTENT_VISIBILITIES } from "@codevault/core";
import type {
  CreateEvidenceRequest,
  UpdateEvidenceRequest,
} from "@codevault/contracts";
import * as z from "zod/v4";

import type { CodeVaultClient, UploadEvidenceFileRequest } from "../client.js";
import { compact, id, list, nullableMarkdown, result } from "./shared.js";

export function registerEvidenceTools(
  server: McpServer,
  client: CodeVaultClient,
): void {
  server.registerTool(
    "codevault_list_evidence",
    {
      title: "List CodeVault evidence",
      description:
        "Find evidence by case, finding, visibility, title, or reference.",
      inputSchema: list.extend({
        caseId: id.optional(),
        findingId: id.optional(),
        visibility: z.enum(CONTENT_VISIBILITIES).optional(),
      }),
      annotations: { readOnlyHint: true },
    },
    (input) => result(() => client.listEvidence(input)),
  );

  server.registerTool(
    "codevault_create_evidence",
    {
      title: "Create an evidence record",
      description:
        "Create an evidence record and optionally attach already-uploaded artifact UUIDs.",
      inputSchema: z.object({
        caseId: id,
        findingId: id.optional(),
        title: z.string().min(1).max(200),
        descriptionMarkdown: z.string().max(200_000).optional(),
        visibility: z.enum(CONTENT_VISIBILITIES),
        capturedAt: z.iso.datetime().optional(),
        artifactIds: z.array(id).max(100).optional(),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    (input) =>
      result(() =>
        client.createEvidence(compact(input) as CreateEvidenceRequest),
      ),
  );

  server.registerTool(
    "codevault_update_evidence",
    {
      title: "Update an evidence record",
      description:
        "Update evidence metadata, finding association, or complete artifact attachment list immediately.",
      inputSchema: z.object({
        evidenceId: id,
        expectedRevision: z.number().int().min(1),
        title: z.string().min(1).max(200).optional(),
        descriptionMarkdown: nullableMarkdown.optional(),
        visibility: z.enum(CONTENT_VISIBILITIES).optional(),
        findingId: z.union([id, z.null()]).optional(),
        artifactIds: z.array(id).max(100).optional(),
      }),
      annotations: { readOnlyHint: false, destructiveHint: true },
    },
    ({ evidenceId, ...input }) =>
      result(() =>
        client.updateEvidence(
          evidenceId,
          compact(input) as UpdateEvidenceRequest,
        ),
      ),
  );

  server.registerTool(
    "codevault_upload_evidence_file",
    {
      title: "Upload and attach an evidence file",
      description:
        "Read a local file, hash it, upload it directly to CodeVault object storage, and attach it to a new or existing evidence record. If evidenceId is omitted, a new evidence record is created using evidenceTitle or the filename.",
      inputSchema: z.object({
        caseId: id,
        findingId: id.optional(),
        filePath: z.string().min(1).max(4_096),
        mimeType: z.string().min(1).max(200),
        artifactKind: z.enum(ARTIFACT_KINDS),
        visibility: z.enum(CONTENT_VISIBILITIES),
        capturedAt: z.iso.datetime().optional(),
        metadata: z.record(z.string(), z.unknown()).optional(),
        evidenceId: id.optional(),
        evidenceTitle: z.string().min(1).max(200).optional(),
        evidenceDescriptionMarkdown: z.string().max(200_000).optional(),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    (input) =>
      result(() =>
        client.uploadEvidenceFile(compact(input) as UploadEvidenceFileRequest),
      ),
  );

  server.registerTool(
    "codevault_get_artifact_download",
    {
      title: "Get an artifact download URL",
      description:
        "Create a short-lived download URL for a stored evidence artifact.",
      inputSchema: z.object({ artifactId: id }),
      annotations: { readOnlyHint: true },
    },
    ({ artifactId }) => result(() => client.getArtifactDownload(artifactId)),
  );
}
