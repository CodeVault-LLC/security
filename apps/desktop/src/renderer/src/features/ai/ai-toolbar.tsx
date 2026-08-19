import { Eye, Sparkles } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import type {
  AiActionId,
  AiContextPreview,
  AiEffort,
  AiModelId,
  AiProviderPolicy,
  AiProviderId,
  AiProviderStatus,
  AiRunWithProposals,
  AiTargetType,
} from "@codevault/contracts";
import {
  Button,
  cn,
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  InlineError,
  LoadingState,
  Mono,
  Select,
  VisibilityBadge,
} from "@codevault/ui";

import { bridge } from "../../lib/bridge.js";
import { useAiProviderPreference } from "../../hooks/use-ai-provider-preference.js";
import {
  configuredAiProviderStatuses,
  normalizeAiProviderStatuses,
} from "../../lib/ai-providers.js";
import { formatBytesApprox } from "../../lib/format.js";
import { queryKeys, useApiQuery } from "../../lib/api.js";

/**
 * The AI action toolbar.
 *
 * Two things make this safe rather than convenient-and-dangerous: the buttons
 * name fixed actions rather than sending a prompt, and "View context" shows the
 * researcher exactly what would be sent — every item, its visibility, its
 * digest, and everything the policy excluded — before anything leaves the
 * machine.
 *
 * The model and effort pickers are preferences, not settings. Both are bounded
 * by the workspace allow-list, and a value outside it is refused by the server
 * rather than quietly downgraded — a run that claimed one model and used
 * another would make the record of it useless.
 */

/** Effort left unset means the action's own default, which varies by action. */
const AUTOMATIC_EFFORT = "__automatic__";

const EFFORT_DESCRIPTIONS: Readonly<Record<AiEffort, string>> = {
  low: "Fastest and cheapest",
  medium: "Balanced",
  high: "More thorough",
  xhigh: "Slower, for work that has to be right",
  max: "Deepest reasoning, highest cost",
};

export interface AiAction {
  id: AiActionId;
  label: string;
  description: string;
}

export interface AiToolbarProps {
  targetType: AiTargetType;
  targetId: string;
  actions: readonly AiAction[];
  onCompleted: (run: AiRunWithProposals) => void;
  disabled?: boolean;
  className?: string;
}

