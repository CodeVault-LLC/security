import type { McpServer } from "@modelcontextprotocol/server";
import { ENCRYPTION_POLICIES } from "@codevault/core";
import type {
  CreateVendorPublicKeyRequest,
  CreateVendorRouteRequest,
  UpdateVendorRequest,
  UpdateVendorRouteRequest,
  VerifyVendorPublicKeyRequest,
} from "@codevault/contracts";
import * as z from "zod/v4";

import type { CodeVaultClient } from "../client.js";
import {
  compact,
  id,
  nullableHttpsUrl,
  nullableTimestamp,
  result,
} from "./shared.js";

const submissionFields = [
  "vulnerability_type",
  "affected_product",
  "affected_version",
  "environment",
  "configuration",
  "reproduction",
  "evidence",
  "impact",
  "remediation",
  "researcher_contact",
  "disclosure_expectations",
] as const;

const routeProvenance = {
  sourceUrl: nullableHttpsUrl.optional(),
  sourceReviewedAt: nullableTimestamp.optional(),
};

const emailRoute = z.object({
  type: z.literal("EMAIL"),
  name: z.string().min(1).max(200),
  to: z.array(z.email()).min(1).max(10),
  cc: z.array(z.email()).max(10),
  subjectTemplate: z.string().min(1).max(300),
  maximumAttachmentBytes: z
    .number()
    .int()
    .min(0)
    .max(25 * 1024 * 1024),
  acknowledgementBusinessDays: z.number().int().min(1).max(90),
  updateCadenceDays: z.union([z.number().int().min(1).max(365), z.null()]),
  requiredFields: z
    .array(z.enum(submissionFields))
    .max(submissionFields.length),
  encryptionPolicy: z.enum(ENCRYPTION_POLICIES),
  publicKeyId: z.union([id, z.null()]),
  ...routeProvenance,
});

const fieldMapping = z.object({
  key: z
    .string()
    .regex(/^[a-z][a-z0-9_]*$/u)
    .max(80),
  label: z.string().min(1).max(200),
  required: z.boolean(),
  format: z.enum(["TEXT", "MULTILINE_TEXT", "EMAIL", "URL", "DATE"]),
  submissionField: z.union([z.enum(submissionFields), z.null()]),
  helpText: z.union([z.string().max(1_000), z.null()]),
});

const manualRoute = z.object({
  type: z.literal("MANUAL"),
  name: z.string().min(1).max(200),
  destinationUrl: z.url({ protocol: /^https$/u }),
  fieldMappings: z.array(fieldMapping).min(1).max(100),
  acceptedExtensions: z.array(z.string().regex(/^\.[a-z0-9]{1,16}$/u)).max(50),
  maximumFileBytes: z
    .number()
    .int()
    .min(0)
    .max(250 * 1024 * 1024),
  maximumFileCount: z.number().int().min(0).max(100),
  acknowledgementBusinessDays: z.number().int().min(1).max(90),
  updateCadenceDays: z.union([z.number().int().min(1).max(365), z.null()]),
  instructions: z.union([z.string().max(20_000), z.null()]),
  ...routeProvenance,
});

