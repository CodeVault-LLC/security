import { Upload } from "lucide-react";
import { useEffect, useState } from "react";

import type { Evidence } from "@codevault/contracts";
import { ARTIFACT_KINDS, CONTENT_VISIBILITIES } from "@codevault/core";
import {
  artifactKindSelectOptions,
  Button,
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  EmptyState,
  EvidenceCard,
  Input,
  Label,
  LoadingState,
  Select,
  visibilitySelectOptions,
} from "@codevault/ui";

import type {
  UploadProgress,
  UploadSelection,
} from "../../../../preload/contracts.js";
import { QueryError } from "../../components/query-boundary.js";
import { bridge } from "../../lib/bridge.js";
import { formatBytesApprox } from "../../lib/format.js";
import { MarkdownField } from "../markdown/markdown-field.js";
import { queryKeys, useApiMutation, useApiQuery } from "../../lib/api.js";

/**
 * Evidence.
 *
 * The renderer never touches file bytes. It asks the main process for a native
 * picker, receives metadata and a digest, and shows progress while the upload
 * streams straight to object storage — which is why a multi-gigabyte firmware
 * image does not make this window unresponsive.
 */

interface Paginated<T> {
  items: T[];
  nextCursor: string | null;
}

export interface EvidencePanelProps {
  caseId: string;
  findingId?: string;
  canEdit: boolean;
}

