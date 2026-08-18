import { and, eq, or, sql } from "drizzle-orm";

import type { CreateVendorRouteRequest } from "@codevault/contracts";
import { BUILT_IN_POLICY_PACKS } from "@codevault/core";
import { allocateReference, schema, type Database } from "@codevault/db";
import { BUILT_IN_TEMPLATES } from "@codevault/reporting";

interface BuiltInVendor {
  slug: string;
  name: string;
  normalizedName: string;
  websiteUrl: string;
  sourceUrl: string;
  sourceReviewedAt: string;
  routes: CreateVendorRouteRequest[];
}

const REVIEWED_AT = "2026-08-18T00:00:00.000Z";

/**
 * Conservative starter data from official disclosure pages.
 *
 * No public key is seeded: an encryption key is only trustworthy after its
 * fingerprint has been checked through an independent channel by a user.
 */
const BUILT_IN_VENDORS: BuiltInVendor[] = [
  {
    slug: "tp-link",
    name: "TP-Link",
    normalizedName: "tp-link",
    websiteUrl: "https://www.tp-link.com/",
    sourceUrl: "https://www.tp-link.com/uk/press/security-advisory/",
    sourceReviewedAt: REVIEWED_AT,
    routes: [
      {
        name: "Product Security email",
        type: "EMAIL",
        to: ["security@tp-link.com"],
        cc: [],
        subjectTemplate: "Security vulnerability report: {caseRef}",
        encryptionPolicy: "OPTIONAL",
        publicKeyId: null,
        maximumAttachmentBytes: 20 * 1024 * 1024,
        acknowledgementBusinessDays: 5,
        updateCadenceDays: 42,
        requiredFields: [
          "vulnerability_type",
          "affected_product",
          "affected_version",
          "configuration",
          "reproduction",
          "evidence",
          "impact",
          "remediation",
          "researcher_contact",
          "disclosure_expectations",
        ],
        sourceUrl: "https://www.tp-link.com/uk/press/security-advisory/",
        sourceReviewedAt: REVIEWED_AT,
      },
    ],
  },
  {
    slug: "wordpress-org",
    name: "WordPress.org",
    normalizedName: "wordpress.org",
    websiteUrl: "https://wordpress.org/",
    sourceUrl:
      "https://make.wordpress.org/core/handbook/testing/reporting-security-vulnerabilities/",
    sourceReviewedAt: REVIEWED_AT,
    routes: [
      {
        name: "WordPress HackerOne submission",
        type: "MANUAL",
        destinationUrl: "https://hackerone.com/wordpress",
        fieldMappings: [
          {
            key: "title",
            label: "Vulnerability title",
            required: true,
            format: "TEXT",
            submissionField: "vulnerability_type",
            helpText: null,
          },
          {
            key: "product_version",
            label: "Affected WordPress version",
            required: true,
            format: "TEXT",
            submissionField: "affected_version",
            helpText: null,
          },
          {
            key: "description",
            label: "Reproduction and impact",
            required: true,
            format: "MULTILINE_TEXT",
            submissionField: "reproduction",
            helpText:
              "Keep the report confidential and include the security impact and reproducible steps.",
          },
          {
            key: "researcher_contact",
            label: "Researcher contact",
            required: true,
            format: "EMAIL",
            submissionField: "researcher_contact",
            helpText: null,
          },
        ],
        acceptedExtensions: [".txt", ".md", ".pdf", ".png", ".zip"],
        maximumFileBytes: 250 * 1024 * 1024,
        maximumFileCount: 20,
        acknowledgementBusinessDays: 10,
        updateCadenceDays: null,
        instructions:
          "Submit through the official WordPress HackerOne program. Do not disclose the issue publicly while it is being investigated. Portal limits and response times take precedence over these workspace reminders.",
        sourceUrl:
          "https://make.wordpress.org/core/handbook/testing/reporting-security-vulnerabilities/",
        sourceReviewedAt: REVIEWED_AT,
      },
    ],
  },
];

/**
 * Built-in seeding.
 *
 * Policy packs and report templates are defined in code and mirrored into the
 * database on every start, so a deployment can add its own rows without the
 * defaults drifting away from what the source says they are.
 */

