import type { McpServer } from "@modelcontextprotocol/server";
import {
  CLAIM_SOURCE_TYPES,
  CONFIDENCE_LEVELS,
  CONTENT_VISIBILITIES,
  DISCLOSURE_STATES,
  EXTERNAL_ID_STATES,
  PRIOR_ART_STATES,
  REMEDIATION_STATES,
  VALIDATION_STATES,
} from "@codevault/core";
import { EXTERNAL_ID_SCHEMES, SCORE_SCHEMES } from "@codevault/standards";
import type {
  AddFindingIdentifierRequest,
  AddFindingScoreRequest,
  CreateClaimRequest,
  CreateReferenceRequest,
  UpdateFindingRequest,
} from "@codevault/contracts";
import * as z from "zod/v4";

import type { CodeVaultClient } from "../client.js";
import { compact, id, markdown, nullableMarkdown, result } from "./shared.js";

export function registerFindingTools(
  server: McpServer,
  client: CodeVaultClient,
): void {
  server.registerTool(
    "codevault_update_finding",
    {
      title: "Update a CodeVault finding",
      description:
        "Update a finding's narrative, lifecycle states, visibility, CWE classifications, or title immediately.",
      inputSchema: z.object({
        findingId: id,
        expectedRevision: z.number().int().min(1),
        title: z.string().min(1).max(200).optional(),
        summaryMarkdown: nullableMarkdown.optional(),
        technicalMarkdown: nullableMarkdown.optional(),
        preconditionsMarkdown: nullableMarkdown.optional(),
        attackPathMarkdown: nullableMarkdown.optional(),
        impactMarkdown: nullableMarkdown.optional(),
        reproductionMarkdown: nullableMarkdown.optional(),
        remediationMarkdown: nullableMarkdown.optional(),
        researcherNotesMarkdown: nullableMarkdown.optional(),
        validationState: z.enum(VALIDATION_STATES).optional(),
        remediationState: z.enum(REMEDIATION_STATES).optional(),
        disclosureState: z.enum(DISCLOSURE_STATES).optional(),
        externalIdState: z.enum(EXTERNAL_ID_STATES).optional(),
        priorArtState: z.enum(PRIOR_ART_STATES).optional(),
        visibility: z.enum(CONTENT_VISIBILITIES).optional(),
        cweIds: z
          .array(z.string().regex(/^CWE-[1-9][0-9]*$/u))
          .max(25)
          .optional(),
      }),
      annotations: { readOnlyHint: false, destructiveHint: true },
    },
    ({ findingId, ...input }) =>
      result(() =>
        client.updateFinding(findingId, compact(input) as UpdateFindingRequest),
      ),
  );

  server.registerTool(
    "codevault_add_finding_score",
    {
      title: "Add a finding score",
      description:
        "Calculate and add a score from a vector, or add sourced intelligence. Set approve to true to approve it immediately; otherwise it remains proposed.",
      inputSchema: z.object({
        findingId: id,
        scheme: z.enum(SCORE_SCHEMES),
        vector: z.string().max(400).optional(),
        score: z.number().min(0).max(100).optional(),
        metrics: z.record(z.string(), z.unknown()).optional(),
        reasoningMarkdown: markdown.optional(),
        sourceName: z.string().max(200).optional(),
        approve: z.boolean().optional(),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    ({ findingId, ...input }) =>
      result(() =>
        client.addFindingScore(
          findingId,
          compact(input) as AddFindingScoreRequest,
        ),
      ),
  );

  server.registerTool(
    "codevault_approve_finding_score",
    {
      title: "Approve a finding score",
      description:
        "Approve the specified proposed score immediately as the authenticated CodeVault user.",
      inputSchema: z.object({ findingId: id, scoreId: id }),
      annotations: { readOnlyHint: false, destructiveHint: true },
    },
    ({ findingId, scoreId }) =>
      result(() => client.approveFindingScore(findingId, scoreId)),
  );

  server.registerTool(
    "codevault_add_finding_identifier",
    {
      title: "Add a finding identifier",
      description:
        "Attach a real CVE, GHSA, OSV, vendor advisory, bug tracker, vendor reference, or custom identifier to a finding.",
      inputSchema: z.object({
        findingId: id,
        scheme: z.enum(EXTERNAL_ID_SCHEMES),
        value: z.string().min(1).max(200),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    ({ findingId, ...input }) =>
      result(() =>
        client.addFindingIdentifier(
          findingId,
          input as AddFindingIdentifierRequest,
        ),
      ),
  );

  server.registerTool(
    "codevault_add_finding_claim",
    {
      title: "Add a finding claim",
      description:
        "Record a structured claim with its source, confidence, visibility, and optional machine-readable value.",
      inputSchema: z.object({
        findingId: id,
        key: z.string().min(1).max(120),
        statementMarkdown: markdown,
        value: z.unknown().optional(),
        sourceType: z.enum(CLAIM_SOURCE_TYPES),
        sourceRef: z.string().max(500).optional(),
        confidence: z.enum(CONFIDENCE_LEVELS),
        visibility: z.enum(CONTENT_VISIBILITIES),
        retrievedAt: z.iso.datetime().optional(),
        expiresAt: z.iso.datetime().optional(),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    ({ findingId, ...input }) =>
      result(() =>
        client.addFindingClaim(findingId, compact(input) as CreateClaimRequest),
      ),
  );

  server.registerTool(
    "codevault_add_finding_reference",
    {
      title: "Add a finding reference",
      description:
        "Attach an external reference URL and its provenance to a finding.",
      inputSchema: z.object({
        findingId: id,
        title: z.string().min(1).max(300),
        url: z.url().max(2_000),
        publisher: z.string().max(200).optional(),
        publishedAt: z.iso.datetime().optional(),
        retrievedAt: z.iso.datetime().optional(),
        visibility: z.enum(CONTENT_VISIBILITIES),
        note: z.string().max(1_000).optional(),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    ({ findingId, ...input }) =>
      result(() =>
        client.addFindingReference(
          findingId,
          compact(input) as CreateReferenceRequest,
        ),
      ),
  );
}
