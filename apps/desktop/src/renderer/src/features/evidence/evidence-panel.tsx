import { Upload } from "lucide-react";
import { useEffect, useState } from "react";

import type { Evidence } from "@codevault/contracts";
import { ARTIFACT_KINDS, CONTENT_VISIBILITIES } from "@codevault/core";
import {
  Button,
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  EmptyState,
  EvidenceCard,
  Input,
  Label,
  Select,
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

  return (
    <div className="space-y-3 p-4">
      <div className="flex items-center justify-between">
        <p className="text-[12px] text-text-muted">
          {items.length} evidence record{items.length === 1 ? "" : "s"}
        </p>
        {canEdit ? (
          <Button
            variant="primary"
            size="sm"
            onClick={() => setUploadOpen(true)}
          >
            <Upload aria-hidden className="size-3" />
            Add evidence
          </Button>
        ) : null}
      </div>

      <QueryError query={evidence} className="mx-4" />

      {items.length === 0 ? (
        <EmptyState
          title="No evidence yet"
          description="Screenshots, captures, source files, firmware images and proof-of-concept material all live here with their digests."
        />
      ) : (
        <div className="grid grid-cols-1 gap-3 2xl:grid-cols-2">
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
    </div>
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
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="Add evidence"
        description="Files are hashed and streamed directly to storage. Nothing passes through this window."
      >
        <DialogBody className="space-y-3">
          <div>
            <Button variant="secondary" onClick={() => void pickFiles()}>
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
                    key={selection.path}
                    className="flex items-center gap-2 px-2 py-1.5 text-[12px]"
                  >
                    <span className="min-w-0 flex-1 truncate">
                      {selection.filename}
                    </span>
                    <span className="shrink-0 text-text-muted">
                      {formatBytesApprox(selection.sizeBytes)}
                    </span>
                    <span
                      className="w-24 shrink-0 truncate font-mono text-[10.5px] text-text-muted"
                      title={selection.sha256}
                    >
                      {selection.sha256.slice(0, 12)}
                    </span>
                    {update === undefined ? null : (
                      <span className="w-20 shrink-0 text-right text-text-muted">
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

          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label>Kind</Label>
              <Select
                aria-label="Artifact kind"
                value={artifactKind}
                onValueChange={setArtifactKind}
                className="mt-1"
                options={ARTIFACT_KINDS.map((kind) => ({
                  value: kind,
                  label: kind.replace(/_/g, " ").toLowerCase(),
                }))}
              />
            </div>
            <div>
              <Label>Visibility</Label>
              <Select
                aria-label="Visibility"
                value={visibility}
                onValueChange={setVisibility}
                className="mt-1"
                options={CONTENT_VISIBILITIES.map((value) => ({
                  value,
                  label: value.toLowerCase(),
                  description:
                    value === "INTERNAL"
                      ? "Never appears in a vendor or public report."
                      : value === "VENDOR"
                        ? "May appear in vendor and public reports."
                        : "May appear in any report.",
                }))}
              />
            </div>
          </div>

          <div>
            <Label>Description (optional)</Label>
            <div className="mt-1">
              <MarkdownField
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
            <p className="text-[12px] text-danger">{error}</p>
          )}
        </DialogBody>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={
              busy || selections.length === 0 || title.trim().length === 0
            }
            onClick={() => void upload()}
          >
            {busy ? "Uploading…" : "Upload"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