export async function seedBuiltIns(db: Database): Promise<void> {
  for (const pack of BUILT_IN_POLICY_PACKS) {
    await db
      .insert(schema.policyPacks)
      .values({
        id: pack.id,
        name: pack.name,
        description: pack.description,
        profile: pack.profile,
        requirements: pack.requirements as unknown as Record<string, unknown>,
        builtIn: true,
      })
      .onConflictDoUpdate({
        target: schema.policyPacks.id,
        set: {
          name: pack.name,
          description: pack.description,
          requirements: pack.requirements as unknown as Record<string, unknown>,
          updatedAt: sql`now()`,
        },
      });
  }

  for (const template of BUILT_IN_TEMPLATES) {
    await db
      .insert(schema.reportTemplates)
      .values({
        id: template.id,
        name: template.name,
        audience: template.audience,
        defaultTlp: template.defaultTlp,
        visibilityCeiling: template.visibilityCeiling,
        sections: template.sections,
        version: template.version,
        builtIn: true,
      })
      .onConflictDoUpdate({
        target: schema.reportTemplates.id,
        set: {
          name: template.name,
          sections: template.sections,
          version: template.version,
          updatedAt: sql`now()`,
        },
      });
  }

  for (const vendor of BUILT_IN_VENDORS) {
    await seedBuiltInVendor(db, vendor);
  }
}

async function seedBuiltInVendor(
  db: Database,
  definition: BuiltInVendor,
): Promise<void> {
  await db.transaction(async (tx) => {
    // Application instances and integration workers can start together. A
    // transaction-scoped advisory lock makes the read/insert promotion atomic
    // without coupling seed identity to generated UUIDs.
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext(${"codevault.seed.vendor." + definition.slug}))`,
    );

    const matches = await tx
      .select()
      .from(schema.vendors)
      .where(
        or(
          eq(schema.vendors.slug, definition.slug),
          eq(schema.vendors.normalizedName, definition.normalizedName),
        ),
      )
      .limit(2);

    if (matches.length > 1) {
      throw new Error(
        `Built-in vendor ${definition.slug} matches more than one record.`,
      );
    }

    let vendorId = matches[0]?.id;

    if (vendorId === undefined) {
      const ref = await allocateReference(tx, "vendor");
      const [created] = await tx
        .insert(schema.vendors)
        .values({
          ref,
          slug: definition.slug,
          name: definition.name,
          normalizedName: definition.normalizedName,
          websiteUrl: definition.websiteUrl,
          builtIn: true,
          sourceUrl: definition.sourceUrl,
          sourceReviewedAt: definition.sourceReviewedAt,
        })
        .returning({ id: schema.vendors.id });

      if (created === undefined) {
        throw new Error(`Could not seed built-in vendor ${definition.slug}.`);
      }

      vendorId = created.id;
    } else if (matches[0]?.builtInModifiedAt === null) {
      await tx
        .update(schema.vendors)
        .set({
          slug: definition.slug,
          name: definition.name,
          normalizedName: definition.normalizedName,
          websiteUrl: definition.websiteUrl,
          builtIn: true,
          sourceUrl: definition.sourceUrl,
          sourceReviewedAt: definition.sourceReviewedAt,
          archivedAt: null,
          updatedAt: sql`now()`,
        })
        .where(eq(schema.vendors.id, vendorId));
    }

    for (const route of definition.routes) {
      const [existing] = await tx
        .select()
        .from(schema.vendorRoutes)
        .where(
          and(
            eq(schema.vendorRoutes.vendorId, vendorId),
            eq(schema.vendorRoutes.name, route.name),
          ),
        )
        .limit(1);
      const requirements = route as unknown as Record<string, unknown>;

      if (existing === undefined) {
        await tx.insert(schema.vendorRoutes).values({
          vendorId,
          name: route.name,
          type: route.type,
          requirements,
          active: true,
          builtIn: true,
          sourceUrl: route.sourceUrl ?? null,
          sourceReviewedAt: route.sourceReviewedAt ?? null,
        });
      } else if (existing.builtIn && existing.builtInModifiedAt === null) {
        await tx
          .update(schema.vendorRoutes)
          .set({
            type: route.type,
            requirements,
            active: true,
            sourceUrl: route.sourceUrl ?? null,
            sourceReviewedAt: route.sourceReviewedAt ?? null,
            updatedAt: sql`now()`,
          })
          .where(eq(schema.vendorRoutes.id, existing.id));
      }
    }
  });
}
