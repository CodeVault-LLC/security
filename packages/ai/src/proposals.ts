import { Value } from "@sinclair/typebox/value";

import type { AiActionId } from "@codevault/contracts";

import {
  AI_FORBIDDEN_PATCH_FIELDS,
  aiAction,
  type AiActionDefinition,
} from "./actions.js";
import type {
  CvssSuggestionOutput,
  CweSuggestionOutput,
  DraftTextOutput,
  DraftTitleOutput,
  PolishSectionOutput,
  SubmissionFollowUpDraftOutput,
  SubmissionInitialDraftOutput,
  SubmissionReplyClassificationOutput,
} from "./schemas.js";

/**
 * Turning provider output into proposals.
 *
 * Three gates, in order: the output must parse as JSON, it must satisfy the
 * action's schema, and the patch it produces may only touch fields that action
 * declared. Failing any of them produces a failed run — never a proposal a
 * researcher might accept in a hurry.
 */

export class AiOutputError extends Error {
  readonly detail: string | undefined;

  constructor(message: string, detail?: string) {
    super(message);

    this.name = "AiOutputError";
    this.detail = detail;
  }
}

/**
 * Extracts the JSON object from provider stdout.
 *
 * Models wrap JSON in code fences or add a sentence of preamble often enough
 * that refusing outright would fail runs for no good reason. Anything beyond a
 * fence or surrounding whitespace is still rejected.
 */
export function extractJson(output: string): unknown {
  const trimmed = output.trim();

  if (trimmed.length === 0) {
    throw new AiOutputError("The provider returned no output.");
  }

  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(trimmed);
  const candidates = [
    fenced?.[1]?.trim(),
    trimmed,
    sliceOutermostObject(trimmed),
  ].filter((value): value is string => value !== undefined && value.length > 0);

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch {
      continue;
    }
  }

  throw new AiOutputError(
    "The provider's response was not valid JSON.",
    trimmed.slice(0, 500),
  );
}

function sliceOutermostObject(value: string): string | undefined {
  const start = value.indexOf("{");
  const end = value.lastIndexOf("}");

  if (start < 0 || end <= start) {
    return undefined;
  }

  return value.slice(start, end + 1);
}

/** Validates parsed output against the action's declared schema. */
export function validateOutput<T>(action: AiActionId, parsed: unknown): T {
  const definition = aiAction(action);
  const cleaned = Value.Clean(definition.outputSchema, parsed);

  if (!Value.Check(definition.outputSchema, cleaned)) {
    const [firstError] = [...Value.Errors(definition.outputSchema, cleaned)];
    const detail =
      firstError === undefined
        ? undefined
        : `${firstError.path}: ${firstError.message}`;

    throw new AiOutputError(
      `The provider's response did not match what ${action} expects.`,
      detail,
    );
  }

  return cleaned as T;
}

export interface ProposalDraft {
  patch: Record<string, unknown>;
  rationaleMarkdown: string;
}

/**
 * Rejects a patch that reaches beyond what the action is allowed to change.
 *
 * Belt and braces with the per-action allow-list: the forbidden list names the
 * fields that are never AI-writable regardless of which action produced them.
 */
export function assertPatchAllowed(
  definition: AiActionDefinition,
  patch: Record<string, unknown>,
): void {
  for (const field of Object.keys(patch)) {
    if (AI_FORBIDDEN_PATCH_FIELDS.includes(field)) {
      throw new AiOutputError(
        `AI cannot change "${field}". That is a decision a person records.`,
      );
    }

    if (!definition.allowedPatchFields.includes(field)) {
      throw new AiOutputError(
        `The ${definition.id} action may not change "${field}".`,
      );
    }
  }
}

/**
 * Builds the proposal for an action from its validated output.
 *
 * Review actions produce no patch: their value is the analysis, which the
 * researcher reads and acts on themselves.
 */
export function buildProposal(
  action: AiActionId,
  output: unknown,
): ProposalDraft | null {
  const definition = aiAction(action);

  if (!definition.producesPatch) {
    return null;
  }

  const patch = patchFor(action, output);

  assertPatchAllowed(definition, patch.patch);

  return patch;
}

