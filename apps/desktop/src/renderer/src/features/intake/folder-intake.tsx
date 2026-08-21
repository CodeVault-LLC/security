import { useEffect, useMemo, useState } from "react";

import type {
  CreateFolderIntakeRequest,
  FolderIntakeContext,
  FolderIntakeResult,
} from "@codevault/contracts";
import { Button, InlineError, Mono } from "@codevault/ui";

import type { FolderIntakePreviewResult } from "../../../../preload/contracts.js";
import { formatBytesApprox } from "../../lib/format.js";
import { queryKeys, useApiMutation, useApiQuery } from "../../lib/api.js";
import { bridge } from "../../lib/bridge.js";
import { useSession } from "../../lib/session.js";

interface StoredTransfer {
  preview: FolderIntakePreviewResult;
  selectedIds: string[];
  uploaded: Record<string, string>;
}

export function FolderIntake({
  caseId,
}: {
  caseId: string;
}): React.JSX.Element {
  const userId = useSession((state) => state.user?.id ?? "signed-out");
  const storageKey = `codevault.folder-intake.${userId}.${caseId}`;
  const context = useApiQuery<FolderIntakeContext>(
    ["intake", caseId, "folder-context"],
    `/v1/intake/folder-context?caseId=${caseId}`,
  );
  const [restored] = useState(() => restoreTransfer(storageKey));
  const [preview, setPreview] = useState<FolderIntakePreviewResult | null>(
    restored?.preview ?? null,
  );
  const [selectedIds, setSelectedIds] = useState<Set<string>>(
    () => new Set(restored?.selectedIds ?? []),
  );
  const [uploaded, setUploaded] = useState<Record<string, string>>(
    restored?.uploaded ?? {},
  );
  const [selecting, setSelecting] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [cleaning, setCleaning] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const commit = useApiMutation<FolderIntakeResult, CreateFolderIntakeRequest>(
    (body) => ({ path: "/v1/intake/folder", method: "POST", body }),
    () => [queryKeys.intake(caseId)],
  );

  useEffect(() => {
    if (preview === null) {
      window.localStorage.removeItem(storageKey);
      return;
    }
    window.localStorage.setItem(
      storageKey,
      JSON.stringify({
        preview,
        selectedIds: [...selectedIds],
        uploaded,
      } satisfies StoredTransfer),
    );
  }, [preview, selectedIds, storageKey, uploaded]);

  const selectedCandidates = useMemo(
    () =>
      preview?.candidates.filter((candidate) =>
        selectedIds.has(candidate.clientId),
      ) ?? [],
    [preview, selectedIds],
  );
  const uploadedCount = Object.keys(uploaded).length;

  const chooseFolder = async (): Promise<void> => {
    if (context.data === undefined) return;
    setSelecting(true);
    setLocalError(null);
    setSuccess(null);
    try {
      const outcome = await bridge().intake.selectFolder(context.data);
      if (!outcome.ok) {
        setLocalError(`${outcome.message} Select the folder again to retry.`);
        return;
      }
      if (outcome.data === null) return;
      setPreview(outcome.data);
      setSelectedIds(
        new Set(
          outcome.data.candidates
            .filter((candidate) => candidate.status === "READY")
            .map((candidate) => candidate.clientId),
        ),
      );
      setUploaded({});
    } finally {
      setSelecting(false);
    }
  };

  const uploadAndCommit = async (): Promise<void> => {
    if (preview === null || selectedCandidates.length === 0) return;
    setUploading(true);
    setLocalError(null);
    try {
      const remaining = preview.selections.filter(
        (selection) => uploaded[selection.relativePath] === undefined,
      );
      let completed = uploaded;
      if (remaining.length > 0) {
        const outcome = await bridge().uploads.start({
          caseId,
          artifactKind: "OTHER",
          visibility: "INTERNAL",
          selections: remaining.map((selection) => ({
            selectionId: selection.selectionId,
            filename: selection.filename,
            sizeBytes: selection.sizeBytes,
            mimeType: selection.mimeType,
            sha256: selection.sha256,
          })),
        });
        if (!outcome.ok) {
          setLocalError(
            `${outcome.message} Retry the unfinished uploads. If the file selection expired, cancel this preview and select the folder again.`,
          );
          return;
        }
        completed = { ...uploaded };
        const failures: string[] = [];
        for (const item of outcome.data.items) {
          const selection = preview.selections.find(
            (candidate) => candidate.selectionId === item.selectionId,
          );
          if (selection === undefined) continue;
          if (item.artifactId === null) failures.push(selection.relativePath);
          else completed[selection.relativePath] = item.artifactId;
        }
        setUploaded(completed);
        if (failures.length > 0) {
          setLocalError(
            `${failures.length} original file upload${failures.length === 1 ? "" : "s"} failed. Retry to continue.`,
          );
          return;
        }
      }

      const body: CreateFolderIntakeRequest = {
        caseId,
        sourceLabel: preview.rootName,
        files: preview.files.map((file) => ({
          ...file,
          ...(completed[file.relativePath] === undefined
            ? {}
            : { artifactId: completed[file.relativePath] }),
        })),
        items: selectedCandidates.map((candidate) => ({
          draft: candidate.draft,
          citations: [
            {
              kind: "FILE",
              path: candidate.sourcePath,
              sha256: candidate.sourceSha256,
            },
            ...(completed[candidate.sourcePath] === undefined
              ? []
              : [
                  {
                    kind: "ARTIFACT" as const,
                    artifactId: completed[candidate.sourcePath]!,
                    label: candidate.sourcePath,
                  },
                ]),
          ],
          ...(candidate.status === "DUPLICATE"
            ? { duplicateAcknowledged: true }
            : {}),
        })),
      };
      const result = await commit.mutateAsync(body);
      setSuccess(
        `${result.items.length} intake draft${result.items.length === 1 ? " was" : "s were"} created for review.`,
      );
      setPreview(null);
      setSelectedIds(new Set());
      setUploaded({});
    } catch (error: unknown) {
      setLocalError(
        `${error instanceof Error ? error.message : "The intake batch was not created."} Your preview and completed uploads are still available.`,
      );
    } finally {
      setUploading(false);
    }
  };

  const cancelPreview = async (): Promise<void> => {
    const artifactIds = Object.values(uploaded);
    setCleaning(true);
    setLocalError(null);
    try {
      if (artifactIds.length > 0) {
        const outcome = await bridge().uploads.discard(artifactIds);
        if (!outcome.ok) {
          setLocalError(
            `${outcome.message} The preview remains open so you can retry cleanup.`,
          );
          return;
        }
      }
      setPreview(null);
      setSelectedIds(new Set());
      setUploaded({});
    } finally {
      setCleaning(false);
    }
  };

  return (
    <section className="border-t border-border pt-3" aria-label="Folder intake">
      {preview === null ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="max-w-[68ch] text-[11px] text-text-muted">
            Map Markdown, JSON, CSV, captures, images, and attachments into
            reviewable drafts. Selecting a folder does not change the case.
          </p>
          <Button
            size="sm"
            variant="secondary"
            loading={selecting}
            disabled={context.data === undefined}
            onClick={() => void chooseFolder()}
          >
            Preview folder intake
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="text-[12px] font-semibold">{preview.rootName}</h3>
              <p className="mt-0.5 text-[11px] text-text-muted">
                {preview.files.length} original files ·{" "}
                {formatBytesApprox(preview.totalBytes)} · {uploadedCount}{" "}
                uploaded
              </p>
            </div>
            <Button
              size="sm"
              variant="ghost"
              loading={cleaning}
              onClick={() => void cancelPreview()}
            >
              Cancel folder intake
            </Button>
          </div>

          {preview.errors.length === 0 ? null : (
            <div className="rounded-(--cv-radius) border border-warning/40 bg-warning/5 p-2">
              <p className="text-[11px] font-medium">
                {preview.errors.length} file mapping error
                {preview.errors.length === 1 ? "" : "s"}
              </p>
              <ul className="mt-1 list-disc space-y-0.5 pl-4 text-[11px] text-text-muted">
                {preview.errors.map((error) => (
                  <li key={error}>{error}</li>
                ))}
              </ul>
              <p className="mt-1 text-[11px] text-text-muted">
                The original files remain in this batch even when mapping fails.
              </p>
            </div>
          )}

          <fieldset>
            <legend className="text-[11px] font-medium">
              Proposed findings
            </legend>
            <div className="mt-1 max-h-72 divide-y divide-border overflow-auto rounded-(--cv-radius) border border-border">
              {preview.candidates.map((candidate) => (
                <label
                  key={candidate.clientId}
                  className="flex cursor-pointer items-start gap-2 px-2.5 py-2 hover:bg-surface-hover"
                >
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={selectedIds.has(candidate.clientId)}
                    onChange={(event) =>
                      setSelectedIds((current) => {
                        const next = new Set(current);
                        if (event.target.checked) next.add(candidate.clientId);
                        else next.delete(candidate.clientId);
                        return next;
                      })
                    }
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block text-[12px] font-medium">
                      {candidate.draft.title}
                    </span>
                    <Mono className="block truncate text-[10px] text-text-muted">
                      {candidate.sourcePath}
                    </Mono>
                    {candidate.duplicateReasons.length === 0 ? null : (
                      <span className="mt-1 block text-[11px] text-warning">
                        {candidate.duplicateReasons.join(" ")}
                      </span>
                    )}
                  </span>
                </label>
              ))}
            </div>
          </fieldset>

          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
            <p className="text-[11px] text-text-muted" aria-live="polite">
              {selectedCandidates.length} of {preview.candidates.length}{" "}
              findings selected. Acceptance still requires a separate review.
            </p>
            <Button
              size="sm"
              variant="primary"
              loading={uploading || commit.isPending}
              disabled={selectedCandidates.length === 0}
              onClick={() => void uploadAndCommit()}
            >
              Create {selectedCandidates.length} intake draft
              {selectedCandidates.length === 1 ? "" : "s"}
            </Button>
          </div>
        </div>
      )}

      {localError === null ? null : (
        <div className="mt-2">
          <InlineError>{localError}</InlineError>
        </div>
      )}
      {success === null ? null : (
        <p className="mt-2 text-[11px] text-success" role="status">
          {success}
        </p>
      )}
      {context.error === null ? null : (
        <p className="mt-2 text-[11px] text-danger">
          Folder duplicate checks are unavailable. Retry the case request before
          selecting a folder.
        </p>
      )}
    </section>
  );
}

function restoreTransfer(storageKey: string): StoredTransfer | null {
  const raw = window.localStorage.getItem(storageKey);
  if (raw === null) return null;
  try {
    const value = JSON.parse(raw) as unknown;
    return isStoredTransfer(value) ? value : null;
  } catch {
    window.localStorage.removeItem(storageKey);
    return null;
  }
}

function isStoredTransfer(value: unknown): value is StoredTransfer {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate["preview"] === "object" &&
    candidate["preview"] !== null &&
    Array.isArray(candidate["selectedIds"]) &&
    candidate["selectedIds"].every((item) => typeof item === "string") &&
    typeof candidate["uploaded"] === "object" &&
    candidate["uploaded"] !== null &&
    Object.values(candidate["uploaded"]).every(
      (item) => typeof item === "string",
    )
  );
}