export function EvidencePanel({
  caseId,
  findingId,
  canEdit,
}: EvidencePanelProps): React.JSX.Element {
  const [uploadOpen, setUploadOpen] = useState(false);

  const query =
    findingId === undefined
      ? `/v1/evidence?caseId=${caseId}&limit=100`
      : `/v1/evidence?caseId=${caseId}&findingId=${findingId}&limit=100`;

  const evidence = useApiQuery<Paginated<Evidence>>(
    queryKeys.evidence({ caseId, findingId }),
    query,
  );

  const items = evidence.data?.items ?? [];

  const openArtifact = (artifactId: string): void => {
    void bridge()
      .api.request<{ url: string }>(`/v1/artifacts/${artifactId}`)
      .then((outcome) => {
        if (outcome.ok) {
          void bridge().app.openExternal(outcome.data.url);
        }
      });
  };

  const loadArtifact = async (artifactId: string): Promise<string> => {
    const outcome = await bridge().api.request<{ url: string }>(
      `/v1/artifacts/${artifactId}`,
    );

    if (!outcome.ok) throw new Error(outcome.message);
    return outcome.data.url;
  };

  return (
    <section aria-labelledby="evidence-heading" className="p-4 sm:p-6">
      <div className="flex items-start justify-between gap-4 border-b border-border pb-4">
        <div>
          <h2
            id="evidence-heading"
            className="text-balance text-[16px] font-semibold text-text"
          >
            Evidence
          </h2>
          <p className="mt-1 text-pretty text-[12px] text-text-muted">
            {items.length} evidence record{items.length === 1 ? "" : "s"}
            {evidence.isFetching && evidence.data !== undefined
              ? " · Refreshing"
              : ""}
          </p>
        </div>
        {canEdit ? (
          <Button
            variant="primary"
            size="sm"
            onClick={() => setUploadOpen(true)}
          >
            <Upload aria-hidden className="size-3.5" strokeWidth={2} />
            Add evidence
          </Button>
        ) : (
          <p className="max-w-52 text-right text-pretty text-[11px] leading-4 text-text-muted">
            Read only. Ask a case editor to add evidence.
          </p>
        )}
      </div>

      {evidence.error !== null && evidence.data === undefined ? (
        <QueryError query={evidence} className="mt-4" />
      ) : evidence.isLoading ? (
        <LoadingState label="Loading evidence records…" />
      ) : items.length === 0 ? (
        <EmptyState
          title="No evidence yet"
          description={
            canEdit
              ? "Add screenshots, captures, source files, firmware images, or proof-of-concept material."
              : "No evidence has been added to this finding."
          }
          action={
            canEdit ? (
              <Button variant="primary" onClick={() => setUploadOpen(true)}>
                <Upload aria-hidden className="size-3.5" />
                Add evidence
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div>
          {evidence.error === null ? null : (
            <QueryError query={evidence} className="mt-4" />
          )}
          {items.map((item) => (
            <EvidenceCard
              key={item.id}
              reference={item.ref}
              title={item.title}
              description={item.descriptionMarkdown}
              visibility={item.visibility}
              artifacts={item.artifacts}
              capturedAt={item.capturedAt}
              onOpenArtifact={openArtifact}
              onLoadArtifact={loadArtifact}
            />
          ))}
        </div>
      )}

      <UploadDialog
        open={uploadOpen}
        onOpenChange={setUploadOpen}
        caseId={caseId}
        {...(findingId === undefined ? {} : { findingId })}
      />
    </section>
  );
}

function UploadDialog({
  open,
  onOpenChange,
  caseId,
  findingId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  caseId: string;
  findingId?: string;
}): React.JSX.Element {
  const [selections, setSelections] = useState<UploadSelection[]>([]);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [artifactKind, setArtifactKind] = useState<string>("SCREENSHOT");
  const [visibility, setVisibility] = useState<string>("INTERNAL");
  const [progress, setProgress] = useState<Record<string, UploadProgress>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const unsubscribe = bridge().uploads.onProgress((update) => {
      setProgress((current) => ({ ...current, [update.uploadId]: update }));
    });

    return unsubscribe;
  }, []);

  const createEvidence = useApiMutation<Evidence, string[]>(
    (artifactIds) => ({
      path: "/v1/evidence",
      method: "POST",
      body: {
        caseId,
        ...(findingId === undefined ? {} : { findingId }),
        title: title.trim(),
        ...(description.trim().length === 0
          ? {}
          : { descriptionMarkdown: description.trim() }),
        visibility,
        artifactIds,
      },
    }),
    () => [queryKeys.evidence({ caseId, findingId }), queryKeys.dashboard],
  );

  const pickFiles = async (): Promise<void> => {
    setError(null);

    const picked = await bridge().uploads.select();

    setSelections(picked);

    if (title.trim().length === 0 && picked[0] !== undefined) {
      setTitle(picked[0].filename);
    }
  };

  const upload = async (): Promise<void> => {
    if (selections.length === 0 || title.trim().length === 0) {
      return;
    }

    setBusy(true);
    setError(null);

    try {
      const outcome = await bridge().uploads.start({
        caseId,
        ...(findingId === undefined ? {} : { findingId }),
        artifactKind,
        visibility: visibility as "INTERNAL" | "VENDOR" | "PUBLIC",
        selections,
      });

      if (!outcome.ok) {
        setError(outcome.message);

        return;
      }

      createEvidence.mutate(outcome.data, {
        onSuccess: () => {
          onOpenChange(false);
          setSelections([]);
          setTitle("");
          setDescription("");
          setProgress({});
        },
        onError: (mutationError) => setError(mutationError.message),
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!busy && !createEvidence.isPending) onOpenChange(nextOpen);
      }}
    >
      <DialogContent
        title="Add evidence"
        description="Files are hashed and streamed directly to storage. Nothing passes through this window."
      >
        <DialogBody className="space-y-3">
          <div>
            <Button
              variant="secondary"
              onClick={() => void pickFiles()}
              disabled={busy || createEvidence.isPending}
            >
              Choose files…
            </Button>
          </div>

          {selections.length === 0 ? null : (
            <ul className="divide-y divide-border rounded-(--cv-radius) border border-border">
              {selections.map((selection) => {
                const update = Object.values(progress).find(
                  (item) => item.filename === selection.filename,
                );

                return (
                  <li
                    key={selection.selectionId}
                    className="flex min-h-10 items-center gap-2 px-3 py-2 text-[12px]"
                  >
                    <span className="min-w-0 flex-1 truncate">
                      {selection.filename}
                    </span>
                    <span className="shrink-0 text-text-muted">
                      {formatBytesApprox(selection.sizeBytes)}
                    </span>
                    <span
                      className="hidden w-24 shrink-0 truncate font-mono text-[10.5px] text-text-muted sm:block"
                      title={selection.sha256}
                    >
                      {selection.sha256.slice(0, 12)}
                    </span>
                    {update === undefined ? null : (
                      <span
                        className="w-20 shrink-0 text-right tabular-nums text-text-muted"
                        aria-live="polite"
                      >
                        {update.phase === "UPLOADING" &&
                        update.progress !== null
                          ? `${Math.round(update.progress * 100)}%`
                          : update.phase.toLowerCase()}
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          )}

          <div>
            <Label htmlFor="evidence-title">Title</Label>
            <Input
              id="evidence-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              className="mt-1"
            />
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <Label>Kind</Label>
              <Select
                aria-label="Artifact kind"
                value={artifactKind}
                onValueChange={setArtifactKind}
                className="mt-1"
                options={artifactKindSelectOptions(ARTIFACT_KINDS)}
              />
            </div>
            <div>
              <Label>Visibility</Label>
              <Select
                aria-label="Visibility"
                value={visibility}
                onValueChange={setVisibility}
                className="mt-1"
                options={visibilitySelectOptions(CONTENT_VISIBILITIES)}
              />
            </div>
          </div>

          <div>
            <Label>Description (optional)</Label>
            <div className="mt-1">
              <MarkdownField
                ariaLabel="Evidence description"
                value={description}
                onChange={setDescription}
                draftKey={`evidence:new:${caseId}`}
                caseId={caseId}
                minHeight="9rem"
                placeholder="What this shows, and what it proves. Markdown."
              />
            </div>
          </div>

          {error === null ? null : (
            <p role="alert" className="text-pretty text-[12px] text-danger">
              Upload failed. {error} Your files and description are still here.
            </p>
          )}
        </DialogBody>

        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={busy || createEvidence.isPending}
          >
            Cancel
          </Button>
          <Button
            variant="primary"
            loading={busy || createEvidence.isPending}
            disabled={selections.length === 0 || title.trim().length === 0}
            title={
              selections.length === 0
                ? "Choose at least one file"
                : title.trim().length === 0
                  ? "Enter a title"
                  : undefined
            }
            onClick={() => void upload()}
          >
            Upload evidence
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
