import { sql } from "drizzle-orm";

import { uuidv7 } from "@codevault/core/crypto";
import { allocateReference, createDatabase, schema } from "@codevault/db";

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
          vendor: "WPMU DEV",
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
          vendor: "Acme Networks",
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
          vendor: "Acme Networks",
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
            vendor: "Internal",
            normalizedVendor: "internal",
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
