import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { expect, test } from "vitest";

const DOCKER_COMPOSE_COMMAND_TIMEOUT_MS = 15_000;
const DOCKER_COMPOSE_TEST_TIMEOUT_MS = 20_000;

test(
  "services with published ports also use a host-accessible network",
  () => {
    const composeFile = fileURLToPath(
      new URL("../infra/docker-compose.yml", import.meta.url),
    );
    const rendered = JSON.parse(
      execFileSync(
        "docker",
        ["compose", "-f", composeFile, "config", "--format", "json"],
        { encoding: "utf8", timeout: DOCKER_COMPOSE_COMMAND_TIMEOUT_MS },
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
  },
  DOCKER_COMPOSE_TEST_TIMEOUT_MS,
);

test(
  "the production stack exposes only the loopback API and uses hardened application containers",
  () => {
    const composeFile = fileURLToPath(
      new URL("../infra/compose.production.yml", import.meta.url),
    );
    const secretDirectory = mkdtempSync(join(tmpdir(), "codevault-compose-"));
    const digest = `sha256:${"0".repeat(64)}`;
    const rendered = JSON.parse(
      execFileSync(
        "docker",
        ["compose", "-f", composeFile, "config", "--format", "json"],
        {
          encoding: "utf8",
          timeout: DOCKER_COMPOSE_COMMAND_TIMEOUT_MS,
          env: {
            ...process.env,
            CODEVAULT_SECRETS_DIR: secretDirectory,
            CODEVAULT_SERVER_IMAGE: `ghcr.io/codevault-llc/security/server@${digest}`,
            CODEVAULT_WORKER_IMAGE: `ghcr.io/codevault-llc/security/worker@${digest}`,
            CODEVAULT_MEDIA_WORKER_IMAGE: `ghcr.io/codevault-llc/security/media-worker@${digest}`,
          },
        },
      ),
    ) as {
      services: Record<
        string,
        {
          cap_drop?: string[];
          image?: string;
          ports?: Array<{ host_ip?: string; published?: string }>;
          read_only?: boolean;
          security_opt?: string[];
        }
      >;
    };

    const published = Object.entries(rendered.services).filter(
      ([, service]) => (service.ports?.length ?? 0) > 0,
    );
    expect(published.map(([name]) => name)).toEqual(["server"]);
    expect(published[0]?.[1].ports?.[0]?.host_ip).toBe("127.0.0.1");

    for (const name of ["server", "worker", "media-worker"]) {
      const service = rendered.services[name];
      expect(
        service?.read_only,
        `${name} must use a read-only root filesystem`,
      ).toBe(true);
      expect(
        service?.cap_drop,
        `${name} must drop Linux capabilities`,
      ).toContain("ALL");
      expect(
        service?.security_opt,
        `${name} must set no-new-privileges`,
      ).toContain("no-new-privileges:true");
      expect(
        service?.image,
        `${name} must use an immutable image digest`,
      ).toContain("@sha256:");
    }
  },
  DOCKER_COMPOSE_TEST_TIMEOUT_MS,
);
