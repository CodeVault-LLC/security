import { boolean, index, pgTable, text, uuid } from "drizzle-orm/pg-core";

import { users } from "./auth.js";
import { createdAt, revision, timestampColumn, updatedAt } from "./columns.js";
import { findings } from "./findings.js";

export const intelligenceRefreshPolicies = pgTable(
  "intelligence_refresh_policies",
  {
    findingId: uuid("finding_id")
      .primaryKey()
      .references(() => findings.id, { onDelete: "cascade" }),
    cadence: text("cadence").$type<"DAILY" | "WEEKLY">().notNull(),
    enabled: boolean("enabled").notNull().default(true),
    lastQueuedAt: timestampColumn("last_queued_at"),
    nextRunAt: timestampColumn("next_run_at"),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    revision: revision(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    index("intelligence_refresh_policies_due_idx").on(
      table.enabled,
      table.nextRunAt,
    ),
  ],
);
