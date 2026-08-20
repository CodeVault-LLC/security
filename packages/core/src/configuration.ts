import { readFileSync, statSync } from "node:fs";

const MAX_SECRET_BYTES = 64 * 1024;

export class SecretConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SecretConfigurationError";
  }
}

export type ConfigurationEnvironment = Record<string, string | undefined>;

function present(value: string | undefined): value is string {
  return value !== undefined && value.trim().length > 0;
}

export function readSecretSetting(
  environment: ConfigurationEnvironment,
  name: string,
): string | undefined {
  const direct = environment[name];
  const fileVariable = `${name}_FILE`;
  const file = environment[fileVariable];

  if (present(direct) && present(file)) {
    throw new SecretConfigurationError(
      `Set either ${name} or ${fileVariable}, not both.`,
    );
  }

  if (!present(file)) return direct;

  try {
    const metadata = statSync(file);
    if (!metadata.isFile()) {
      throw new SecretConfigurationError(
        `${fileVariable} must name a regular file.`,
      );
    }
    if (metadata.size > MAX_SECRET_BYTES) {
      throw new SecretConfigurationError(
        `${fileVariable} exceeds ${MAX_SECRET_BYTES} bytes.`,
      );
    }

    const value = readFileSync(file, "utf8").replace(/(?:\r\n|\n)$/u, "");
    if (value.length === 0) {
      throw new SecretConfigurationError(`${fileVariable} is empty.`);
    }
    if (value.includes("\0")) {
      throw new SecretConfigurationError(
        `${fileVariable} contains a NUL byte.`,
      );
    }

    return value;
  } catch (error: unknown) {
    if (error instanceof SecretConfigurationError) throw error;
    throw new SecretConfigurationError(
      `Cannot read ${fileVariable}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export function resolveSecretSettings(
  environment: ConfigurationEnvironment,
  names: readonly string[],
): ConfigurationEnvironment {
  const resolved = { ...environment };

  for (const name of names) {
    const value = readSecretSetting(environment, name);
    if (value !== undefined) resolved[name] = value;
  }

  return resolved;
}
