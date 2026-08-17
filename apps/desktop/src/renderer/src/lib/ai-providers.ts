import {
  AI_PROVIDER_CAPABILITIES,
  type AiProviderStatus,
} from "@codevault/contracts";

/** Normalizes local-provider data crossing the Electron process boundary. */
export function normalizeAiProviderStatuses(
  statuses: readonly AiProviderStatus[],
): AiProviderStatus[] {
  return statuses.map((provider) => {
    const capabilities = AI_PROVIDER_CAPABILITIES[provider.providerId];

    return {
      ...provider,
      models: Array.isArray(provider.models)
        ? provider.models
        : [...capabilities.models],
      efforts: Array.isArray(provider.efforts)
        ? provider.efforts
        : [...capabilities.efforts],
      defaultModel: provider.defaultModel ?? capabilities.defaultModel,
    };
  });
}
