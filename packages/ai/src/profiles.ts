import type {
  AiEffort,
  AiModelId,
  AiProviderId,
  AiRunProfile,
  AiSettingSource,
  AiToolPolicy,
} from "@codevault/contracts";

import { aiAction } from "./actions.js";
import { ProviderPolicyError } from "./context.js";
import { assertProviderEffort, assertProviderModel } from "./providers.js";

import type { AiActionId } from "@codevault/contracts";

/**
 * Run profile resolution.
 *
 * Decides the model, the reasoning depth, the tool capability and the settings
 * scope for one run. It runs on the server, before the prompt leaves it, for
 * the same reason context filtering does: the side that owns the data owns the
 * decision about how it is processed.
 *
 * Three inputs, narrowest last — the action's declared needs, the workspace
 * policy, and the researcher's preference. A preference outside the policy is
 * an error rather than a silent downgrade.
 */

/** Longest a run may take before the provider is stopped. */
const DEFAULT_TIMEOUT_MS = 300_000;

export interface ProviderProfilePolicy {
  allowedModels: readonly AiModelId[];
  allowedEfforts: readonly AiEffort[];
  defaultModel: AiModelId | null;
  settingSources: readonly AiSettingSource[];
  isolated: boolean;
  maxBudgetUsd: number | null;
}

export interface RunProfileOverride {
  model?: AiModelId;
  effort?: AiEffort;
  timeoutMs?: number;
}

export function resolveRunProfile(
  providerId: AiProviderId,
  action: AiActionId,
  policy: ProviderProfilePolicy,
  override: RunProfileOverride = {},
): AiRunProfile {
  const definition = aiAction(action);

  return {
    model: resolveModel(providerId, policy, override.model),
    effort: resolveEffort(
      providerId,
      policy,
      override.effort,
      definition.defaultEffort,
    ),
    // Never overridable, by the researcher or by policy. What an action needs
    // to reach for is a property of the action, and widening it is a code
    // change in a reviewed commit rather than a setting.
    toolPolicy: definition.toolPolicy satisfies AiToolPolicy,
    settingSources: [...policy.settingSources],
    isolated: policy.isolated,
    maxBudgetUsd: policy.maxBudgetUsd,
    timeoutMs: clampTimeout(override.timeoutMs),
  };
}

function resolveModel(
  providerId: AiProviderId,
  policy: ProviderProfilePolicy,
  requested: AiModelId | undefined,
): AiModelId {
  if (policy.allowedModels.length === 0) {
    // An empty allow-list is not "any model"; it is a provider an administrator
    // has not finished configuring. Treating it as permissive would make
    // forgetting to choose a model the same as approving every model.
    throw new ProviderPolicyError(
      "No models are allow-listed for this provider. " +
        "An administrator must choose one in Settings before AI actions can run.",
    );
  }

  for (const model of policy.allowedModels) {
    assertProviderModel(providerId, model);
  }

  if (requested !== undefined) {
    assertProviderModel(providerId, requested);
    if (!policy.allowedModels.includes(requested)) {
      throw new ProviderPolicyError(
        `${requested} is not allow-listed for this provider.`,
      );
    }

    return requested;
  }

  if (policy.defaultModel !== null) {
    assertProviderModel(providerId, policy.defaultModel);
    if (!policy.allowedModels.includes(policy.defaultModel)) {
      // The default was removed from the allow-list without being replaced.
      // Falling through to the first allowed model would run something the
      // administrator did not choose, so this is an error.
      throw new ProviderPolicyError(
        `The default model ${policy.defaultModel} is no longer allow-listed for this provider.`,
      );
    }

    return policy.defaultModel;
  }

  const first = policy.allowedModels[0];

  if (first === undefined) {
    throw new ProviderPolicyError(
      "No models are allow-listed for this provider.",
    );
  }

  return assertProviderModel(providerId, first);
}

function resolveEffort(
  providerId: AiProviderId,
  policy: ProviderProfilePolicy,
  requested: AiEffort | undefined,
  actionDefault: AiEffort,
): AiEffort {
  if (policy.allowedEfforts.length === 0) {
    throw new ProviderPolicyError(
      "No effort levels are allow-listed for this provider. " +
        "An administrator must choose at least one in Settings.",
    );
  }

  for (const effort of policy.allowedEfforts) {
    assertProviderEffort(providerId, effort);
  }

  if (requested !== undefined) {
    assertProviderEffort(providerId, requested);
    if (!policy.allowedEfforts.includes(requested)) {
      throw new ProviderPolicyError(
        `Effort "${requested}" is not allow-listed for this provider.`,
      );
    }

    return requested;
  }

  if (policy.allowedEfforts.includes(actionDefault)) {
    return assertProviderEffort(providerId, actionDefault);
  }

  // The action wants more thinking than the workspace permits. Take the
  // highest level that is allowed rather than failing: the researcher gets a
  // shallower answer, which is the workspace's stated choice, and the run
  // records what actually happened.
  return highestAllowed(policy.allowedEfforts);
}

const EFFORT_ORDER: readonly AiEffort[] = [
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
];

function highestAllowed(allowed: readonly AiEffort[]): AiEffort {
  let best: AiEffort = "low";
  let bestRank = -1;

  for (const level of allowed) {
    const rank = EFFORT_ORDER.indexOf(level);

    if (rank > bestRank) {
      best = level;
      bestRank = rank;
    }
  }

  return best;
}

function clampTimeout(requested: number | undefined): number {
  if (requested === undefined || !Number.isFinite(requested)) {
    return DEFAULT_TIMEOUT_MS;
  }

  return Math.min(1_800_000, Math.max(10_000, Math.trunc(requested)));
}