function patchFor(action: AiActionId, output: unknown): ProposalDraft {
  switch (action) {
    case "FINDING_DRAFT_TITLE": {
      const typed = output as DraftTitleOutput;

      return {
        patch: { title: typed.title },
        rationaleMarkdown: renderTitleRationale(typed),
      };
    }

    case "FINDING_DRAFT_SUMMARY":
    case "FINDING_DRAFT_TECHNICAL":
    case "FINDING_DRAFT_IMPACT":
    case "FINDING_DRAFT_REMEDIATION": {
      const typed = output as DraftTextOutput;
      const field = aiAction(action).allowedPatchFields[0];

      if (field === undefined) {
        throw new AiOutputError(`Action ${action} has no target field.`);
      }

      return {
        patch: { [field]: typed.markdown },
        rationaleMarkdown: renderDraftRationale(typed),
      };
    }

    case "FINDING_SUGGEST_CWE": {
      const typed = output as CweSuggestionOutput;

      return {
        patch: { cweIds: typed.candidates.map((candidate) => candidate.cweId) },
        rationaleMarkdown: renderCweRationale(typed),
      };
    }

    case "FINDING_SUGGEST_CVSS40":
    case "FINDING_SUGGEST_CVSS31": {
      const typed = output as CvssSuggestionOutput;

      return {
        // Metrics only. The vector is assembled and the score computed by
        // CodeVault once a researcher has approved each metric.
        patch: {
          metrics: Object.fromEntries(
            typed.metrics.map((metric) => [metric.metric, metric.value]),
          ),
          reasoningMarkdown: renderCvssRationale(typed),
        },
        rationaleMarkdown: renderCvssRationale(typed),
      };
    }

    case "REPORT_DRAFT_SECTION": {
      const typed = output as DraftTextOutput;

      return {
        patch: { contentMarkdown: typed.markdown },
        rationaleMarkdown: renderDraftRationale(typed),
      };
    }

    case "REPORT_POLISH_SECTION": {
      const typed = output as PolishSectionOutput;

      return {
        patch: { contentMarkdown: typed.markdown },
        rationaleMarkdown: renderPolishRationale(typed),
      };
    }

    case "SUBMISSION_DRAFT_INITIAL": {
      const typed = output as SubmissionInitialDraftOutput;
      return {
        patch: { subject: typed.subject, bodyMarkdown: typed.bodyMarkdown },
        rationaleMarkdown:
          typed.rationale + renderList("Sources used", typed.sourceRefs),
      };
    }

    case "SUBMISSION_DRAFT_FOLLOW_UP": {
      const typed = output as SubmissionFollowUpDraftOutput;
      return {
        patch: { bodyMarkdown: typed.bodyMarkdown },
        rationaleMarkdown:
          typed.rationale +
          renderList("Sources used", typed.sourceRefs) +
          renderList("Questions to verify", typed.questions),
      };
    }

    case "SUBMISSION_CLASSIFY_REPLY": {
      const typed = output as SubmissionReplyClassificationOutput;
      const first = typed.rankings[0];
      if (first === undefined) {
        throw new AiOutputError("Reply classification returned no ranking.");
      }
      return {
        patch: { classification: first.classification },
        rationaleMarkdown: typed.rationale,
      };
    }

    default:
      throw new AiOutputError(`Action ${action} does not produce a patch.`);
  }
}

function renderList(heading: string, items: readonly string[]): string {
  if (items.length === 0) {
    return "";
  }

  return `\n\n**${heading}**\n\n${items.map((item) => `- ${item}`).join("\n")}`;
}

function renderDraftRationale(output: DraftTextOutput): string {
  return (
    output.rationale +
    renderList("Sources used", output.sourceIds) +
    renderList("Not supported by the supplied context", output.uncertainties)
  );
}

function renderTitleRationale(output: DraftTitleOutput): string {
  return output.rationale + renderList("Alternatives", output.alternatives);
}

function renderCweRationale(output: CweSuggestionOutput): string {
  const rows = output.candidates
    .map(
      (candidate) =>
        `| ${candidate.cweId} | ${candidate.name} | ${candidate.confidence} | ${candidate.reasoning} |`,
    )
    .join("\n");

  return `${output.rationale}\n\n| CWE | Name | Confidence | Reasoning |\n| --- | --- | --- | --- |\n${rows}`;
}

function renderCvssRationale(output: CvssSuggestionOutput): string {
  const rows = output.metrics
    .map(
      (metric) =>
        `| ${metric.metric} | ${metric.value} | ${metric.confidence} | ${metric.reasoning} |`,
    )
    .join("\n");

  return (
    `${output.rationale}\n\n| Metric | Proposed | Confidence | Reasoning |\n` +
    `| --- | --- | --- | --- |\n${rows}` +
    renderList("Not established by the supplied context", output.unknownMetrics)
  );
}

function renderPolishRationale(output: PolishSectionOutput): string {
  return output.rationale + renderList("Changes", output.changes);
}
