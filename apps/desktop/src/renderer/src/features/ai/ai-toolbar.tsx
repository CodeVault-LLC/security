import { Eye, Loader2, Sparkles } from "lucide-react";
import { useState } from "react";

import type {
  AiActionId,
  AiContextPreview,
  AiRunWithProposals,
  AiTargetType,
} from "@codevault/contracts";
import {
  Button,
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  Mono,
  VisibilityBadge,
} from "@codevault/ui";

import { bridge } from "../../lib/bridge.js";
import { formatBytesApprox } from "../../lib/format.js";

/**
 * The AI action toolbar.
 *
 * Two things make this safe rather than convenient-and-dangerous: the buttons
 * name fixed actions rather than sending a prompt, and "View context" shows the
 * researcher exactly what would be sent — every item, its visibility, its
 * digest, and everything the policy excluded — before anything leaves the
 * machine.
 */

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

  const runAction = async (action: AiActionId): Promise<void> => {
    setRunningAction(action);
    setError(null);

    try {
      const outcome = await bridge().ai.run({ action, targetType, targetId });

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
          <span key={action.id} className="flex items-center">
            <Button
              size="sm"
              variant="secondary"
              className="rounded-r-none"
              disabled={disabled || runningAction !== null}
              title={action.description}
              onClick={() => void runAction(action.id)}
            >
              {runningAction === action.id ? (
                <Loader2 aria-hidden className="size-3 animate-spin" />
              ) : null}
              {action.label}
            </Button>
            <Button
              size="icon"
              variant="secondary"
              className="-ml-px rounded-l-none"
              disabled={disabled || runningAction !== null}
              title="View the exact context that would be sent"
              aria-label={`View context for ${action.label}`}
              onClick={() => void showContext(action.id)}
            >
              <Eye aria-hidden className="size-3" />
            </Button>
          </span>
        ))}
      </div>

      {error === null ? null : (
        <p className="rounded-[--radius] border border-warning/40 bg-warning/10 px-2 py-1.5 text-[12px] text-warning">
          {error}
        </p>
      )}

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
                  <ul className="divide-y divide-border rounded-[--radius] border border-border">
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
                    <ul className="divide-y divide-border rounded-[--radius] border border-border">
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
                    Prompt
                  </h3>
                  <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-[--radius] border border-border bg-surface-raised p-2 font-mono text-[11px] text-text-muted">
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
