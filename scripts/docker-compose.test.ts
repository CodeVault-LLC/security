import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { expect, test } from "vitest";

test("services with published ports also use a host-accessible network", () => {
  const composeFile = fileURLToPath(
    new URL("../infra/docker-compose.yml", import.meta.url),
  );
  const rendered = JSON.parse(
    execFileSync(
      "docker",
      ["compose", "-f", composeFile, "config", "--format", "json"],
      { encoding: "utf8" },
    ),
  ) as {
    networks: Record<string, { internal?: boolean }>;
    services: Record<
      string,
      { networks?: Record<string, unknown>; ports?: unknown[] }
    >;
  };
  const internalNetworks = new Set(
    Object.entries(rendered.networks)
      .filter(([, network]) => network.internal === true)
      .map(([name]) => name),
  );

  for (const [name, service] of Object.entries(rendered.services)) {
    if ((service.ports?.length ?? 0) === 0) continue;

    const attachedNetworks = Object.keys(service.networks ?? {});
    expect(
      attachedNetworks.some((network) => !internalNetworks.has(network)),
      `${name} publishes ports but only uses internal networks`,
    ).toBe(true);
  }
});
