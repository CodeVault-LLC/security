import type { McpServer } from "@modelcontextprotocol/server";
import type { CreateManualIntakeRequest } from "@codevault/contracts";
import * as z from "zod/v4";

import type { CodeVaultClient } from "../client.js";
import { compact, id, markdown, result } from "./shared.js";

const citation = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("FILE"),
    path: z.string().min(1).max(1_024),
    sha256: z.string().regex(/^[0-9a-f]{64}$/u),
    startLine: z.number().int().min(1).optional(),
    endLine: z.number().int().min(1).optional(),
  }),
  z.object({
    kind: z.literal("ARTIFACT"),
    artifactId: id,
    label: z.string().min(1).max(300),
  }),
]);

export function registerIntakeTools(
  server: McpServer,
  client: CodeVaultClient,
): void {
  server.registerTool(
    "codevault_list_intake_drafts",
    {
      title: "List finding intake drafts",
      description:
        "List pending, non-canonical finding drafts for a case before creating another draft.",
      inputSchema: z.object({ caseId: id }),
      annotations: { readOnlyHint: true },
    },
    ({ caseId }) => result(() => client.listIntakeDrafts(caseId)),
  );

  server.registerTool(
    "codevault_create_intake_draft",
    {
      title: "Create a finding intake draft",
      description:
        "Create a cited finding proposal for human review. This does not create, validate, approve, disclose, or publish a finding.",
      inputSchema: z.object({
        caseId: id,
        sourceLabel: z.string().min(1).max(200).optional(),
        title: z.string().min(8).max(200),
        summaryMarkdown: markdown.optional(),
        technicalMarkdown: markdown.optional(),
        impactMarkdown: markdown.optional(),
        remediationMarkdown: markdown.optional(),
        suggestedCweIds: z
          .array(z.string().regex(/^CWE-[1-9][0-9]*$/u))
          .max(25)
          .optional(),
        uncertainties: z
          .array(z.string().min(1).max(2_000))
          .max(100)
          .optional(),
        citations: z.array(citation).max(200).optional(),
        confidence: z.enum(["LOW", "MEDIUM", "HIGH"]).optional(),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    (input) =>
      result(() =>
        client.createIntakeDraft(
          compact({
            caseId: input.caseId,
            sourceLabel: input.sourceLabel,
            draft: compact({
              title: input.title,
              summaryMarkdown: input.summaryMarkdown,
              technicalMarkdown: input.technicalMarkdown,
              impactMarkdown: input.impactMarkdown,
              remediationMarkdown: input.remediationMarkdown,
              suggestedCweIds: input.suggestedCweIds ?? [],
              affectedVersions: [],
              uncertainties: input.uncertainties,
            }),
            citations: input.citations,
            confidence: input.confidence,
          }) as CreateManualIntakeRequest,
        ),
      ),
  );
}
