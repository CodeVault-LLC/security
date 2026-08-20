import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  readSecretSetting,
  resolveSecretSettings,
  SecretConfigurationError,
} from "./configuration.js";

function secretFile(contents: string): string {
  const directory = mkdtempSync(join(tmpdir(), "codevault-secret-"));
  const path = join(directory, "value");
  writeFileSync(path, contents, { mode: 0o600 });
  return path;
}

describe("secret-backed configuration", () => {
  it("reads a Docker secret and removes one trailing newline", () => {
    const path = secretFile("secret value\n");

    expect(readSecretSetting({ API_KEY_FILE: path }, "API_KEY")).toBe(
      "secret value",
    );
  });

  it("refuses ambiguous direct and file-backed values", () => {
    const path = secretFile("from file");

    expect(() =>
      readSecretSetting({ API_KEY: "direct", API_KEY_FILE: path }, "API_KEY"),
    ).toThrow(SecretConfigurationError);
  });

  it("does not mutate the caller's environment", () => {
    const path = secretFile("from file");
    const environment = { API_KEY_FILE: path };

    const resolved = resolveSecretSettings(environment, ["API_KEY"]);

    expect(resolved.API_KEY).toBe("from file");
    expect(environment).not.toHaveProperty("API_KEY");
  });

  it("refuses empty secret files", () => {
    const path = secretFile("");

    expect(() => readSecretSetting({ API_KEY_FILE: path }, "API_KEY")).toThrow(
      "API_KEY_FILE is empty",
    );
  });
});
