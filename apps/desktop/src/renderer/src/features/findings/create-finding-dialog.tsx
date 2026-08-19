import { useNavigate } from "@tanstack/react-router";
import { FolderOpen } from "lucide-react";
import { useState } from "react";

import type {
  AssetSummary,
  CaseSummary,
  FindingDetail,
} from "@codevault/contracts";
import { SEVERITY_RATINGS, type SeverityRating } from "@codevault/standards";
import {
  assetKindIcon,
  Button,
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  Input,
  Label,
  Select,
  severitySelectOptions,
} from "@codevault/ui";

import {
  errorHeading,
  queryKeys,
  useApiMutation,
  useApiQuery,
} from "../../lib/api.js";
import { MarkdownField } from "../markdown/markdown-field.js";
import { clearDraft } from "../markdown/drafts.js";
import { QueryError } from "../../components/query-boundary.js";

/**
 * Finding creation.
 *
 * Five fields, three optional. A researcher who has just reproduced something
 * should be able to record it in fifteen seconds; the technical description,
 * the score, the evidence and the disclosure plan all come later.
 */

export interface CreateFindingDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Pre-selects a case when opened from within one. */
  caseId?: string;
  /** Pre-selects the affected asset when opened from an asset workspace. */
  assetId?: string;
}

interface Paginated<T> {
  items: T[];
  nextCursor: string | null;
}

export function CreateFindingDialog({
  open,
  onOpenChange,
  caseId,
  assetId: initialAssetId,
}: CreateFindingDialogProps): React.JSX.Element {
  const navigate = useNavigate();
  const [selectedCaseId, setSelectedCaseId] = useState(caseId ?? "");
  const [title, setTitle] = useState("");
  const [summary, setSummary] = useState("");
  const [assetId, setAssetId] = useState<string>(initialAssetId ?? "");
  const [severity, setSeverity] = useState<SeverityRating | "">("");

  const cases = useApiQuery<Paginated<CaseSummary>>(
    queryKeys.cases({ status: "OPEN" }),
    "/v1/cases?status=OPEN&limit=100",
    { enabled: open },
  );

  const assets = useApiQuery<Paginated<AssetSummary>>(
    queryKeys.assets({ caseId: selectedCaseId }),
    selectedCaseId.length === 0
      ? "/v1/assets?limit=100"
      : `/v1/assets?caseId=${selectedCaseId}&limit=100`,
    { enabled: open },
  );

  const create = useApiMutation<FindingDetail>(
    () => ({
      path: "/v1/findings",
      method: "POST",
      body: {
        caseId: selectedCaseId,
        title: title.trim(),
        ...(summary.trim().length === 0
          ? {}
          : { summaryMarkdown: summary.trim() }),
        ...(assetId.length === 0 ? {} : { primaryAssetId: assetId }),
        ...(severity === "" ? {} : { initialSeverity: severity }),
      },
    }),
    () => [queryKeys.findings(), queryKeys.cases(), queryKeys.dashboard],
  );

  const submit = (): void => {
    if (selectedCaseId.length === 0 || title.trim().length === 0) {
      return;
    }

    create.mutate(undefined, {
      onSuccess: (created) => {
        clearDraft(`finding:new:${selectedCaseId}`);
        onOpenChange(false);
        setTitle("");
        setSummary("");
        setAssetId(initialAssetId ?? "");
        setSeverity("");
        void navigate({ to: `/findings/${created.id}` });
      },
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="New finding"
        description="Record it now; the analysis, score and evidence come later."
      >
        <DialogBody className="space-y-3">
          <div>
            <Label>Case</Label>
            <Select
              aria-label="Case"
              value={selectedCaseId.length === 0 ? undefined : selectedCaseId}
              onValueChange={setSelectedCaseId}
              placeholder={cases.isLoading ? "Loading cases…" : "Choose a case"}
              disabled={cases.isLoading || cases.error !== null}
              className="mt-1"
              options={(cases.data?.items ?? []).map((item) => ({
                value: item.id,
                label: item.title,
                description: item.ref,
                icon: <FolderOpen className="size-3.5" />,
              }))}
            />
          </div>

          <QueryError query={cases} />
          <QueryError query={assets} />

          <div>
            <Label htmlFor="finding-title">Title</Label>
            <Input
              id="finding-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Unauthenticated command injection in the firmware update endpoint"
              autoFocus
              className="mt-1"
            />
          </div>

          <div>
            <Label>Affected asset (optional)</Label>
            <Select
              aria-label="Affected asset"
              value={assetId.length === 0 ? undefined : assetId}
              onValueChange={setAssetId}
              placeholder={
                assets.isLoading ? "Loading assets…" : "Choose an asset"
              }
              disabled={assets.isLoading || assets.error !== null}
              className="mt-1"
              options={(assets.data?.items ?? []).map((item) => ({
                value: item.id,
                label: `${item.name}${item.version === null ? "" : ` ${item.version}`}`,
                description: item.ref,
                icon: assetKindIcon(item.kind),
              }))}
            />
          </div>

          <div>
            <Label>Short summary (optional)</Label>
            <div className="mt-1">
              <MarkdownField
                ariaLabel="Short summary"
                value={summary}
                onChange={setSummary}
                draftKey={`finding:new:${selectedCaseId}`}
                caseId={
                  selectedCaseId.length === 0 ? undefined : selectedCaseId
                }
                minHeight="8rem"
                placeholder="What it is, in a sentence or two. Markdown."
              />
            </div>
          </div>

          <div>
            <Label>Initial severity (optional)</Label>
            <Select
              aria-label="Initial severity"
              value={severity === "" ? undefined : severity}
              onValueChange={(value) => setSeverity(value as SeverityRating)}
              placeholder="Leave unscored"
              className="mt-1"
              options={severitySelectOptions(SEVERITY_RATINGS)}
            />
            <p className="mt-1 text-[11px] text-text-muted">
              A placeholder for triage only. It is replaced the moment a CVSS
              vector is approved.
            </p>
          </div>

          {create.error === null ? null : (
            <p className="rounded-(--cv-radius) border border-danger/40 bg-danger/10 px-2 py-1.5 text-[12px] text-danger">
              <span className="font-medium">{errorHeading(create.error)}.</span>{" "}
              {create.error.message}
            </p>
          )}
        </DialogBody>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={submit}
            disabled={selectedCaseId.length === 0 || title.trim().length === 0}
            loading={create.isPending}
          >
            Create finding
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
