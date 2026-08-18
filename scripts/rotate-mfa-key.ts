import { pathToFileURL } from "node:url";

import { and, eq, isNull, ne } from "drizzle-orm";

import { createDatabase, schema } from "@codevault/db";

import { parseMfaKeyring } from "../apps/server/src/auth/secret-keyring.js";

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  const rawKeys = process.env.MFA_ENCRYPTION_KEYS;
  if (!connectionString || !rawKeys) {
    throw new Error("Required configuration is missing.");
  }
  const keyring = parseMfaKeyring(rawKeys);
  const dryRun = process.argv.includes("--dry-run");
  const handle = createDatabase({ connectionString });
  let rotated = 0;
  try {
    for (;;) {
      const rows = await handle.db
        .select()
        .from(schema.totpCredentials)
        .where(
          and(
            isNull(schema.totpCredentials.replacedAt),
            ne(schema.totpCredentials.keyId, keyring.activeKeyId),
          ),
        )
        .limit(100);
      if (rows.length === 0) break;
      if (dryRun) {
        console.warn(`${rows.length} credential(s) require rotation.`);
        break;
      }
      for (const row of rows) {
        const aad = `totp:${row.id}:${row.userId}`;
        const plaintext = keyring.decrypt(row, aad);
        const next = keyring.encrypt(plaintext, aad);
        const changed = await handle.db
          .update(schema.totpCredentials)
          .set(next)
          .where(
            and(
              eq(schema.totpCredentials.id, row.id),
              eq(schema.totpCredentials.keyId, row.keyId),
            ),
          )
          .returning({ id: schema.totpCredentials.id });
        rotated += changed.length;
        plaintext.fill(0);
      }
    }
    console.warn(
      `${dryRun ? "Dry run" : "Rotation"} complete: ${rotated} credential(s) changed.`,
    );
  } finally {
    await handle.close();
  }
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) await main();
