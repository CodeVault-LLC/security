import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";

import { sql } from "drizzle-orm";

import { createDatabase, schema } from "@codevault/db";

import {
  hashPassword,
  WeakPasswordError,
} from "../apps/server/src/auth/password.js";

/**
 * Administrator bootstrap.
 *
 * The only way the first account comes into existence. There is no public
 * registration route, and this script is deliberately a local CLI: creating an
 * administrator requires database access, not an HTTP request.
 *
 *   bun run admin:create --email admin@codevault.example --name "CodeVault Admin"
 */

interface Arguments {
  email: string;
  name: string;
}

function parseArguments(argv: readonly string[]): Arguments | null {
  const values = new Map<string, string>();

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];

    if (token === undefined || !token.startsWith("--")) {
      continue;
    }

    const key = token.slice(2);
    const value = argv[index + 1];

    if (value === undefined || value.startsWith("--")) {
      continue;
    }

    values.set(key, value);
    index += 1;
  }

  const email = values.get("email");
  const name = values.get("name");

  if (email === undefined || name === undefined) {
    return null;
  }

  return { email, name };
}

/**
 * Reads a password without echoing it.
 *
 * Node has no built-in hidden prompt, so the TTY is put into raw mode and the
 * keystrokes are collected directly. The password is never passed as an
 * argument, which would put it in the shell history and the process list.
 */
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

    const onData = (chunk: Buffer): void => {
      const input = chunk.toString("utf8");

      for (const character of input) {
        if (character === "\r" || character === "\n") {
          cleanup();
          stdout.write("\n");
          resolve(value);

          return;
        }

        if (character === "") {
          cleanup();
          reject(new Error("Cancelled."));

          return;
        }

        if (character === "" || character === "\b") {
          value = value.slice(0, -1);
          continue;
        }

        value += character;
      }
    };

    const cleanup = (): void => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.off("data", onData);
    };

    stdin.on("data", onData);
  });
}

async function main(): Promise<void> {
  const parsed = parseArguments(process.argv.slice(2));

  if (parsed === null) {
    console.error(
      'Usage: bun run admin:create --email <address> --name "<display name>"',
    );
    process.exitCode = 1;

    return;
  }

  const connectionString = process.env.DATABASE_URL;

  if (connectionString === undefined || connectionString.length === 0) {
    console.error("DATABASE_URL is not set.");
    process.exitCode = 1;

    return;
  }

  const password =
    process.env.CODEVAULT_ADMIN_PASSWORD ?? (await promptHidden("Password: "));

  if (process.env.CODEVAULT_ADMIN_PASSWORD === undefined) {
    const confirmation = await promptHidden("Confirm password: ");

    if (confirmation !== password) {
      console.error("The passwords did not match.");
      process.exitCode = 1;

      return;
    }
  }

  let passwordHash: string;

  try {
    passwordHash = await hashPassword(password);
  } catch (error: unknown) {
    if (error instanceof WeakPasswordError) {
      console.error(error.message);
      process.exitCode = 1;

      return;
    }

    throw error;
  }

  const handle = createDatabase({ connectionString });

  try {
    const existing = await handle.db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(sql`lower(${schema.users.email}) = lower(${parsed.email})`)
      .limit(1);

    if (existing.length > 0) {
      console.error(`An account already exists for ${parsed.email}.`);
      process.exitCode = 1;

      return;
    }

    const [created] = await handle.db
      .insert(schema.users)
      .values({
        email: parsed.email,
        displayName: parsed.name,
        passwordHash,
        role: "ADMIN",
      })
      .returning({ id: schema.users.id });

    if (created === undefined) {
      console.error("Could not create the administrator.");
      process.exitCode = 1;

      return;
    }

    await handle.db.insert(schema.auditEvents).values({
      action: "user.bootstrapped",
      entityType: "user",
      entityId: created.id,
      actorId: created.id,
      after: { email: parsed.email, role: "ADMIN", via: "admin:create" },
    });

    console.warn(`Created administrator ${parsed.email}.`);
  } finally {
    await handle.close();
  }
}

await main();
