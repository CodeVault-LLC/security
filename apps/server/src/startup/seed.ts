import { sql } from "drizzle-orm";

import { BUILT_IN_POLICY_PACKS } from "@codevault/core";
import type { Database } from "@codevault/db";
import { schema } from "@codevault/db";
import { BUILT_IN_TEMPLATES } from "@codevault/reporting";

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
}
