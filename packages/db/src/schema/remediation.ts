import { index, pgTable, text, uuid } from "drizzle-orm/pg-core";

import { users } from "./auth.js";
import { createdAt, revision, timestampColumn, updatedAt } from "./columns.js";
import { findings } from "./findings.js";

export const remediationSlas = pgTable(
  "remediation_slas",
  {
    findingId: uuid("finding_id")
      .primaryKey()
      .references(() => findings.id, { onDelete: "cascade" }),
    startedAt: timestampColumn("started_at").notNull(),
    targetAt: timestampColumn("target_at").notNull(),
    note: text("note"),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    updatedBy: uuid("updated_by")
      .notNull()
      .references(() => users.id),
    revision: revision(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [index("remediation_slas_target_idx").on(table.targetAt)],
);
