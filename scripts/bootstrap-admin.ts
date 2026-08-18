import { randomBytes } from "node:crypto";
import { stdin, stderr, stdout } from "node:process";
import { createInterface } from "node:readline/promises";
import { pathToFileURL } from "node:url";

import { sql } from "drizzle-orm";

import { uuidv7 } from "@codevault/core/crypto";
import { createDatabase, schema, type Database } from "@codevault/db";

import { hashPassword } from "../apps/server/src/auth/password.js";
import {
  parseMfaKeyring,
  type SecretKeyring,
} from "../apps/server/src/auth/secret-keyring.js";
import {
  createTotpEnrollment,
  type TotpEnrollment,
  validateTotpAt,
} from "../apps/server/src/auth/totp.js";

export interface BootstrapArguments {
  organization: string;
  email: string;
  name: string;
  allowNoninteractiveSecretOutput: boolean;
}

export interface BootstrapInput {
  organization: string;
  email: string;
  name: string;
  password: string;
  totpToken: string;
  keyring: SecretKeyring;
  enrollment: TotpEnrollment;
  now?: Date;
}

export interface BootstrapResult {
  organizationId: string;
  userId: string;
  recoveryCodes: string[];
}

export class BootstrapError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BootstrapError";
  }
}

export function assertSecretOutputIsSafe(
  outputIsTty: boolean | undefined,
  allowNoninteractiveSecretOutput: boolean,
): void {
  if (outputIsTty !== true && !allowNoninteractiveSecretOutput) {
    throw new BootstrapError(
      "Refusing to print enrollment secrets without --allow-noninteractive-secret-output.",
    );
  }
}

export function parseArguments(
  argv: readonly string[],
): BootstrapArguments | null {
  const values = new Map<string, string>();
  let allowNoninteractiveSecretOutput = false;

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--allow-noninteractive-secret-output") {
      allowNoninteractiveSecretOutput = true;
      continue;
    }
    if (token === undefined || !token.startsWith("--")) return null;
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) return null;
    values.set(token.slice(2), value);
    index += 1;
  }

  const organization = values.get("organization")?.trim();
  const email = values.get("email")?.trim().toLowerCase();
  const name = values.get("name")?.trim();
  if (
    organization === undefined ||
    organization.length < 2 ||
    organization.length > 120 ||
    email === undefined ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
    name === undefined ||
    name.length < 1 ||
    name.length > 120
  ) {
    return null;
  }

  return { organization, email, name, allowNoninteractiveSecretOutput };
}

function generateRecoveryCodes(): string[] {
  return Array.from({ length: 10 }, () =>
    randomBytes(16).toString("base64url"),
  );
}

