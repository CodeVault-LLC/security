import { sql } from "drizzle-orm";

import type { CreateVendorRouteRequest } from "@codevault/contracts";
import { uuidv7 } from "@codevault/core/crypto";
import { allocateReference, createDatabase, schema } from "@codevault/db";
import { seedBuiltIns } from "../apps/server/src/startup/seed.js";

/**
 * Development seed.
 *
 * Creates the three research shapes the product has to handle well: a small
 * software-component finding, an embargoed device-and-firmware case, and an API
 * service. It exists so the interface can be judged against realistic density
 * rather than against one row.
 *
 * Refuses to run against anything that looks like production.
 */

const SEED_MARKER = "codevault-dev-seed";

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;

  if (connectionString === undefined) {
    console.error("DATABASE_URL is not set.");
    process.exitCode = 1;

    return;
  }

  if (process.env.NODE_ENV === "production") {
    console.error("Refusing to seed a production environment.");
    process.exitCode = 1;

    return;
  }

  const handle = createDatabase({ connectionString });

  try {
    await seedBuiltIns(handle.db);

    const admins = await handle.db
      .select({ id: schema.users.id, email: schema.users.email })
      .from(schema.users)
      .where(
        sql`${schema.users.role} = 'ADMIN' AND ${schema.users.disabled} = false`,
      )
      .limit(1);

    const owner = admins[0];

    if (owner === undefined) {
      console.error(
        "No administrator exists. Run `bun run admin:create` first — seeding " +
          "does not create accounts, because account creation is invitation-only.",
      );
      process.exitCode = 1;

      return;
    }

    const existing = await handle.db
      .select({ id: schema.cases.id })
      .from(schema.cases)
      .where(sql`${schema.cases.metadata}->>'seed' = ${SEED_MARKER}`)
      .limit(1);

    if (existing.length > 0) {
      console.warn("The development seed is already present.");

      return;
    }

    await handle.db.transaction(async (tx) => {
      const ensureVendor = async (
        slug: string,
        name: string,
        websiteUrl: string | null,
      ): Promise<string> => {
        const normalizedName = name.toLocaleLowerCase("en-US");
        const [existingVendor] = await tx
          .select({ id: schema.vendors.id })
          .from(schema.vendors)
          .where(sql`${schema.vendors.normalizedName} = ${normalizedName}`)
          .limit(1);

        if (existingVendor !== undefined) {
          return existingVendor.id;
        }

        const ref = await allocateReference(tx, "vendor");
        const [createdVendor] = await tx
          .insert(schema.vendors)
          .values({
            ref,
            slug,
            name,
            normalizedName,
            websiteUrl,
            createdBy: owner.id,
          })
          .returning({ id: schema.vendors.id });

        if (createdVendor === undefined) {
          throw new Error(`Could not create seed vendor ${name}.`);
        }

        return createdVendor.id;
      };

      const wpmuVendorId = await ensureVendor(
        "wpmu-dev",
        "WPMU DEV",
        "https://wpmudev.com/",
      );
      const acmeVendorId = await ensureVendor(
        "acme-networks",
        "Acme Networks",
        "https://acme.invalid/",
      );
      const internalVendorId = await ensureVendor(
        "internal-test-services",
        "Internal Test Services",
        null,
      );

      const ensureRoute = async (
        vendorId: string,
        route: CreateVendorRouteRequest,
      ): Promise<{ id: string; revision: number }> => {
        const [existingRoute] = await tx
          .select({
            id: schema.vendorRoutes.id,
            revision: schema.vendorRoutes.revision,
          })
          .from(schema.vendorRoutes)
          .where(
            sql`${schema.vendorRoutes.vendorId} = ${vendorId} AND ${schema.vendorRoutes.name} = ${route.name}`,
          )
          .limit(1);
        if (existingRoute !== undefined) return existingRoute;
        const [createdRoute] = await tx
          .insert(schema.vendorRoutes)
          .values({
            vendorId,
            name: route.name,
            type: route.type,
            requirements: route as unknown as Record<string, unknown>,
            sourceUrl: route.sourceUrl,
            sourceReviewedAt: route.sourceReviewedAt,
            createdBy: owner.id,
          })
          .returning({
            id: schema.vendorRoutes.id,
            revision: schema.vendorRoutes.revision,
          });
        if (createdRoute === undefined)
          throw new Error(`Could not create seed route ${route.name}.`);
        return createdRoute;
      };

      const wpmuRouteRequirements: CreateVendorRouteRequest = {
        name: "Maintainer security form (test fixture)",
        type: "MANUAL",
        destinationUrl: "https://wpmudev.example/security-report",
        fieldMappings: [
          {
            key: "plugin_slug",
            label: "Plugin slug",
            required: true,
            format: "TEXT",
            submissionField: "affected_product",
            helpText: null,
          },
          {
            key: "reproduction",
            label: "Reproduction steps",
            required: true,
            format: "MULTILINE_TEXT",
            submissionField: "reproduction",
            helpText: null,
          },
        ],
        acceptedExtensions: [".pdf", ".txt", ".zip"],
        maximumFileBytes: 20 * 1024 * 1024,
        maximumFileCount: 5,
        acknowledgementBusinessDays: 7,
        updateCadenceDays: 30,
        instructions: "Development fixture only. Do not submit externally.",
        sourceUrl: "https://wpmudev.example/security",
        sourceReviewedAt: "2026-08-18T00:00:00.000Z",
      };
      const wpmuRoute = await ensureRoute(wpmuVendorId, wpmuRouteRequirements);

      const acmeRouteRequirements: CreateVendorRouteRequest = {
        name: "PSIRT email (test fixture)",
        type: "EMAIL",
        to: ["security@acme.invalid"],
        cc: [],
        subjectTemplate: "[TEST ONLY] Security report {caseRef}",
        encryptionPolicy: "OPTIONAL",
        publicKeyId: null,
        maximumAttachmentBytes: 20 * 1024 * 1024,
        acknowledgementBusinessDays: 3,
        updateCadenceDays: 14,
        requiredFields: ["affected_product", "reproduction", "impact"],
        sourceUrl: "https://acme.invalid/security",
        sourceReviewedAt: "2026-08-18T00:00:00.000Z",
      };
      const acmeRoute = await ensureRoute(acmeVendorId, acmeRouteRequirements);

      // --- A software component, the everyday case ------------------------
      const pluginCaseRef = await allocateReference(tx, "case");
      const [pluginCase] = await tx
        .insert(schema.cases)
        .values({
          ref: pluginCaseRef,
          title: "Hummingbird Performance plugin review",
          summary:
            "Routine review of a widely installed WordPress performance plugin.",
          profile: "COORDINATED_DISCLOSURE",
          ownerId: owner.id,
          disclosureEnabled: true,
          metadata: { seed: SEED_MARKER },
        })
        .returning({ id: schema.cases.id });

      if (pluginCase === undefined) {
        throw new Error("Could not create the seed case.");
      }

      const pluginAssetRef = await allocateReference(tx, "asset");
      const [pluginAsset] = await tx
        .insert(schema.assets)
        .values({
          ref: pluginAssetRef,
          name: "Hummingbird Performance",
          kind: "SOFTWARE_COMPONENT",
          vendorId: wpmuVendorId,
          version: "3.4.1",
          normalizedVendor: "wpmu dev",
          normalizedProduct: "hummingbird performance",
          createdBy: owner.id,
          metadata: { seed: SEED_MARKER },
        })
        .returning({ id: schema.assets.id });

      if (pluginAsset === undefined) {
        throw new Error("Could not create the seed asset.");
      }

      await tx.insert(schema.assetIdentifiers).values({
        assetId: pluginAsset.id,
        scheme: "PURL",
        value: "pkg:wordpress/hummingbird-performance",
        primary: true,
      });

      await tx
        .insert(schema.caseAssets)
        .values({ caseId: pluginCase.id, assetId: pluginAsset.id });

      const findingRef = await allocateReference(tx, "finding");
      const [finding] = await tx
        .insert(schema.findings)
        .values({
          ref: findingRef,
          caseId: pluginCase.id,
          title: "Unauthenticated cache purge via a missing nonce check",
          summaryMarkdown:
            "The cache purge endpoint accepts requests without verifying a nonce, " +
            "letting any visitor force repeated cache rebuilds.",
          technicalMarkdown:
            "`hb_purge_cache` is registered as an `admin_post_nopriv_` action and " +
            "calls the purge routine before any capability or nonce check runs.",
          impactMarkdown:
            "An unauthenticated attacker can hold the site in a permanent cache " +
            "rebuild, degrading availability for every visitor.",
          validationState: "REPRODUCED",
          remediationState: "UNFIXED",
          disclosureState: "CONTACT_PREPARED",
          priorArtState: "UNCHECKED",
          cweIds: ["CWE-352", "CWE-306"],
          ownerId: owner.id,
        })
        .returning({ id: schema.findings.id });

      if (finding === undefined) {
        throw new Error("Could not create the seed finding.");
      }

      await tx.insert(schema.findingAssets).values({
        findingId: finding.id,
        assetId: pluginAsset.id,
        primary: true,
      });

      await tx.insert(schema.affectedRanges).values({
        findingId: finding.id,
        assetId: pluginAsset.id,
        kind: "SEMVER_RANGE",
        expression: ">=3.0.0 <=3.4.1",
        status: "CONFIRMED_VULNERABLE",
        evidenceNote: "Reproduced on 3.4.1; 3.0.0 reviewed by source.",
        createdBy: owner.id,
      });

      await tx.insert(schema.findingScores).values({
        findingId: finding.id,
        scheme: "CVSS40",
        vector:
          "CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:N/VI:N/VA:L/SC:N/SI:N/SA:N",
        score: 6.9,
        severity: "MEDIUM",
        metrics: {},
        source: "HUMAN",
        reviewState: "APPROVED",
        reviewedBy: owner.id,
        reviewedAt: new Date().toISOString(),
        createdBy: owner.id,
      });

      await tx
        .update(schema.findings)
        .set({ severity: "MEDIUM", score: 6.9 })
        .where(sql`${schema.findings.id} = ${finding.id}`);

      await tx.insert(schema.stakeholders).values({
        caseId: pluginCase.id,
        name: "WPMU DEV Security",
        organisation: "WPMU DEV",
        role: "VENDOR_SECURITY",
        email: "security@wpmudev.example",
        createdBy: owner.id,
      });

      await tx.insert(schema.disclosureEvents).values({
        caseId: pluginCase.id,
        findingId: finding.id,
        type: "DISCOVERED",
        occurredAt: new Date(Date.now() - 6 * 86_400_000).toISOString(),
        visibility: "VENDOR",
        recordedBy: owner.id,
      });

      const pluginSubmissionRef = await allocateReference(tx, "submission");
      const [pluginSubmission] = await tx
        .insert(schema.submissions)
        .values({
          ref: pluginSubmissionRef,
          caseId: pluginCase.id,
          vendorId: wpmuVendorId,
          routeId: wpmuRoute.id,
          routeSnapshot: {
            routeId: wpmuRoute.id,
            routeRevision: wpmuRoute.revision,
            vendorId: wpmuVendorId,
            capturedAt: new Date().toISOString(),
            route: wpmuRouteRequirements,
          },
          status: "IN_REVIEW",
          coordinationState: "PREPARING",
          cryptoMode: "PLAIN",
          subject: "Hummingbird cache purge vulnerability",
          bodyMarkdown:
            "A reviewed draft for the plugin maintainer. This fixture is never sent automatically.",
          manualFields: {
            plugin_slug: "hummingbird-performance",
            reproduction:
              "Install 3.4.1, authenticate as no user, then request the fixture endpoint.",
          },
          plannedNextContactAt: new Date(
            Date.now() + 3 * 86_400_000,
          ).toISOString(),
          coordinationNotes:
            "Review recipient and attachments before approval.",
          createdBy: owner.id,
          lastEditedBy: owner.id,
        })
        .returning({
          id: schema.submissions.id,
          revision: schema.submissions.revision,
        });
      if (pluginSubmission !== undefined) {
        await tx.insert(schema.submissionRevisions).values({
          submissionId: pluginSubmission.id,
          revision: pluginSubmission.revision,
          subject: "Hummingbird cache purge vulnerability",
          bodyMarkdown:
            "A reviewed draft for the plugin maintainer. This fixture is never sent automatically.",
          manualFields: {
            plugin_slug: "hummingbird-performance",
            reproduction:
              "Install 3.4.1, authenticate as no user, then request the fixture endpoint.",
          },
          cryptoMode: "PLAIN",
          authoredBy: owner.id,
        });
      }

      // --- A device and its firmware, the shape a web-only model breaks on -
      const deviceCaseRef = await allocateReference(tx, "case");
      const [deviceCase] = await tx
        .insert(schema.cases)
        .values({
          ref: deviceCaseRef,
          title: "Acme RT-1200 router firmware",
          summary: "Firmware teardown of a consumer router.",
          profile: "CRITICAL_ZERO_DAY",
          ownerId: owner.id,
          restricted: true,
          disclosureEnabled: true,
          metadata: { seed: SEED_MARKER },
        })
        .returning({ id: schema.cases.id });

      if (deviceCase === undefined) {
        throw new Error("Could not create the device case.");
      }

      const deviceRef = await allocateReference(tx, "asset");
      const [device] = await tx
        .insert(schema.assets)
        .values({
          ref: deviceRef,
          name: "Acme RT-1200",
          kind: "DEVICE",
          vendorId: acmeVendorId,
          version: "Rev B",
          normalizedVendor: "acme networks",
          normalizedProduct: "acme rt 1200",
          createdBy: owner.id,
          metadata: { seed: SEED_MARKER, architecture: "mips32el" },
        })
        .returning({ id: schema.assets.id });

      const firmwareRef = await allocateReference(tx, "asset");
      const [firmware] = await tx
        .insert(schema.assets)
        .values({
          ref: firmwareRef,
          name: "RT-1200 firmware",
          kind: "FIRMWARE",
          vendorId: acmeVendorId,
          version: "2.8.4",
          normalizedVendor: "acme networks",
          normalizedProduct: "rt 1200 firmware",
          createdBy: owner.id,
          metadata: { seed: SEED_MARKER },
        })
        .returning({ id: schema.assets.id });

      if (device === undefined || firmware === undefined) {
        throw new Error("Could not create the device assets.");
      }

      // The relationship a WordPress-shaped model cannot express.
      await tx.insert(schema.assetRelationships).values({
        fromAssetId: firmware.id,
        toAssetId: device.id,
        relationship: "FIRMWARE_FOR",
        createdBy: owner.id,
      });

      await tx.insert(schema.caseAssets).values([
        { caseId: deviceCase.id, assetId: device.id },
        { caseId: deviceCase.id, assetId: firmware.id },
      ]);

      const rceRef = await allocateReference(tx, "finding");
      const [rce] = await tx
        .insert(schema.findings)
        .values({
          ref: rceRef,
          caseId: deviceCase.id,
          title:
            "Unauthenticated command injection in the firmware update handler",
          summaryMarkdown:
            "The update handler passes an attacker-controlled filename to a shell.",
          validationState: "PEER_REVIEWED",
          remediationState: "UNFIXED",
          disclosureState: "VENDOR_CONTACTED",
          priorArtState: "NO_PRIOR_ART_FOUND",
          cweIds: ["CWE-78"],
          severity: "CRITICAL",
          score: 9.3,
          ownerId: owner.id,
        })
        .returning({ id: schema.findings.id });

      if (rce !== undefined) {
        await tx.insert(schema.findingAssets).values([
          { findingId: rce.id, assetId: firmware.id, primary: true },
          { findingId: rce.id, assetId: device.id, primary: false },
        ]);
      }

      const acmeSubmissionRef = await allocateReference(tx, "submission");
      const [acmeSubmission] = await tx
        .insert(schema.submissions)
        .values({
          ref: acmeSubmissionRef,
          caseId: deviceCase.id,
          vendorId: acmeVendorId,
          routeId: acmeRoute.id,
          routeSnapshot: {
            routeId: acmeRoute.id,
            routeRevision: acmeRoute.revision,
            vendorId: acmeVendorId,
            capturedAt: new Date().toISOString(),
            route: acmeRouteRequirements,
          },
          status: "DRAFT",
          coordinationState: "NEEDS_INFORMATION",
          cryptoMode: "ENCRYPTED",
          subject: "[TEST ONLY] RT-1200 command injection",
          bodyMarkdown:
            "Critical test fixture. Confirm a verified test key before sealing this draft.",
          manualFields: {},
          agreedDisclosureAt: new Date(
            Date.now() + 21 * 86_400_000,
          ).toISOString(),
          vendorReference: "ACME-PSIRT-TEST-1042",
          coordinationNotes:
            "Restricted zero-day example; use only fake recipients and locally verified keys.",
          createdBy: owner.id,
          lastEditedBy: owner.id,
        })
        .returning({
          id: schema.submissions.id,
          revision: schema.submissions.revision,
        });
      if (acmeSubmission !== undefined) {
        await tx.insert(schema.submissionRevisions).values({
          submissionId: acmeSubmission.id,
          revision: acmeSubmission.revision,
          subject: "[TEST ONLY] RT-1200 command injection",
          bodyMarkdown:
            "Critical test fixture. Confirm a verified test key before sealing this draft.",
          manualFields: {},
          cryptoMode: "ENCRYPTED",
          authoredBy: owner.id,
        });
      }

      // --- A service, for the API-shaped case ------------------------------
      const apiCaseRef = await allocateReference(tx, "case");
      const [apiCase] = await tx
        .insert(schema.cases)
        .values({
          ref: apiCaseRef,
          title: "Partner API review",
          profile: "STANDARD",
          ownerId: owner.id,
          metadata: { seed: SEED_MARKER },
        })
        .returning({ id: schema.cases.id });

      if (apiCase !== undefined) {
        const apiAssetRef = await allocateReference(tx, "asset");
        const [apiAsset] = await tx
          .insert(schema.assets)
          .values({
            ref: apiAssetRef,
            name: "Partner Export API",
            kind: "API",
            vendorId: internalVendorId,
            normalizedVendor: "internal test services",
            normalizedProduct: "partner export api",
            createdBy: owner.id,
            metadata: { seed: SEED_MARKER },
          })
          .returning({ id: schema.assets.id });

        if (apiAsset !== undefined) {
          await tx
            .insert(schema.caseAssets)
            .values({ caseId: apiCase.id, assetId: apiAsset.id });
        }
      }

      await tx.insert(schema.auditEvents).values({
        id: uuidv7(),
        action: "system.seeded",
        entityType: "system",
        entityId: null,
        actorId: owner.id,
        after: { marker: SEED_MARKER },
      });
    });

    console.warn(`Seeded development data for ${owner.email}.`);
  } finally {
    await handle.close();
  }
}

await main();
