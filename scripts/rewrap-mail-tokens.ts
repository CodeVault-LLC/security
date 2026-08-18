import { eq } from "drizzle-orm";

import { createDatabase, schema } from "@codevault/db";
import { loadConfig } from "@codevault/server/config";
import {
  decryptSecret,
  encryptSecret,
} from "@codevault/server/mail/token-crypto";

import { createAuditWriter } from "../apps/server/src/services/audit.js";

const config = loadConfig();
if (!config.gmail.enabled) {
  throw new Error(
    "Gmail must be enabled with the full token keyring before rewrapping.",
  );
}

const handle = createDatabase({
  connectionString: config.database.connectionString,
  maxConnections: 2,
  ssl: config.database.ssl,
});
const audit = createAuditWriter();

try {
  const rows = await handle.db.query.mailboxConnections.findMany({
    where: (connections, { eq }) => eq(connections.provider, "gmail"),
  });
  let changed = 0;

  for (const row of rows) {
    if (row.tokenKeyVersion === config.gmail.tokenKeyring.activeVersion)
      continue;
    const context = {
      provider: row.provider,
      connectionId: row.id,
      userId: row.userId,
    };
    const refreshToken = decryptSecret(
      {
        ciphertext: row.refreshTokenCiphertext,
        nonce: row.refreshTokenNonce,
        authTag: row.refreshTokenAuthTag,
        keyVersion: row.tokenKeyVersion,
      },
      config.gmail.tokenKeyring,
      context,
    );
    const envelope = encryptSecret(
      refreshToken,
      config.gmail.tokenKeyring,
      context,
    );

    await handle.db.transaction(async (tx) => {
      await tx
        .update(schema.mailboxConnections)
        .set({
          refreshTokenCiphertext: envelope.ciphertext,
          refreshTokenNonce: envelope.nonce,
          refreshTokenAuthTag: envelope.authTag,
          tokenKeyVersion: envelope.keyVersion,
          updatedAt: new Date().toISOString(),
          revision: row.revision + 1,
        })
        .where(eq(schema.mailboxConnections.id, row.id));
      await audit.write(
        tx,
        { actorId: null, sessionId: null, requestId: null },
        {
          action: "mailbox.token_rewrapped",
          entityType: "mailbox_connection",
          entityId: row.id,
          before: { tokenKeyVersion: row.tokenKeyVersion },
          after: { tokenKeyVersion: envelope.keyVersion },
        },
      );
    });
    changed += 1;
  }

  console.warn(`Rewrapped ${changed} Gmail token envelope(s).`);
} finally {
  await handle.close();
}
