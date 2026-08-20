import { randomBytes } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const REPOSITORY_ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));

function randomPassword(): string {
  return randomBytes(32).toString("base64url");
}

function accessKey(prefix: string): string {
  return `${prefix}-${randomBytes(10).toString("hex")}`;
}

function postgresUrl(user: string, password: string): string {
  return `postgres://${encodeURIComponent(user)}:${encodeURIComponent(password)}@postgres:5432/codevault`;
}

export function buildProductionSecrets(): Record<string, string> {
  const migratorPassword = randomPassword();
  const appPassword = randomPassword();
  const mediaPassword = randomPassword();

  return {
    postgres_admin_password: randomPassword(),
    database_migrator_password: migratorPassword,
    database_app_password: appPassword,
    media_database_password: mediaPassword,
    database_migrator_url: postgresUrl("codevault_migrator", migratorPassword),
    database_url: postgresUrl("codevault_app", appPassword),
    media_database_url: postgresUrl("codevault_media_login", mediaPassword),
    mfa_encryption_keys: `v1:${randomBytes(32).toString("base64")}`,
    minio_root_user: accessKey("cv-root"),
    minio_root_password: randomPassword(),
    s3_access_key_id: accessKey("cv-app"),
    s3_secret_access_key: randomPassword(),
    media_s3_access_key_id: accessKey("cv-media"),
    media_s3_secret_access_key: randomPassword(),
  };
}

function targetIsInsideRepository(target: string): boolean {
  const path = relative(REPOSITORY_ROOT, target);
  return path === "" || (!path.startsWith(`..${sep}`) && path !== "..");
}

export function writeProductionSecrets(targetDirectory: string): number {
  const target = resolve(targetDirectory);
  if (targetIsInsideRepository(target)) {
    throw new Error(
      "The production secret directory must be outside the repository.",
    );
  }

  if (existsSync(target)) {
    if (readdirSync(target).length > 0) {
      throw new Error(`Refusing to overwrite non-empty directory ${target}.`);
    }
    chmodSync(target, 0o700);
  } else {
    mkdirSync(target, { mode: 0o700, recursive: true });
  }

  const secrets = buildProductionSecrets();
  for (const [name, value] of Object.entries(secrets)) {
    writeFileSync(resolve(target, name), `${value}\n`, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
  }

  return Object.keys(secrets).length;
}

function main(): void {
  const target = process.argv[2];
  if (target === undefined) {
    throw new Error(
      "Usage: create-production-secrets.ts /absolute/path/to/codevault-secrets",
    );
  }

  const count = writeProductionSecrets(target);
  console.warn(`Wrote ${count} secret files with mode 0600.`);
  console.warn("Back up the directory in an encrypted secret store.");
}

if (import.meta.main) main();
