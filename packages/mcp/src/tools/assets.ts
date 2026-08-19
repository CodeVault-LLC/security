import type { McpServer } from "@modelcontextprotocol/server";
import {
  ASSET_IDENTIFIER_SCHEMES,
  ASSET_KINDS,
  ASSET_RELATIONSHIPS,
} from "@codevault/core";
import type {
  AddAssetIdentifierRequest,
  AddAssetRelationshipRequest,
  AddAssetVersionRequest,
  UpdateAssetRequest,
} from "@codevault/contracts";
import * as z from "zod/v4";

import type { CodeVaultClient } from "../client.js";
import { compact, id, result } from "./shared.js";

export function registerAssetTools(
  server: McpServer,
  client: CodeVaultClient,
): void {
  server.registerTool(
    "codevault_get_asset",
    {
      title: "Get a CodeVault asset",
      description:
        "Read an asset with identifiers, versions, relationships, vendor, notes, and metadata.",
      inputSchema: z.object({ assetId: id }),
      annotations: { readOnlyHint: true },
    },
    ({ assetId }) => result(() => client.getAsset(assetId)),
  );

  server.registerTool(
    "codevault_update_asset",
    {
      title: "Update a CodeVault asset",
      description: "Update an asset immediately using its current revision.",
      inputSchema: z.object({
        assetId: id,
        expectedRevision: z.number().int().min(1),
        name: z.string().min(1).max(200).optional(),
        kind: z.enum(ASSET_KINDS).optional(),
        vendorId: z.union([id, z.null()]).optional(),
        version: z.union([z.string().max(120), z.null()]).optional(),
        notes: z.union([z.string().max(5_000), z.null()]).optional(),
        metadata: z.record(z.string(), z.unknown()).optional(),
      }),
      annotations: { readOnlyHint: false, destructiveHint: true },
    },
    ({ assetId, ...input }) =>
      result(() =>
        client.updateAsset(assetId, compact(input) as UpdateAssetRequest),
      ),
  );

  server.registerTool(
    "codevault_add_asset_identifier",
    {
      title: "Add an asset identifier",
      description:
        "Attach a stable PURL, CPE, SWID, repository URL, vendor product, model, serial, or custom identifier.",
      inputSchema: z.object({
        assetId: id,
        scheme: z.enum(ASSET_IDENTIFIER_SCHEMES),
        value: z.string().min(1).max(500),
        primary: z.boolean().optional(),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    ({ assetId, ...input }) =>
      result(() =>
        client.addAssetIdentifier(
          assetId,
          compact(input) as AddAssetIdentifierRequest,
        ),
      ),
  );

  server.registerTool(
    "codevault_add_asset_version",
    {
      title: "Add an asset version",
      description: "Record a version or release of an asset.",
      inputSchema: z.object({
        assetId: id,
        version: z.string().min(1).max(120),
        releasedAt: z.iso.datetime().optional(),
        metadata: z.record(z.string(), z.unknown()).optional(),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    ({ assetId, ...input }) =>
      result(() =>
        client.addAssetVersion(
          assetId,
          compact(input) as AddAssetVersionRequest,
        ),
      ),
  );

  server.registerTool(
    "codevault_add_asset_relationship",
    {
      title: "Add an asset relationship",
      description:
        "Relate this asset to another asset, for example as a dependency, container, runtime, firmware target, or build source.",
      inputSchema: z.object({
        assetId: id,
        relationship: z.enum(ASSET_RELATIONSHIPS),
        toAssetId: id,
        note: z.string().max(500).optional(),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    ({ assetId, ...input }) =>
      result(() =>
        client.addAssetRelationship(
          assetId,
          compact(input) as AddAssetRelationshipRequest,
        ),
      ),
  );
}
