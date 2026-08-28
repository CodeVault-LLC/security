import { useState } from "react";

import type { SubmissionDetail } from "@codevault/contracts";
import { Button, Input, Label } from "@codevault/ui";

import { MarkdownField } from "../markdown/markdown-field.js";
import { SubmissionAiToolbar } from "./submission-ai-toolbar.js";

export function SubmissionComposer({
  submission,
  canEdit,
  saving,
  onSave,
}: {
  submission: SubmissionDetail;
  canEdit: boolean;
  saving: boolean;
  onSave: (input: {
    subject: string;
    bodyMarkdown: string;
    manualFields: Record<string, string>;
  }) => void;
}): React.JSX.Element {
  const [subject, setSubject] = useState(submission.subject);
  const [bodyMarkdown, setBodyMarkdown] = useState(submission.bodyMarkdown);
  const [manualFields, setManualFields] = useState(submission.manualFields);

  const route = submission.routeSnapshot.route;
  const locked =
    !canEdit || !["DRAFT", "IN_REVIEW", "APPROVED"].includes(submission.status);

  return (
    <div className="space-y-3">
      {canEdit ? <SubmissionAiToolbar submission={submission} /> : null}
      {route.type === "EMAIL" ? (
        <div>
          <Label htmlFor="submission-subject">Subject</Label>
          <Input
            id="submission-subject"
            value={subject}
            disabled={locked}
            onChange={(event) => setSubject(event.target.value)}
            className="mt-1"
          />
          {submission.cryptoMode !== "PLAIN" ? (
            <p className="mt-1 text-[11px] text-warning">
              The email subject is never encrypted.
            </p>
          ) : null}
        </div>
      ) : (
        <div className="space-y-3">
          {route.fieldMappings.map((field) => (
            <div key={field.key}>
              <Label htmlFor={`manual-${field.key}`}>
                {field.label}
                {field.required ? " *" : ""}
              </Label>
              <textarea
                id={`manual-${field.key}`}
                value={manualFields[field.key] ?? ""}
                disabled={locked}
                onChange={(event) =>
                  setManualFields((current) => ({
                    ...current,
                    [field.key]: event.target.value,
                  }))
                }
                className="mt-1 min-h-20 w-full rounded border border-border bg-surface px-2 py-1.5 text-[12px]"
              />
              {field.helpText === null ? null : (
                <p className="mt-1 text-[11px] text-text-muted">
                  {field.helpText}
                </p>
              )}
            </div>
          ))}
        </div>
      )}

      <div>
        <Label>Submission notes / plain-text body</Label>
        <MarkdownField
          ariaLabel="Submission notes and plain-text body"
          value={bodyMarkdown}
          onChange={setBodyMarkdown}
          readOnly={locked}
          draftKey={`submission:${submission.id}:body`}
        />
      </div>

      {locked ? null : (
        <Button
          variant="primary"
          size="sm"
          loading={saving}
          onClick={() => onSave({ subject, bodyMarkdown, manualFields })}
        >
          Save draft
        </Button>
      )}
    </div>
  );
}