export async function bootstrapOrganization(
  db: Database,
  input: BootstrapInput,
): Promise<BootstrapResult> {
  const organizationName = input.organization.trim();
  const displayName = input.name.trim();
  const email = input.email.trim().toLowerCase();
  if (organizationName.length < 2 || organizationName.length > 120) {
    throw new BootstrapError(
      "Organization name must contain 2 to 120 characters.",
    );
  }
  if (displayName.length === 0 || displayName.length > 120) {
    throw new BootstrapError("Administrator name is invalid.");
  }

  const now = input.now ?? new Date();
  const acceptedCounter = validateTotpAt(
    input.enrollment.manualSecret,
    input.totpToken,
    now.getTime(),
  );
  if (acceptedCounter === null) {
    throw new BootstrapError("The authenticator code was not accepted.");
  }

  const passwordHash = await hashPassword(input.password);
  const organizationId = uuidv7();
  const userId = uuidv7();
  const credentialId = uuidv7();
  const recoveryCodes = generateRecoveryCodes();
  const envelope = input.keyring.encrypt(
    input.enrollment.manualSecret,
    `totp:${credentialId}:${userId}`,
  );

  await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(1129270868, 2)`);
    const existing = await tx
      .select({ id: schema.organizations.id })
      .from(schema.organizations)
      .limit(1);
    if (existing.length > 0) {
      throw new BootstrapError("An organization already exists.");
    }

    await tx.insert(schema.organizations).values({
      id: organizationId,
      name: organizationName,
    });
    await tx
      .insert(schema.organizationSecurityPolicies)
      .values({ organizationId });
    await tx.insert(schema.users).values({
      id: userId,
      email,
      displayName,
      passwordHash,
    });
    await tx.insert(schema.organizationMemberships).values({
      organizationId,
      userId,
      role: "ADMIN",
    });
    await tx.insert(schema.totpCredentials).values({
      id: credentialId,
      userId,
      keyId: envelope.keyId,
      nonce: envelope.nonce,
      ciphertext: envelope.ciphertext,
      authTag: envelope.authTag,
      lastAcceptedCounter: acceptedCounter,
    });
    await tx.insert(schema.mfaRecoveryCodes).values(
      recoveryCodes.map((code) => ({
        userId,
        keyId: input.keyring.activeKeyId,
        digest: input.keyring.digestRecoveryCode(code),
      })),
    );
    await tx.insert(schema.auditEvents).values({
      organizationId,
      action: "organization.bootstrapped",
      entityType: "organization",
      entityId: organizationId,
      actorId: userId,
      after: { administratorId: userId, via: "admin:create" },
    });
  });

  return { organizationId, userId, recoveryCodes };
}

async function promptHidden(prompt: string): Promise<string> {
  if (!stdin.isTTY) {
    const reader = createInterface({ input: stdin, output: stdout });
    try {
      return await reader.question(prompt);
    } finally {
      reader.close();
    }
  }
  stdout.write(prompt);
  stdin.setRawMode(true);
  stdin.resume();
  return new Promise<string>((resolve, reject) => {
    let value = "";
    const cleanup = (): void => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.off("data", onData);
    };
    const onData = (chunk: Buffer): void => {
      for (const character of chunk.toString("utf8")) {
        if (character === "\r" || character === "\n") {
          cleanup();
          stdout.write("\n");
          resolve(value);
          return;
        }
        if (character === "\u0003") {
          cleanup();
          reject(new Error("Cancelled."));
          return;
        }
        if (character === "\u007f" || character === "\b") {
          value = value.slice(0, -1);
        } else {
          value += character;
        }
      }
    };
    stdin.on("data", onData);
  });
}

async function main(): Promise<void> {
  const parsed = parseArguments(process.argv.slice(2));
  if (parsed === null) {
    console.error(
      'Usage: bun run admin:create --organization "<name>" --email <address> --name "<display name>"',
    );
    process.exitCode = 1;
    return;
  }
  const connectionString = process.env.DATABASE_URL;
  const rawKeys = process.env.MFA_ENCRYPTION_KEYS;
  if (!connectionString || !rawKeys) {
    console.error("DATABASE_URL and MFA_ENCRYPTION_KEYS must be set.");
    process.exitCode = 1;
    return;
  }

  assertSecretOutputIsSafe(
    stderr.isTTY,
    parsed.allowNoninteractiveSecretOutput,
  );

  const password = await promptHidden("Password: ");
  if ((await promptHidden("Confirm password: ")) !== password) {
    console.error("The passwords did not match.");
    process.exitCode = 1;
    return;
  }
  const enrollment = createTotpEnrollment(parsed.organization, parsed.email);
  console.warn(`Manual authenticator secret: ${enrollment.manualSecret}`);
  console.warn(`Provisioning URI: ${enrollment.provisioningUri}`);
  const totpToken = await promptHidden("Authenticator code: ");
  const handle = createDatabase({ connectionString });
  try {
    const result = await bootstrapOrganization(handle.db, {
      ...parsed,
      password,
      totpToken,
      keyring: parseMfaKeyring(rawKeys),
      enrollment,
    });
    console.warn("Recovery codes (shown once):");
    for (const code of result.recoveryCodes) console.warn(code);
    console.warn(`Created administrator ${parsed.email}.`);
  } finally {
    await handle.close();
  }
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) await main();
