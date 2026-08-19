import type { McpServer } from "@modelcontextprotocol/server";
import {
  CASE_PROFILES,
  CASE_STATUSES,
  CONTENT_VISIBILITIES,
  DISCLOSURE_EVENT_TYPES,
} from "@codevault/core";
import type {
  CreateCaseNoteRequest,
  CreateDisclosureEventRequest,
  CreateStakeholderRequest,
  SetEmbargoRequest,
  UpdateCaseRequest,
} from "@codevault/contracts";
import * as z from "zod/v4";

import type { CodeVaultClient } from "../client.js";
import { compact, id, markdown, nullableTimestamp, result } from "./shared.js";

export function registerCaseTools(
  server: McpServer,
  client: CodeVaultClient,
): void {
  server.registerTool(
    "codevault_get_case",
    {
      title: "Get a CodeVault case",
      description:
        "Read a research case, its owner, members, and policy packs.",
      inputSchema: z.object({ caseId: id }),
      annotations: { readOnlyHint: true },
    },
    ({ caseId }) => result(() => client.getCase(caseId)),
  );

  server.registerTool(
    "codevault_update_case",
    {
      title: "Update a CodeVault case",
      description:
        "Update case metadata, ownership, access, profile, status, or disclosure support immediately.",
      inputSchema: z.object({
        caseId: id,
        expectedRevision: z.number().int().min(1),
        title: z.string().min(1).max(200).optional(),
        summary: z.string().max(2_000).optional(),
        profile: z.enum(CASE_PROFILES).optional(),
        status: z.enum(CASE_STATUSES).optional(),
        ownerId: id.optional(),
        restricted: z.boolean().optional(),
        disclosureEnabled: z.boolean().optional(),
      }),
      annotations: { readOnlyHint: false, destructiveHint: true },
    },
    ({ caseId, ...input }) =>
      result(() =>
        client.updateCase(caseId, compact(input) as UpdateCaseRequest),
      ),
  );

  server.registerTool(
    "codevault_list_case_notes",
    {
      title: "List case notes",
      description: "Read the working notes recorded for a case.",
      inputSchema: z.object({ caseId: id }),
      annotations: { readOnlyHint: true },
    },
    ({ caseId }) => result(() => client.listCaseNotes(caseId)),
  );

  server.registerTool(
    "codevault_add_case_note",
    {
      title: "Add a case note",
      description: "Add a Markdown working note to a case immediately.",
      inputSchema: z.object({
        caseId: id,
        title: z.string().max(200).optional(),
        bodyMarkdown: markdown,
      }),
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    ({ caseId, ...input }) =>
      result(() =>
        client.addCaseNote(caseId, compact(input) as CreateCaseNoteRequest),
      ),
  );

  server.registerTool(
    "codevault_get_case_readiness",
    {
      title: "Check case readiness",
      description:
        "Evaluate the case's effective policy requirements and return every satisfied or missing item.",
      inputSchema: z.object({ caseId: id }),
      annotations: { readOnlyHint: true },
    },
    ({ caseId }) => result(() => client.getCaseReadiness(caseId)),
  );

  server.registerTool(
    "codevault_get_case_disclosure",
    {
      title: "Get case disclosure coordination",
      description:
        "Read stakeholders, disclosure timeline events, embargo dates, and coordination warnings.",
      inputSchema: z.object({ caseId: id }),
      annotations: { readOnlyHint: true },
    },
    ({ caseId }) => result(() => client.getCaseDisclosure(caseId)),
  );

  server.registerTool(
    "codevault_add_case_stakeholder",
    {
      title: "Add a disclosure stakeholder",
      description:
        "Add a vendor, CNA, CERT, program, or other disclosure contact to a case.",
      inputSchema: z.object({
        caseId: id,
        name: z.string().min(1).max(200),
        organisation: z.string().max(200).optional(),
        role: z.enum([
          "VENDOR_SECURITY",
          "VENDOR_ENGINEERING",
          "CNA",
          "CERT",
          "PROGRAM",
          "OTHER",
        ]),
        email: z.email().max(320).optional(),
        secureChannel: z.string().max(300).optional(),
        notes: z.string().max(2_000).optional(),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    ({ caseId, ...input }) =>
      result(() =>
        client.addCaseStakeholder(
          caseId,
          compact(input) as CreateStakeholderRequest,
        ),
      ),
  );

  server.registerTool(
    "codevault_add_disclosure_event",
    {
      title: "Add a disclosure event",
      description:
        "Record a dated disclosure or coordination event immediately, with optional finding, stakeholder, and evidence artifact links.",
      inputSchema: z.object({
        caseId: id,
        type: z.enum(DISCLOSURE_EVENT_TYPES),
        label: z.string().max(200).optional(),
        occurredAt: z.iso.datetime(),
        detailMarkdown: markdown.optional(),
        findingId: id.optional(),
        stakeholderId: id.optional(),
        artifactIds: z.array(id).max(100).optional(),
        visibility: z.enum(CONTENT_VISIBILITIES),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    ({ caseId, ...input }) =>
      result(() =>
        client.addDisclosureEvent(
          caseId,
          compact(input) as CreateDisclosureEventRequest,
        ),
      ),
  );

  server.registerTool(
    "codevault_set_case_embargo",
    {
      title: "Set case embargo dates",
      description:
        "Create or replace the case's embargo and coordination dates immediately.",
      inputSchema: z.object({
        caseId: id,
        startsAt: nullableTimestamp.optional(),
        endsAt: nullableTimestamp.optional(),
        plannedDisclosureAt: nullableTimestamp.optional(),
        expectedResponseAt: nullableTimestamp.optional(),
        agreementNote: z.union([z.string().max(2_000), z.null()]).optional(),
      }),
      annotations: { readOnlyHint: false, destructiveHint: true },
    },
    ({ caseId, ...input }) =>
      result(() =>
        client.setCaseEmbargo(caseId, compact(input) as SetEmbargoRequest),
      ),
  );
}
