import { FileJson2, Upload } from "lucide-react";
import { useEffect, useState } from "react";

import {
  EVIDENCE_CUSTODY_EVENT_TYPES,
  type Artifact,
  type Evidence,
  type EvidenceCustodyEvent,
} from "@codevault/contracts";
import { ARTIFACT_KINDS, CONTENT_VISIBILITIES } from "@codevault/core";
import { buildEvidenceManifest } from "@codevault/exchange/evidence-manifest";
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
  Textarea,
  visibilitySelectOptions,
} from "@codevault/ui";

import type {
  UploadProgress,
  UploadSelection,
} from "../../../../preload/contracts.js";
import { QueryError } from "../../components/query-boundary.js";
import { bridge } from "../../lib/bridge.js";
import { formatDateTime } from "../../lib/dates.js";
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
  const [exporting, setExporting] = useState(false);
  const [exportMessage, setExportMessage] = useState<string | null>(null);
  const [redactionArtifact, setRedactionArtifact] = useState<Artifact | null>(
    null,
  );
  const [redactionTerms, setRedactionTerms] = useState("");
  const [custodyEvidence, setCustodyEvidence] = useState<Evidence | null>(null);
  const [custodyEventType, setCustodyEventType] = useState("VERIFIED");
  const [custodian, setCustodian] = useState("");
  const [custodyNote, setCustodyNote] = useState("");

  const query =
    findingId === undefined
      ? `/v1/evidence?caseId=${caseId}&limit=100`
      : `/v1/evidence?caseId=${caseId}&findingId=${findingId}&limit=100`;

  const evidence = useApiQuery<Paginated<Evidence>>(
    queryKeys.evidence({ caseId, findingId }),
    query,
  );

  const items = evidence.data?.items ?? [];
  const saveRedaction = useApiMutation<
    Artifact,
    { artifact: Artifact; terms: string[] }
  >(
    ({ artifact, terms }) => ({
      path: `/v1/artifacts/${artifact.id}/preview-redaction`,
      method: "PATCH",
      body: {
        rules: terms.map((match) => ({ match, replacement: "[REDACTED]" })),
        expectedRevision: artifact.previewRedaction?.revision ?? null,
      },
    }),
    () => [queryKeys.evidence({ caseId, findingId })],
  );
  const custodyKey = ["evidence-custody", custodyEvidence?.id ?? "closed"];
  const custody = useApiQuery<EvidenceCustodyEvent[]>(
    custodyKey,
    `/v1/evidence/${custodyEvidence?.id ?? "00000000-0000-4000-8000-000000000000"}/custody`,
    { enabled: custodyEvidence !== null },
  );
  const attestCustody = useApiMutation<
    EvidenceCustodyEvent,
    { evidenceId: string }
  >(
    ({ evidenceId }) => ({
      path: `/v1/evidence/${evidenceId}/custody`,
      body: {
        eventType: custodyEventType,
        custodian: custodian.trim(),
        ...(custodyNote.trim().length === 0
          ? {}
          : { note: custodyNote.trim() }),
      },
    }),
    () => [custodyKey],
  );

  const manageRedaction = (artifact: Artifact): void => {
    setRedactionArtifact(artifact);
    setRedactionTerms(
      artifact.previewRedaction?.rules.map((rule) => rule.match).join("\n") ??
        "",
    );
  };

  const submitRedaction = (): void => {
    if (redactionArtifact === null) return;
    const terms = [
      ...new Set(
        redactionTerms
          .split("\n")
          .map((term) => term.trim())
          .filter((term) => term.length > 0),
      ),
    ];
    saveRedaction.mutate(
      { artifact: redactionArtifact, terms },
      { onSuccess: () => setRedactionArtifact(null) },
    );
  };

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

  const exportManifest = async (): Promise<void> => {
    if (items.length === 0) return;
    setExporting(true);
    setExportMessage(null);
    try {
      const manifest = buildEvidenceManifest({
        caseId,
        ...(findingId === undefined ? {} : { findingId }),
        generatedAt: new Date().toISOString(),
        evidence: items,
      });
      const outcome = await bridge().evidence.saveManifest(
        caseId,
        findingId ?? null,
        manifest,
      );
      if (!outcome.ok) {
        setExportMessage(
          `${outcome.message} Choose Export shown manifest to retry.`,
        );
      } else if (outcome.data.saved) {
        setExportMessage(
          `Manifest saved. SHA-256 ${outcome.data.sha256?.slice(0, 12)}…`,
        );
      }
    } catch {
      setExportMessage("The evidence manifest could not be saved.");
    } finally {
      setExporting(false);
    }
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
          {exportMessage === null ? null : (
            <p className="mt-1 text-[11px] text-text-muted" role="status">
              {exportMessage}
            </p>
          )}
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          <Button
            variant="secondary"
            size="sm"
            loading={exporting}
            disabled={items.length === 0}
            title="Exports metadata and SHA-256 digests, not evidence files"
            onClick={() => void exportManifest()}
          >
            <FileJson2 aria-hidden className="size-3.5" />
            Export shown manifest
          </Button>
          {canEdit ? (
            <Button
              variant="primary"
              size="sm"
              onClick={() => setUploadOpen(true)}
            >
              <Upload aria-hidden className="size-3.5" strokeWidth={2} />
              Add evidence
            </Button>
          ) : null}
        </div>
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
              {...(canEdit
                ? { onManagePreviewRedaction: manageRedaction }
                : {})}
              onOpenCustody={() => setCustodyEvidence(item)}
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
      <Dialog
        open={redactionArtifact !== null}
        onOpenChange={(open) => {
          if (!open && !saveRedaction.isPending) setRedactionArtifact(null);
        }}
      >
        <DialogContent title="Manage preview redaction">
          <DialogBody>
            <p className="text-[12px] text-text-muted">
              Enter one exact value per line. Every occurrence is replaced with
              [REDACTED] in previews and AI context. The original file and
              generated source excerpt stay unchanged.
            </p>
            <Label className="mt-4 block">
              Sensitive values
              <Textarea
                className="mt-1 min-h-32 font-mono"
                value={redactionTerms}
                placeholder={"api-key-value\ninternal.example.test"}
                onChange={(event) => setRedactionTerms(event.target.value)}
              />
            </Label>
            {saveRedaction.error === null ? null : (
              <p role="alert" className="mt-2 text-[12px] text-danger">
                {saveRedaction.error.message}
              </p>
            )}
          </DialogBody>
          <DialogFooter>
            <Button
              variant="ghost"
              disabled={saveRedaction.isPending}
              onClick={() => setRedactionArtifact(null)}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              loading={saveRedaction.isPending}
              onClick={submitRedaction}
            >
              {redactionTerms.trim().length === 0
                ? "Clear redaction"
                : "Save redaction"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog
        open={custodyEvidence !== null}
        onOpenChange={(open) => {
          if (!open && !attestCustody.isPending) setCustodyEvidence(null);
        }}
      >
        <DialogContent title="Evidence custody log" width="max-w-2xl">
          <DialogBody>
            <p className="text-[12px] text-text-muted">
              Each attestation is append-only and links to the previous event
              hash. This records handling history without changing the evidence
              file.
            </p>
            <QueryError query={custody} className="mt-3" />
            <ol className="mt-3 max-h-64 space-y-2 overflow-auto">
              {(custody.data ?? []).map((event) => (
                <li
                  key={event.id}
                  className="rounded-(--cv-radius) border border-border p-3 text-[12px]"
                >
                  <div className="flex items-center justify-between gap-3">
                    <strong>{event.eventType.replaceAll("_", " ")}</strong>
                    <span className="text-text-muted">
                      {formatDateTime(event.occurredAt)}
                    </span>
                  </div>
                  <p className="mt-1">Custodian: {event.custodian}</p>
                  {event.note === null ? null : (
                    <p className="mt-1 text-text-muted">{event.note}</p>
                  )}
                  <p className="mt-2 break-all font-mono text-[10px] text-text-muted">
                    SHA-256 {event.eventHash}
                  </p>
                </li>
              ))}
            </ol>
            {(custody.data?.length ?? 0) === 0 && !custody.isLoading ? (
              <p className="mt-3 text-[12px] text-text-muted">
                No custody attestations yet.
              </p>
            ) : null}
            {canEdit ? (
              <div className="mt-4 grid gap-3 border-t border-border pt-4 sm:grid-cols-2">
                <Label>
                  Event
                  <Select
                    className="mt-1"
                    value={custodyEventType}
                    onValueChange={setCustodyEventType}
                    options={EVIDENCE_CUSTODY_EVENT_TYPES.map((value) => ({
                      value,
                      label: value.replaceAll("_", " "),
                    }))}
                  />
                </Label>
                <Label>
                  Custodian
                  <Input
                    className="mt-1"
                    value={custodian}
                    placeholder="Person, team, or secure location"
                    onChange={(event) => setCustodian(event.target.value)}
                  />
                </Label>
                <Label className="sm:col-span-2">
                  Note
                  <Textarea
                    className="mt-1 min-h-20"
                    value={custodyNote}
                    onChange={(event) => setCustodyNote(event.target.value)}
                  />
                </Label>
              </div>
            ) : null}
            {attestCustody.error === null ? null : (
              <p role="alert" className="mt-2 text-[12px] text-danger">
                {attestCustody.error.message}
              </p>
            )}
          </DialogBody>
          <DialogFooter>
            <Button
              variant="ghost"
              disabled={attestCustody.isPending}
              onClick={() => setCustodyEvidence(null)}
            >
              Close
            </Button>
            {!canEdit || custodyEvidence === null ? null : (
              <Button
                variant="primary"
                loading={attestCustody.isPending}
                disabled={custodian.trim().length === 0}
                onClick={() =>
                  attestCustody.mutate(
                    { evidenceId: custodyEvidence.id },
                    {
                      onSuccess: () => {
                        setCustodyNote("");
                        setCustodian("");
                      },
                    },
                  )
                }
              >
                Add attestation
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
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
  const [uploadedArtifacts, setUploadedArtifacts] = useState<
    Record<string, string>
  >({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const unsubscribe = bridge().uploads.onProgress((update) => {
      setProgress((current) => ({
        ...current,
        [update.selectionId]: update,
      }));
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

    if (picked.length === 0) return;

    const uploadedIds = Object.values(uploadedArtifacts);
    if (uploadedIds.length > 0) {
      void bridge().uploads.discard(uploadedIds);
    }

    setSelections(picked);
    setProgress({});
    setUploadedArtifacts({});
    setArtifactKind(inferArtifactKind(picked));

    if (title.trim().length === 0 && picked[0] !== undefined) {
      setTitle(picked[0].filename);
    }
  };

  const upload = async (onlySelectionId?: string): Promise<void> => {
    if (selections.length === 0 || title.trim().length === 0) {
      return;
    }

    setBusy(true);
    setError(null);

    try {
      const pendingSelections = selections.filter(
        (selection) =>
          uploadedArtifacts[selection.selectionId] === undefined &&
          (onlySelectionId === undefined ||
            selection.selectionId === onlySelectionId),
      );
      const nextUploaded = { ...uploadedArtifacts };

      if (pendingSelections.length > 0) {
        const outcome = await bridge().uploads.start({
          caseId,
          ...(findingId === undefined ? {} : { findingId }),
          artifactKind,
          visibility: visibility as "INTERNAL" | "VENDOR" | "PUBLIC",
          selections: pendingSelections,
        });

        if (!outcome.ok) {
          setError(outcome.message);
          return;
        }

        for (const item of outcome.data.items) {
          if (item.artifactId !== null) {
            nextUploaded[item.selectionId] = item.artifactId;
          }
        }
        setUploadedArtifacts(nextUploaded);

        const failed = outcome.data.items.filter(
          (item) => item.artifactId === null,
        );
        if (failed.length > 0) {
          setError(
            `${failed.length} file${failed.length === 1 ? "" : "s"} could not be uploaded. Retry each failed file below.`,
          );
          return;
        }
      }

      const artifactIds = selections
        .map((selection) => nextUploaded[selection.selectionId])
        .filter((id): id is string => id !== undefined);
      if (artifactIds.length !== selections.length) {
        setError(
          `${artifactIds.length} of ${selections.length} files are stored. Retry the remaining failed files.`,
        );
        return;
      }

      createEvidence.mutate(artifactIds, {
        onSuccess: () => {
          onOpenChange(false);
          setSelections([]);
          setTitle("");
          setDescription("");
          setProgress({});
          setUploadedArtifacts({});
        },
        onError: (mutationError) =>
          setError(
            `The files are stored, but the evidence record was not created. ${mutationError.message} Retry to attach the stored files without uploading them again.`,
          ),
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (busy || createEvidence.isPending) return;
        if (!nextOpen) {
          const uploadedIds = Object.values(uploadedArtifacts);
          if (uploadedIds.length > 0) {
            void bridge().uploads.discard(uploadedIds);
          }
          setSelections([]);
          setProgress({});
          setUploadedArtifacts({});
          setError(null);
        }
        onOpenChange(nextOpen);
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
                const update = progress[selection.selectionId];
                const uploaded =
                  uploadedArtifacts[selection.selectionId] !== undefined;

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
                    {uploaded ? (
                      <span className="w-20 shrink-0 text-right text-success">
                        stored
                      </span>
                    ) : update === undefined ? null : (
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
                    {update?.phase === "FAILED" && !uploaded ? (
                      <Button
                        variant="secondary"
                        size="sm"
                        disabled={busy || createEvidence.isPending}
                        title={update.message ?? "Retry this file"}
                        onClick={() => void upload(selection.selectionId)}
                      >
                        Retry
                      </Button>
                    ) : null}
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
              {error} Your files and description remain available until you
              cancel this dialog.
            </p>
          )}
        </DialogBody>

        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => {
              const uploadedIds = Object.values(uploadedArtifacts);
              if (uploadedIds.length > 0) {
                void bridge().uploads.discard(uploadedIds);
              }
              setSelections([]);
              setProgress({});
              setUploadedArtifacts({});
              setError(null);
              onOpenChange(false);
            }}
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
            {Object.keys(uploadedArtifacts).length === selections.length &&
            selections.length > 0
              ? "Attach stored files"
              : Object.keys(uploadedArtifacts).length > 0
                ? "Retry remaining files"
                : "Upload evidence"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function inferArtifactKind(selections: readonly UploadSelection[]): string {
  const kinds = new Set(
    selections.map((selection) => {
      const filename = selection.filename.toLowerCase();
      if (filename.endsWith(".har")) return "HAR";
      if (filename.endsWith(".pcap") || filename.endsWith(".pcapng"))
        return "PCAP";
      if (filename.endsWith(".log")) return "LOG";
      if (/\.(?:c|cpp|go|java|js|py|rb|rs|ts)$/u.test(filename))
        return "SOURCE_CODE";
      if (/\.(?:zip|tar|gz|7z)$/u.test(filename)) return "ARCHIVE";
      if (selection.mimeType.startsWith("image/")) return "SCREENSHOT";
      if (selection.mimeType.startsWith("video/")) return "VIDEO";
      if (
        selection.mimeType.startsWith("text/") ||
        selection.mimeType === "application/json" ||
        selection.mimeType === "application/pdf"
      )
        return "DOCUMENT";
      return "OTHER";
    }),
  );

  return kinds.size === 1 ? ([...kinds][0] ?? "OTHER") : "OTHER";
}