export function AiToolbar({
  targetType,
  targetId,
  actions,
  onCompleted,
  disabled = false,
  className,
}: AiToolbarProps): React.JSX.Element {
  const [runningAction, setRunningAction] = useState<AiActionId | null>(null);
  const [selectedAction, setSelectedAction] = useState<AiActionId | null>(
    actions[0]?.id ?? null,
  );
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<AiContextPreview | null>(null);
  const [previewFor, setPreviewFor] = useState<AiActionId | null>(null);
  const [model, setModel] = useState<AiModelId | null>(null);
  const [effort, setEffort] = useState<AiEffort | null>(null);
  const { providerId, setProviderId } = useAiProviderPreference();
  const [providers, setProviders] = useState<AiProviderStatus[] | null>(null);
  const [providerError, setProviderError] = useState<string | null>(null);
  const [providerRetry, setProviderRetry] = useState(0);

  useEffect(() => {
    void bridge()
      .ai.providers()
      .then((statuses) => setProviders(normalizeAiProviderStatuses(statuses)))
      .catch((caught: unknown) => {
        setProviders([]);
        setProviderError(
          caught instanceof Error
            ? caught.message
            : "The desktop AI provider service did not respond.",
        );
      });
  }, [providerRetry]);

  const policies = useApiQuery<{ items: AiProviderPolicy[] }>(
    queryKeys.aiPolicies,
    "/v1/ai/policies",
  );

  const configuredProviders = configuredAiProviderStatuses(
    providers ?? [],
    policies.data?.items ?? [],
  );
  const provider =
    configuredProviders.find((item) => item.providerId === providerId) ??
    configuredProviders[0];
  const policy = policies.data?.items.find(
    (item) => item.providerId === provider?.providerId,
  );
  const allowedModels = policy?.allowedModels ?? [];
  const allowedEfforts = policy?.allowedEfforts ?? [];
  const selectedModel = model ?? policy?.defaultModel ?? allowedModels[0];

  const preferences = {
    ...(selectedModel === undefined ? {} : { model: selectedModel }),
    ...(effort === null ? {} : { effort }),
  };

  const runAction = async (action: AiActionId): Promise<void> => {
    if (provider === undefined) return;

    setRunningAction(action);
    setError(null);

    try {
      const outcome = await bridge().ai.run({
        action,
        targetType,
        targetId,
        providerId: provider.providerId,
        ...preferences,
      });

      if (!outcome.ok) {
        setError(outcome.message);

        return;
      }

      onCompleted(outcome.data);
    } catch (caught: unknown) {
      setError(
        caught instanceof Error
          ? `AI draft could not start. ${caught.message}`
          : "AI draft could not start. Try again.",
      );
    } finally {
      setRunningAction(null);
    }
  };

  const showContext = async (action: AiActionId): Promise<void> => {
    if (provider === undefined) return;

    setError(null);
    setPreview(null);
    setPreviewFor(action);

    try {
      const outcome = await bridge().ai.previewContext({
        action,
        targetType,
        targetId,
        providerId: provider.providerId,
        ...preferences,
      });

      if (!outcome.ok) {
        setError(outcome.message);
        setPreviewFor(null);

        return;
      }

      setPreview(outcome.data);
    } catch (caught: unknown) {
      setError(
        caught instanceof Error
          ? `AI context could not be loaded. ${caught.message}`
          : "AI context could not be loaded. Try again.",
      );
      setPreviewFor(null);
    }
  };

  if (providers === null || policies.isLoading) {
    return (
      <LoadingState
        label="Checking available AI drafting providers…"
        {...(className === undefined ? {} : { className })}
      />
    );
  }

  if (policies.error !== null) {
    return (
      <div className={cn("space-y-2", className)}>
        <InlineError>
          AI policy could not be loaded. {policies.error.message}
        </InlineError>
        <Button
          variant="secondary"
          loading={policies.isFetching}
          onClick={() => void policies.refetch()}
        >
          Try again
        </Button>
      </div>
    );
  }

  if (providerError !== null) {
    return (
      <div className={cn("space-y-2", className)}>
        <InlineError>
          AI providers could not be checked. {providerError}
        </InlineError>
        <Button
          variant="secondary"
          onClick={() => {
            setProviders(null);
            setProviderError(null);
            setProviderRetry((attempt) => attempt + 1);
          }}
        >
          Try again
        </Button>
      </div>
    );
  }

  if (provider === undefined || policy === undefined) {
    return (
      <details className={cn("group", className)}>
        <summary className="flex min-h-10 cursor-pointer list-none items-center gap-2 rounded-(--cv-radius) border border-border bg-surface px-3 text-[12px] text-text-muted hover:bg-surface-hover hover:text-text focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus">
          <Sparkles aria-hidden className="size-4" />
          Draft with AI unavailable
        </summary>
        <div className="mt-2 flex flex-wrap items-center gap-2 px-1 text-[11px] text-text-muted">
          <p className="min-w-0 flex-1">
            No permitted provider is available. Configure one here, or ask an
            administrator to update the workspace policy.
          </p>
          <Button asChild variant="secondary" size="sm">
            <Link to="/settings/ai">Open AI settings</Link>
          </Button>
        </div>
      </details>
    );
  }

  const action =
    actions.find((item) => item.id === selectedAction) ?? actions[0];
  const previewPending = previewFor !== null && preview === null;

  return (
    <section
      className={cn("flex flex-col gap-3", className)}
      aria-labelledby="ai-drafting-title"
    >
      <div>
        <h2
          id="ai-drafting-title"
          className="flex items-center gap-2 text-[14px] font-semibold"
        >
          <Sparkles aria-hidden className="size-4 text-accent" />
          Draft with AI
        </h2>
        <p className="mt-1 max-w-2xl text-[12px] leading-5 text-text-muted">
          AI prepares a reviewable proposal. It cannot contact a vendor or
          publish anything.
        </p>
      </div>

      {action === undefined ? (
        <InlineError>
          No drafting actions are available for this record.
        </InlineError>
      ) : (
        <div className="grid grid-cols-1 items-end gap-2 lg:grid-cols-[minmax(14rem,1fr)_auto_auto]">
          <div>
            <span className="mb-1 block text-[12px] font-medium text-text-muted">
              Draft
            </span>
            <Select
              aria-label="AI drafting action"
              value={action.id}
              onValueChange={(value) => setSelectedAction(value as AiActionId)}
              disabled={disabled || runningAction !== null || previewPending}
              options={actions.map((item) => ({
                value: item.id,
                label: item.label,
                description: item.description,
              }))}
            />
          </div>
          <Button
            variant="secondary"
            loading={previewPending}
            disabled={disabled || runningAction !== null || previewPending}
            onClick={() => void showContext(action.id)}
          >
            <Eye aria-hidden className="size-4" />
            Review context
          </Button>
          <Button
            variant="primary"
            loading={runningAction === action.id}
            disabled={disabled || runningAction !== null || previewPending}
            onClick={() => void runAction(action.id)}
          >
            Create draft
          </Button>
        </div>
      )}

      <details className="group border-t border-border pt-2">
        <summary className="flex min-h-9 cursor-pointer list-none items-center justify-between rounded-(--cv-radius) text-[12px] font-medium text-text-muted hover:text-text focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus">
          Provider and reasoning options
          <span className="font-normal group-open:hidden">
            {provider.displayName} · {selectedModel}
          </span>
          <span className="hidden font-normal group-open:inline">
            Hide options
          </span>
        </summary>
        <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
          <Select
            aria-label="AI provider"
            disabled={disabled || runningAction !== null || previewPending}
            value={provider.providerId}
            onValueChange={(value) => {
              setProviderId(value as AiProviderId);
              setModel(null);
              setEffort(null);
            }}
            options={configuredProviders.map((item) => ({
              value: item.providerId,
              label: item.displayName,
            }))}
          />

          <Select
            aria-label="Model"
            disabled={disabled || runningAction !== null || previewPending}
            value={selectedModel}
            onValueChange={(value) => setModel(value as AiModelId)}
            options={allowedModels.map((id) => ({ value: id, label: id }))}
          />

          <Select
            aria-label="Reasoning effort"
            disabled={disabled || runningAction !== null || previewPending}
            value={effort ?? AUTOMATIC_EFFORT}
            onValueChange={(value) =>
              setEffort(value === AUTOMATIC_EFFORT ? null : (value as AiEffort))
            }
            options={[
              {
                value: AUTOMATIC_EFFORT,
                label: "Effort: automatic",
                // Each action declares how much thinking its own work is
                // worth, so leaving this alone gives scoring more than it
                // gives a title rewrite.
                description: "Chosen per action",
              },
              ...allowedEfforts.map((level) => ({
                value: level,
                label: `Effort: ${level}`,
                description: EFFORT_DESCRIPTIONS[level],
              })),
            ]}
          />
        </div>
      </details>

      {error === null ? null : <InlineError>{error}</InlineError>}

      <Dialog
        open={preview !== null}
        onOpenChange={(open) => {
          if (!open) {
            setPreview(null);
            setPreviewFor(null);
          }
        }}
      >
        <DialogContent
          width="max-w-3xl"
          title="Review AI context"
          description={
            previewFor === null
              ? undefined
              : "Review the exact material and execution settings before creating the draft."
          }
        >
          <DialogBody className="space-y-4">
            {preview === null ? null : (
              <>
                <section>
                  <h3 className="mb-1 text-[11px] uppercase tracking-wide text-text-muted">
                    Included · {preview.items.length} item
                    {preview.items.length === 1 ? "" : "s"} · audience{" "}
                    {preview.audience}
                  </h3>
                  <ul className="divide-y divide-border rounded-(--cv-radius) border border-border">
                    {preview.items.map((item) => (
                      <li
                        key={`${item.kind}-${item.id}`}
                        className="flex items-center gap-2 px-2 py-1.5 text-[12px]"
                      >
                        <Mono className="w-24 shrink-0 text-text-muted">
                          {item.kind}
                        </Mono>
                        <Mono className="w-28 shrink-0 text-text-muted">
                          {item.id}
                        </Mono>
                        <span className="min-w-0 flex-1 truncate">
                          {item.label}
                        </span>
                        <VisibilityBadge visibility={item.visibility} />
                        <span className="shrink-0 text-text-muted">
                          {formatBytesApprox(item.length)}
                        </span>
                        <Mono
                          className="w-20 shrink-0 truncate text-text-muted"
                          title={item.sha256}
                        >
                          {item.sha256.slice(0, 10)}
                        </Mono>
                      </li>
                    ))}
                  </ul>
                </section>

                {preview.excluded.length === 0 ? null : (
                  <section>
                    <h3 className="mb-1 text-[11px] uppercase tracking-wide text-text-muted">
                      Excluded by policy · {preview.excluded.length}
                    </h3>
                    <ul className="divide-y divide-border rounded-(--cv-radius) border border-border">
                      {preview.excluded.map((item, index) => (
                        <li
                          key={`${item.label}-${index}`}
                          className="flex items-center gap-2 px-2 py-1.5 text-[12px]"
                        >
                          <span className="min-w-0 flex-1 truncate">
                            {item.label}
                          </span>
                          <VisibilityBadge visibility={item.visibility} />
                          <span className="shrink-0 text-text-muted">
                            {item.reason}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </section>
                )}

                <section>
                  <h3 className="mb-1 text-[11px] uppercase tracking-wide text-text-muted">
                    Execution
                  </h3>
                  <ul className="divide-y divide-border rounded-(--cv-radius) border border-border text-[12px]">
                    <li className="flex items-center gap-2 px-2 py-1.5">
                      <span className="w-24 shrink-0 text-text-muted">
                        Model
                      </span>
                      <Mono>{preview.profile.model}</Mono>
                      <span className="text-text-muted">
                        at {preview.profile.effort} effort
                      </span>
                    </li>
                    <li className="flex items-center gap-2 px-2 py-1.5">
                      <span className="w-24 shrink-0 text-text-muted">
                        Tools
                      </span>
                      <span>
                        {preview.profile.toolPolicy === "NONE"
                          ? "None. The provider runs with no filesystem or network access."
                          : "Reading only, within the directory you chose."}
                      </span>
                    </li>
                    {preview.profile.maxBudgetUsd === null ? null : (
                      <li className="flex items-center gap-2 px-2 py-1.5">
                        <span className="w-24 shrink-0 text-text-muted">
                          Budget
                        </span>
                        <span>
                          stops at ${preview.profile.maxBudgetUsd.toFixed(2)}
                        </span>
                      </li>
                    )}
                  </ul>
                </section>

                <section>
                  <h3 className="mb-1 text-[11px] uppercase tracking-wide text-text-muted">
                    Prompt
                  </h3>
                  <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-(--cv-radius) border border-border bg-surface-raised p-2 font-mono text-[11px] text-text-muted">
                    {preview.promptText}
                  </pre>
                </section>
              </>
            )}
          </DialogBody>

          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => {
                setPreview(null);
                setPreviewFor(null);
              }}
            >
              Close
            </Button>
            {previewFor === null ? null : (
              <Button
                variant="primary"
                onClick={() => {
                  const action = previewFor;

                  setPreview(null);
                  setPreviewFor(null);
                  void runAction(action);
                }}
              >
                Run draft
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
