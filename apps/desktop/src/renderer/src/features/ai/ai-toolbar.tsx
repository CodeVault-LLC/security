import { Eye, Sparkles } from "lucide-react";
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
  ButtonGroup,
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  InlineError,
  Mono,
  Select,
  VisibilityBadge,
} from "@codevault/ui";

import { bridge } from "../../lib/bridge.js";
import { normalizeAiProviderStatuses } from "../../lib/ai-providers.js";
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
}

export function AiToolbar({
  targetType,
  targetId,
  actions,
  onCompleted,
  disabled = false,
}: AiToolbarProps): React.JSX.Element {
  const [runningAction, setRunningAction] = useState<AiActionId | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<AiContextPreview | null>(null);
  const [previewFor, setPreviewFor] = useState<AiActionId | null>(null);
  const [model, setModel] = useState<AiModelId | null>(null);
  const [effort, setEffort] = useState<AiEffort | null>(null);
  const [providerId, setProviderId] = useState<AiProviderId>("claude-code");
  const [providers, setProviders] = useState<AiProviderStatus[]>([]);

  useEffect(() => {
    void bridge()
      .ai.providers()
      .then((statuses) => setProviders(normalizeAiProviderStatuses(statuses)));
  }, []);

  const policies = useApiQuery<{ items: AiProviderPolicy[] }>(
    queryKeys.aiPolicies,
    "/v1/ai/policies",
  );

  const policy = policies.data?.items.find(
    (item) => item.providerId === providerId,
  );
  const provider = providers.find((item) => item.providerId === providerId);
  const allowedModels = policy?.allowedModels ?? [];
  const allowedEfforts = policy?.allowedEfforts ?? [];
  const selectedModel = model ?? policy?.defaultModel ?? allowedModels[0];

  const preferences = {
    ...(selectedModel === undefined ? {} : { model: selectedModel }),
    ...(effort === null ? {} : { effort }),
  };

  const runAction = async (action: AiActionId): Promise<void> => {
    setRunningAction(action);
    setError(null);

    try {
      const outcome = await bridge().ai.run({
        action,
        targetType,
        targetId,
        providerId,
        ...preferences,
      });

      if (!outcome.ok) {
        setError(outcome.message);

        return;
      }

      onCompleted(outcome.data);
    } finally {
      setRunningAction(null);
    }
  };

  const showContext = async (action: AiActionId): Promise<void> => {
    setError(null);
    setPreviewFor(action);

    const outcome = await bridge().ai.previewContext({
      action,
      targetType,
      targetId,
      providerId,
      ...preferences,
    });

    if (!outcome.ok) {
      setError(outcome.message);
      setPreviewFor(null);

      return;
    }

    setPreview(outcome.data);
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="flex items-center gap-1 text-[11px] uppercase tracking-wide text-text-muted">
          <Sparkles aria-hidden className="size-3" />
          AI
        </span>

        {actions.map((action) => (
          <ButtonGroup key={action.id}>
            <Button
              size="sm"
              variant="secondary"
              loading={runningAction === action.id}
              disabled={disabled || runningAction !== null}
              title={action.description}
              onClick={() => void runAction(action.id)}
            >
              {action.label}
            </Button>
            <Button
              size="sm"
              variant="secondary"
              className="w-6 px-0"
              disabled={disabled || runningAction !== null}
              title="View the exact context that would be sent"
              aria-label={`View context for ${action.label}`}
              onClick={() => void showContext(action.id)}
            >
              <Eye aria-hidden className="size-3" />
            </Button>
          </ButtonGroup>
        ))}

        {providers.length === 0 ? null : (
          <div className="ml-auto flex items-center gap-1.5">
            <Select
              aria-label="AI provider"
              className="w-36"
              disabled={disabled || runningAction !== null}
              value={providerId}
              onValueChange={(value) => {
                setProviderId(value as AiProviderId);
                setModel(null);
                setEffort(null);
              }}
              options={providers.map((item) => ({
                value: item.providerId,
                label: item.displayName,
                description: item.available ? "Detected" : "Not detected",
              }))}
            />

            {allowedModels.length === 0 ? (
              <span className="text-[11px] text-warning">
                {provider?.available === false
                  ? "Provider unavailable"
                  : "Provider not configured"}
              </span>
            ) : (
              <Select
                aria-label="Model"
                className="w-44"
                disabled={disabled || runningAction !== null}
                value={selectedModel}
                onValueChange={(value) => setModel(value as AiModelId)}
                options={allowedModels.map((id) => ({ value: id, label: id }))}
              />
            )}

            {allowedModels.length === 0 ||
            allowedEfforts.length === 0 ? null : (
              <Select
                aria-label="Reasoning effort"
                className="w-40"
                disabled={disabled || runningAction !== null}
                value={effort ?? AUTOMATIC_EFFORT}
                onValueChange={(value) =>
                  setEffort(
                    value === AUTOMATIC_EFFORT ? null : (value as AiEffort),
                  )
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
            )}
          </div>
        )}
      </div>

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
          title="Context being sent"
          description={
            previewFor === null
              ? undefined
              : `Everything below is what ${previewFor} would send to the local provider.`
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
                Send and run
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
