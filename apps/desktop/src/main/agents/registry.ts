import type { AiProviderStatus } from "@codevault/contracts";

import { createClaudeCodeProvider } from "./claude-code.js";
import { createCodexCliProvider } from "./codex-cli.js";
import type { LocalAiProvider } from "./types.js";

/**
 * Provider registry.
 *
 * A fixed list, resolved at startup. New providers are added here in a reviewed
 * commit — there is no configuration path that turns an arbitrary executable
 * into an AI provider, because that would be a general-purpose command runner
 * wearing a different name.
 */

export interface RegistryOptions {
  /** Explicit executable paths, resolved once in settings. */
  executablePaths?: Record<string, string>;
}

export interface ProviderRegistry {
  list(): LocalAiProvider[];
  get(id: string): LocalAiProvider | null;
  statuses(): Promise<AiProviderStatus[]>;
}

export function createProviderRegistry(
  options: RegistryOptions = {},
): ProviderRegistry {
  const claudePath = options.executablePaths?.["claude-code"];
  const codexPath = options.executablePaths?.["codex-cli"];
  const providers: LocalAiProvider[] = [
    createClaudeCodeProvider(
      claudePath === undefined ? {} : { executablePath: claudePath },
    ),
    createCodexCliProvider(
      codexPath === undefined ? {} : { executablePath: codexPath },
    ),
  ];

  return {
    list() {
      return providers;
    },

    get(id) {
      return providers.find((provider) => provider.id === id) ?? null;
    },

    async statuses() {
      const results: AiProviderStatus[] = [];

      for (const provider of providers) {
        const detection = await provider.detect();

        results.push({
          providerId: provider.id,
          displayName: provider.displayName,
          available: detection.available,
          version: detection.version ?? null,
          executablePath: detection.executable ?? null,
          detail: detection.detail ?? null,
          models: [...provider.models],
          efforts: [...provider.efforts],
          defaultModel: provider.defaultModel,
        });
      }

      return results;
    },
  };
}
