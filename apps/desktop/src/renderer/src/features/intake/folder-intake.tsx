import { useEffect, useMemo, useState, type DragEvent } from "react";

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
import {
  readLocalStorage,
  removeLocalStorage,
  writeLocalStorage,
} from "../../lib/local-storage.js";
import { useSession } from "../../lib/session.js";

interface StoredTransfer {
  preview: FolderIntakePreviewResult;
  selectedIds: string[];
  uploaded: Record<string, string>;
}

const EXPIRED_SOURCE_ACCESS_MESSAGE =
  "This preview lost access to its local source files after the desktop app restarted or the selection expired. Cancel the preview, then choose or drop the files again.";

const FINDING_FILE_EXTENSIONS = [
  ".md",
  ".markdown",
  ".json",
  ".csv",
  ".sarif",
] as const;

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
  const [sourceAccess, setSourceAccess] = useState<
    "READY" | "CHECKING" | "EXPIRED"
  >(
    restored === null ||
      restored.preview.selections.every(
        (selection) => restored.uploaded[selection.relativePath] !== undefined,
      )
      ? "READY"
      : "CHECKING",
  );
  const [selecting, setSelecting] = useState(false);
  const [previewingFiles, setPreviewingFiles] = useState(false);
  const [draggingFiles, setDraggingFiles] = useState(false);
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
      removeLocalStorage(storageKey);
      return;
    }
    writeLocalStorage(
      storageKey,
      JSON.stringify({
        preview,
        selectedIds: [...selectedIds],
        uploaded,
      } satisfies StoredTransfer),
    );
  }, [preview, selectedIds, storageKey, uploaded]);

  const restoredPendingSelectionIds = useMemo(() => {
    if (restored === null || context.data === undefined) return null;
    const storedDigests = new Set(
      context.data.storedArtifacts.map((artifact) => artifact.sha256),
    );
    return restored.preview.selections
      .filter(
        (selection) =>
          restored.uploaded[selection.relativePath] === undefined &&
          !storedDigests.has(selection.sha256),
      )
      .map((selection) => selection.selectionId);
  }, [context.data, restored]);

  useEffect(() => {
    if (
      restoredPendingSelectionIds === null ||
      restoredPendingSelectionIds.length === 0
    )
      return;

    const validateSelections = bridge().uploads.validateSelections;
    const validation =
      typeof validateSelections === "function"
        ? validateSelections(restoredPendingSelectionIds)
        : Promise.resolve({
            ok: true as const,
            data: { available: false },
          });

    let active = true;
    void validation
      .then((outcome) => {
        if (!active) return;
        if (outcome.ok && outcome.data.available) {
          setSourceAccess("READY");
          return;
        }
        setSourceAccess("EXPIRED");
        setLocalError(EXPIRED_SOURCE_ACCESS_MESSAGE);
      })
      .catch(() => {
        if (!active) return;
        setSourceAccess("EXPIRED");
        setLocalError(EXPIRED_SOURCE_ACCESS_MESSAGE);
      });
    return () => {
      active = false;
    };
  }, [restoredPendingSelectionIds]);

  const selectedCandidates = useMemo(
    () =>
      preview?.candidates.filter((candidate) =>
        selectedIds.has(candidate.clientId),
      ) ?? [],
    [preview, selectedIds],
  );
  const uploadedCount = Object.keys(uploaded).length;
  const storedArtifacts = useMemo(
    () => context.data?.storedArtifacts ?? [],
    [context.data],
  );
  const linkedArtifacts = useMemo(() => {
    if (preview === null) return {};
    const byDigest = new Map(
      storedArtifacts.map((artifact) => [artifact.sha256, artifact.id]),
    );
    return Object.fromEntries(
      preview.files.flatMap((file) => {
        const artifactId = byDigest.get(file.sha256);
        return artifactId === undefined
          ? []
          : [[file.relativePath, artifactId] as const];
      }),
    );
  }, [preview, storedArtifacts]);
  const linkedCount = Object.keys(linkedArtifacts).length;
  const effectiveSourceAccess =
    restoredPendingSelectionIds?.length === 0 ? "READY" : sourceAccess;
  const visibleLocalError =
    effectiveSourceAccess === "READY" &&
    localError === EXPIRED_SOURCE_ACCESS_MESSAGE
      ? null
      : localError;

  const applyPreview = (nextPreview: FolderIntakePreviewResult): void => {
    setPreview(nextPreview);
    setSelectedIds(
      new Set(
        nextPreview.candidates
          .filter((candidate) => candidate.status === "READY")
          .map((candidate) => candidate.clientId),
      ),
    );
    setUploaded({});
    setSourceAccess("READY");
  };

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
      applyPreview(outcome.data);
    } finally {
      setSelecting(false);
    }
  };

  const previewDroppedFiles = async (files: File[]): Promise<void> => {
    if (previewingFiles || selecting) return;
    if (context.data === undefined) {
      setLocalError(
        "Finding file preview is unavailable until the case finishes loading.",
      );
      return;
    }
    if (files.length === 0) {
      setLocalError("Drop at least one finding file to preview it.");
      return;
    }
    if (files.length > 500) {
      setLocalError("Drop at most 500 finding files at once.");
      return;
    }
    const unsupported = files.find(
      (file) =>
        !FINDING_FILE_EXTENSIONS.some((extension) =>
          file.name.toLocaleLowerCase().endsWith(extension),
        ),
    );
    if (unsupported !== undefined) {
      setLocalError(
        `${unsupported.name} is not a supported finding file. Drop Markdown, JSON, CSV, or SARIF files.`,
      );
      return;
    }

    setPreviewingFiles(true);
    setLocalError(null);
    setSuccess(null);
    try {
      const outcome = await bridge().intake.previewFiles(files, context.data);
      if (!outcome.ok) {
        setLocalError(
          `${outcome.message} Choose or drop the files again to retry.`,
        );
        return;
      }
      applyPreview(outcome.data);
    } catch (error: unknown) {
      setLocalError(
        `${error instanceof Error ? error.message : "The finding files could not be previewed."} Choose or drop the files again to retry.`,
      );
    } finally {
      setPreviewingFiles(false);
    }
  };

  const dropFiles = (event: DragEvent<HTMLElement>): void => {
    event.preventDefault();
    setDraggingFiles(false);
    if (previewingFiles || selecting) return;
    void previewDroppedFiles(Array.from(event.dataTransfer.files));
  };

  const uploadAndCommit = async (): Promise<void> => {
    if (
      preview === null ||
      selectedCandidates.length === 0 ||
      effectiveSourceAccess !== "READY"
    )
      return;
    setUploading(true);
    setLocalError(null);
    try {
      const remaining = preview.selections.filter(
        (selection) =>
          uploaded[selection.relativePath] === undefined &&
          linkedArtifacts[selection.relativePath] === undefined,
      );
      let completed = { ...linkedArtifacts, ...uploaded };
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
          if (outcome.details?.code === "UPLOAD_SELECTION_UNAVAILABLE") {
            setSourceAccess("EXPIRED");
            setLocalError(EXPIRED_SOURCE_ACCESS_MESSAGE);
            return;
          }
          setLocalError(
            `${outcome.message} Retry the unfinished uploads. If the selection expired, cancel this preview and choose the files or folder again.`,
          );
          return;
        }
        completed = { ...linkedArtifacts, ...uploaded };
        const newlyUploaded = { ...uploaded };
        const failures: string[] = [];
        for (const item of outcome.data.items) {
          const selection = preview.selections.find(
            (candidate) => candidate.selectionId === item.selectionId,
          );
          if (selection === undefined) continue;
          if (item.artifactId === null) {
            failures.push(
              `${selection.relativePath}: ${safeUploadError(item.error)}`,
            );
          } else {
            completed[selection.relativePath] = item.artifactId;
            newlyUploaded[selection.relativePath] = item.artifactId;
          }
        }
        setUploaded(newlyUploaded);
        if (failures.length > 0) {
          setLocalError(`${failures.join(" ")} Retry to continue.`);
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
      setSourceAccess("READY");
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
      setSourceAccess("READY");
    } finally {
      setCleaning(false);
    }
  };

  return (
    <section
      className="border-t border-border pt-3"
      aria-label="File and folder intake"
    >
      {preview === null ? (
        <div className="space-y-2">
          <p className="max-w-[68ch] text-[11px] text-text-muted">
            Drop finding files from anywhere, or select a research folder. Both
            paths open a preview. The case changes only after you create and
            accept the drafts.
          </p>
          <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
            <label
              className={`flex min-h-16 cursor-pointer flex-col items-center justify-center rounded-(--cv-radius) border border-dashed px-4 py-3 text-center transition-colors motion-reduce:transition-none has-[:focus-visible]:border-focus has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-1 has-[:focus-visible]:outline-focus ${
                draggingFiles
                  ? "border-focus bg-surface-hover"
                  : "border-border-strong bg-surface hover:bg-surface-hover"
              } ${context.data === undefined ? "cursor-not-allowed opacity-50" : ""}`}
              aria-disabled={context.data === undefined}
              aria-busy={previewingFiles}
              onDragEnter={(event) => {
                event.preventDefault();
                if (
                  context.data !== undefined &&
                  !previewingFiles &&
                  !selecting
                ) {
                  setDraggingFiles(true);
                }
              }}
              onDragOver={(event) => {
                event.preventDefault();
                event.dataTransfer.dropEffect =
                  context.data === undefined || previewingFiles || selecting
                    ? "none"
                    : "copy";
              }}
              onDragLeave={(event) => {
                if (
                  event.relatedTarget instanceof Node &&
                  event.currentTarget.contains(event.relatedTarget)
                ) {
                  return;
                }
                setDraggingFiles(false);
              }}
              onDrop={dropFiles}
            >
              <input
                className="sr-only"
                type="file"
                multiple
                accept={FINDING_FILE_EXTENSIONS.join(",")}
                disabled={context.data === undefined || previewingFiles}
                aria-label="Choose finding files"
                onChange={(event) => {
                  const files = Array.from(event.currentTarget.files ?? []);
                  event.currentTarget.value = "";
                  void previewDroppedFiles(files);
                }}
              />
              <span
                className="text-[12px] font-medium text-text"
                aria-live="polite"
              >
                {previewingFiles
                  ? "Reading finding files..."
                  : draggingFiles
                    ? "Drop files to preview"
                    : "Drop finding files here"}
              </span>
              <span className="mt-0.5 text-[11px] text-text-muted">
                Markdown, JSON, CSV, or SARIF. You can also choose files.
              </span>
            </label>
            <Button
              size="sm"
              variant="secondary"
              loading={selecting}
              disabled={context.data === undefined || previewingFiles}
              onClick={() => void chooseFolder()}
            >
              Preview folder intake
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="text-[12px] font-semibold">{preview.rootName}</h3>
              <p className="mt-0.5 text-[11px] text-text-muted">
                {preview.files.length} original files ·{" "}
                {formatBytesApprox(preview.totalBytes)} · {linkedCount} already
                stored · {uploadedCount} newly uploaded
              </p>
            </div>
            <Button
              size="sm"
              variant="ghost"
              loading={cleaning}
              onClick={() => void cancelPreview()}
            >
              Cancel intake preview
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

          {linkedCount === 0 ? null : (
            <p className="rounded-(--cv-radius) bg-info/10 px-2.5 py-2 text-[11px] text-info">
              {linkedCount} source file{linkedCount === 1 ? " is" : "s are"}{" "}
              already stored in this case and will be reused. This is a
              source-file match, not a finding match.
            </p>
          )}

          <div>
            <div className="mb-1 flex items-center justify-between gap-3">
              <h4 className="text-[11px] font-medium">Proposed findings</h4>
              <span className="text-[10px] text-text-muted">
                Include only the drafts you want to create
              </span>
            </div>
            <div className="max-h-80 overflow-auto rounded-(--cv-radius) border border-border">
              {preview.candidates.length === 0 ? (
                <p className="px-3 py-4 text-[11px] text-text-muted">
                  No proposed findings were found. Cancel this preview and
                  choose another file or folder.
                </p>
              ) : null}
              {preview.candidates.length === 0 ? null : (
                <table
                  className="w-full min-w-[680px] table-fixed text-left"
                  aria-label="Proposed findings"
                >
                  <thead className="sticky top-0 z-10 bg-surface-subtle text-[10px] font-medium text-text-muted">
                    <tr className="border-b border-border">
                      <th scope="col" className="w-20 px-2.5 py-1.5">
                        <label className="flex cursor-pointer items-center gap-1.5">
                          <input
                            type="checkbox"
                            aria-label="Include all findings"
                            checked={
                              selectedCandidates.length ===
                              preview.candidates.length
                            }
                            ref={(input) => {
                              if (input !== null) {
                                input.indeterminate =
                                  selectedCandidates.length > 0 &&
                                  selectedCandidates.length <
                                    preview.candidates.length;
                              }
                            }}
                            onChange={(event) =>
                              setSelectedIds(
                                event.target.checked
                                  ? new Set(
                                      preview.candidates.map(
                                        (candidate) => candidate.clientId,
                                      ),
                                    )
                                  : new Set(),
                              )
                            }
                          />
                          Include
                        </label>
                      </th>
                      <th scope="col" className="w-[46%] px-2.5 py-1.5">
                        Finding
                      </th>
                      <th scope="col" className="px-2.5 py-1.5">
                        Review
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {preview.candidates.map((candidate) => {
                      const findingReasons = candidate.duplicateReasons.filter(
                        (reason) =>
                          reason.startsWith("A finding") ||
                          reason.startsWith("Another proposal"),
                      );
                      return (
                        <tr
                          key={candidate.clientId}
                          className={
                            selectedIds.has(candidate.clientId)
                              ? "bg-surface"
                              : "bg-surface-subtle/40 text-text-muted"
                          }
                        >
                          <td className="px-2.5 py-2 align-top">
                            <input
                              type="checkbox"
                              aria-label={`Include ${candidate.draft.title}`}
                              checked={selectedIds.has(candidate.clientId)}
                              onChange={(event) =>
                                setSelectedIds((current) => {
                                  const next = new Set(current);
                                  if (event.target.checked)
                                    next.add(candidate.clientId);
                                  else next.delete(candidate.clientId);
                                  return next;
                                })
                              }
                            />
                          </td>
                          <td className="px-2.5 py-2 align-top">
                            <span className="block text-[12px] font-medium text-text">
                              {candidate.draft.title}
                            </span>
                            <Mono className="mt-0.5 block truncate text-[10px] text-text-muted">
                              {candidate.sourcePath}
                            </Mono>
                          </td>
                          <td className="px-2.5 py-2 align-top text-[11px]">
                            <div className="flex flex-wrap gap-1">
                              {findingReasons.length === 0 ? (
                                <span className="rounded-sm bg-success/10 px-1.5 py-0.5 font-medium text-success">
                                  Ready
                                </span>
                              ) : (
                                <span className="rounded-sm bg-warning/10 px-1.5 py-0.5 font-medium text-warning">
                                  Possible duplicate
                                </span>
                              )}
                            </div>
                            {findingReasons.length === 0 ? null : (
                              <p className="mt-1 text-text-muted">
                                {findingReasons.join(" ")}
                              </p>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
            <p className="text-[11px] text-text-muted" aria-live="polite">
              {selectedCandidates.length} of {preview.candidates.length}{" "}
              findings selected. Acceptance still requires a separate review.
            </p>
            <Button
              size="sm"
              variant="primary"
              loading={uploading || commit.isPending}
              disabled={
                selectedCandidates.length === 0 ||
                effectiveSourceAccess !== "READY"
              }
              onClick={() => void uploadAndCommit()}
            >
              Create {selectedCandidates.length} intake draft
              {selectedCandidates.length === 1 ? "" : "s"}
            </Button>
          </div>
        </div>
      )}

      {visibleLocalError === null ? null : (
        <div className="mt-2">
          <InlineError>{visibleLocalError}</InlineError>
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

function safeUploadError(error: string | null): string {
  const message = error?.trim();
  if (message === undefined || message === "") return "The upload failed.";
  return message.slice(0, 300);
}

function restoreTransfer(storageKey: string): StoredTransfer | null {
  const raw = readLocalStorage(storageKey);
  if (raw === null) return null;
  try {
    const value = JSON.parse(raw) as unknown;
    return isStoredTransfer(value) ? value : null;
  } catch {
    removeLocalStorage(storageKey);
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
