import type { AiEffort, AiModelId, AiProviderId } from "@codevault/contracts";
import { AI_PROVIDER_CAPABILITIES } from "@codevault/contracts";

import { ProviderPolicyError } from "./context.js";

export interface AiProviderDefinition {
  id: AiProviderId;
  displayName: string;
  models: readonly AiModelId[];
  efforts: readonly AiEffort[];
  defaultModel: AiModelId;
}

export const AI_PROVIDER_DEFINITIONS: Readonly<
  Record<AiProviderId, AiProviderDefinition>
> = {
  "claude-code": {
    id: "claude-code",
    ...AI_PROVIDER_CAPABILITIES["claude-code"],
  },
  "codex-cli": {
    id: "codex-cli",
    ...AI_PROVIDER_CAPABILITIES["codex-cli"],
  },
};

export function providerDefinition(providerId: string): AiProviderDefinition {
  if (providerId === "claude-code" || providerId === "codex-cli") {
    return AI_PROVIDER_DEFINITIONS[providerId];
  }

  throw new ProviderPolicyError(
    `No reviewed local AI provider named "${providerId}" exists.`,
  );
}

export function assertProviderModel(
  providerId: string,
  model: AiModelId,
): AiModelId {
  const definition = providerDefinition(providerId);

  if (!definition.models.includes(model)) {
    throw new ProviderPolicyError(
      `${model} is not a model supported by ${definition.displayName}.`,
    );
  }

  return model;
}

export function assertProviderEffort(
  providerId: string,
  effort: AiEffort,
): AiEffort {
  const definition = providerDefinition(providerId);

  if (!definition.efforts.includes(effort)) {
    throw new ProviderPolicyError(
      `Effort "${effort}" is not supported by ${definition.displayName}.`,
    );
  }

  return effort;
}