export function registerVendorTools(
  server: McpServer,
  client: CodeVaultClient,
): void {
  server.registerTool(
    "codevault_get_vendor",
    {
      title: "Get a CodeVault vendor",
      description:
        "Read a vendor with contact routes, public keys, provenance, and linked asset count.",
      inputSchema: z.object({ vendorId: id }),
      annotations: { readOnlyHint: true },
    },
    ({ vendorId }) => result(() => client.getVendor(vendorId)),
  );

  server.registerTool(
    "codevault_update_vendor",
    {
      title: "Update a CodeVault vendor",
      description: "Update or archive a vendor immediately.",
      inputSchema: z.object({
        vendorId: id,
        expectedRevision: z.number().int().min(1),
        name: z.string().min(1).max(200).optional(),
        websiteUrl: nullableHttpsUrl.optional(),
        sourceUrl: nullableHttpsUrl.optional(),
        sourceReviewedAt: nullableTimestamp.optional(),
        archived: z.boolean().optional(),
      }),
      annotations: { readOnlyHint: false, destructiveHint: true },
    },
    ({ vendorId, ...input }) =>
      result(() =>
        client.updateVendor(vendorId, compact(input) as UpdateVendorRequest),
      ),
  );

  server.registerTool(
    "codevault_add_vendor_contact_route",
    {
      title: "Add a vendor contact route",
      description:
        "Add a structured vendor email or manual disclosure route with its submission requirements.",
      inputSchema: z.object({
        vendorId: id,
        route: z.discriminatedUnion("type", [emailRoute, manualRoute]),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    ({ vendorId, route }) =>
      result(() =>
        client.addVendorContactRoute(
          vendorId,
          compact(route) as CreateVendorRouteRequest,
        ),
      ),
  );

  server.registerTool(
    "codevault_get_vendor_contact_route",
    {
      title: "Get a vendor contact route",
      description: "Read one vendor disclosure route and its requirements.",
      inputSchema: z.object({ routeId: id }),
      annotations: { readOnlyHint: true },
    },
    ({ routeId }) => result(() => client.getVendorContactRoute(routeId)),
  );

  server.registerTool(
    "codevault_update_vendor_contact_route",
    {
      title: "Update a vendor contact route",
      description:
        "Update or deactivate a vendor disclosure route immediately.",
      inputSchema: z.object({
        routeId: id,
        expectedRevision: z.number().int().min(1),
        name: z.string().min(1).max(200).optional(),
        active: z.boolean().optional(),
        to: z.array(z.email()).min(1).max(10).optional(),
        cc: z.array(z.email()).max(10).optional(),
        subjectTemplate: z.string().max(300).optional(),
        encryptionPolicy: z.enum(ENCRYPTION_POLICIES).optional(),
        publicKeyId: z.union([id, z.null()]).optional(),
        maximumAttachmentBytes: z
          .number()
          .int()
          .min(0)
          .max(25 * 1024 * 1024)
          .optional(),
        destinationUrl: z.url({ protocol: /^https$/u }).optional(),
        fieldMappings: z.array(fieldMapping).max(100).optional(),
        acceptedExtensions: z
          .array(z.string().regex(/^\.[a-z0-9]{1,16}$/u))
          .max(50)
          .optional(),
        maximumFileBytes: z.number().int().min(0).optional(),
        maximumFileCount: z.number().int().min(0).max(100).optional(),
        acknowledgementBusinessDays: z.number().int().min(1).max(90).optional(),
        updateCadenceDays: z
          .union([z.number().int().min(1).max(365), z.null()])
          .optional(),
        requiredFields: z.array(z.enum(submissionFields)).optional(),
        instructions: z.union([z.string().max(20_000), z.null()]).optional(),
        sourceUrl: nullableHttpsUrl.optional(),
        sourceReviewedAt: nullableTimestamp.optional(),
      }),
      annotations: { readOnlyHint: false, destructiveHint: true },
    },
    ({ routeId, ...input }) =>
      result(() =>
        client.updateVendorContactRoute(
          routeId,
          compact(input) as UpdateVendorRouteRequest,
        ),
      ),
  );

  server.registerTool(
    "codevault_add_vendor_public_key",
    {
      title: "Add a vendor public key",
      description:
        "Import a vendor PGP public key after verifying the expected fingerprint and source URL.",
      inputSchema: z.object({
        vendorId: id,
        armoredKey: z.string().min(1).max(2_000_000),
        sourceUrl: z.url({ protocol: /^https$/u }),
        expectedFingerprint: z
          .string()
          .regex(/^(?:[0-9A-Fa-f]{40}|[0-9A-Fa-f]{64})$/u),
        supersedesKeyId: id.optional(),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    ({ vendorId, ...input }) =>
      result(() =>
        client.addVendorPublicKey(
          vendorId,
          compact(input) as CreateVendorPublicKeyRequest,
        ),
      ),
  );

  server.registerTool(
    "codevault_verify_vendor_public_key",
    {
      title: "Verify a vendor public key",
      description:
        "Mark a vendor public key verified immediately after matching its fingerprint to the supplied authoritative source.",
      inputSchema: z.object({
        vendorId: id,
        keyId: id,
        expectedFingerprint: z
          .string()
          .regex(/^(?:[0-9A-Fa-f]{40}|[0-9A-Fa-f]{64})$/u),
        sourceUrl: z.url({ protocol: /^https$/u }),
        expectedRevision: z.number().int().min(1),
      }),
      annotations: { readOnlyHint: false, destructiveHint: true },
    },
    ({ vendorId, keyId, ...input }) =>
      result(() =>
        client.verifyVendorPublicKey(
          vendorId,
          keyId,
          input as VerifyVendorPublicKeyRequest,
        ),
      ),
  );
}
