import {
  AI_PROVIDER_CAPABILITIES,
  type AiProviderPolicy,
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

/** Providers that can run from this device under the organization policy. */
export function configuredAiProviderStatuses(
  statuses: readonly AiProviderStatus[],
  policies: readonly AiProviderPolicy[],
): AiProviderStatus[] {
  return statuses.filter((provider) => {
    if (!provider.available) return false;

    const policy = policies.find(
      (item) => item.providerId === provider.providerId,
    );

    return (
      policy?.enabled === true &&
      policy.allowedModels.length > 0 &&
      policy.allowedEfforts.length > 0
    );
  });
}
