import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

/**
 * Downloads the Electron binary.
 *
 * Electron 43 no longer ships a postinstall script — the platform binary is
 * fetched by an explicit `install-electron` command instead. Without it,
 * `electron-vite dev` fails with the unhelpful message "Electron uninstall",
 * so this runs from the repository's own postinstall.
 *
 * A failure here is reported but does not fail the install. It is a ~220 MB
 * download, and someone working on the server, the worker or the domain
 * packages should not be blocked by an offline or rate-limited mirror.
 */

const require = createRequire(join(process.cwd(), "apps/desktop/package.json"));

function electronDirectory(): string | null {
  try {
    return dirname(require.resolve("electron/package.json"));
  } catch {
    return null;
  }
}

function main(): void {
  const directory = electronDirectory();

  if (directory === null) {
    console.warn(
      "[electron] The electron package is not installed; skipping the binary download.",
    );

    return;
  }

  if (existsSync(join(directory, "dist", "electron"))) {
    return;
  }

  console.warn("[electron] Downloading the Electron binary…");

  const result = spawnSync(process.execPath, [join(directory, "install.js")], {
    stdio: "inherit",
    cwd: directory,
  });

  if (result.status === 0) {
    return;
  }

  console.warn(
    "[electron] The download did not complete. The desktop client will not " +
      "start until it does; re-run `bun run electron:install`. Everything " +
      "else in the repository works without it.",
  );
}

main();
