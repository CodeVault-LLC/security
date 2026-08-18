import { useState } from "react";

import type {
  AiProposal,
  AiRunWithProposals,
  SubmissionDetail,
} from "@codevault/contracts";
import { AiProposalPanel } from "@codevault/ui";

import { AiToolbar, type AiAction } from "../ai/ai-toolbar.js";
import { queryKeys, useApiMutation } from "../../lib/api.js";

const ACTIONS: readonly AiAction[] = [
  {
    id: "SUBMISSION_DRAFT_INITIAL",
    label: "Draft first contact",
    description: "Draft subject and body from vendor-visible records.",
  },
  {
    id: "SUBMISSION_DRAFT_FOLLOW_UP",
    label: "Draft follow-up",
    description: "Draft a reply from the tracked thread.",
  },
  {
    id: "SUBMISSION_LEAK_REVIEW",
    label: "Leak review",
    description: "Look for content that should not leave the workspace.",
  },
];

export function SubmissionAiToolbar({
  submission,
}: {
  submission: SubmissionDetail;
}): React.JSX.Element {
  const [proposals, setProposals] = useState<
    Array<{ proposal: AiProposal; model: AiRunWithProposals["model"] }>
  >([]);
  return (
    <div className="space-y-2">
      <AiToolbar
        targetType="SUBMISSION"
        targetId={submission.id}
        actions={ACTIONS}
        disabled={
          !["DRAFT", "IN_REVIEW", "APPROVED"].includes(submission.status)
        }
        onCompleted={(run) =>
          setProposals((current) => [
            ...run.proposals.map((proposal) => ({
              proposal,
              model: run.model,
            })),
            ...current,
          ])
        }
      />
      {proposals.map(({ proposal, model }) => (
        <SubmissionProposal
          key={proposal.id}
          proposal={proposal}
          model={model}
          submission={submission}
          onResolved={() =>
            setProposals((current) =>
              current.filter((item) => item.proposal.id !== proposal.id),
            )
          }
        />
      ))}
    </div>
  );
}

function SubmissionProposal({
  proposal,
  model,
  submission,
  onResolved,
}: {
  proposal: AiProposal;
  model: AiRunWithProposals["model"];
  submission: SubmissionDetail;
  onResolved: () => void;
}): React.JSX.Element {
  const accept = useApiMutation<AiProposal>(
    () => ({
      path: `/v1/ai/proposals/${proposal.id}/accept`,
      body: { expectedRevision: submission.revision },
    }),
    () => [
      queryKeys.submission(submission.id),
      queryKeys.submissionValidation(submission.id),
    ],
  );
  const reject = useApiMutation<{ ok: true }>(
    () => ({ path: `/v1/ai/proposals/${proposal.id}/reject`, body: {} }),
    () => [queryKeys.submission(submission.id)],
  );
  return (
    <AiProposalPanel
      proposal={proposal}
      currentValues={{
        subject: submission.subject,
        bodyMarkdown: submission.bodyMarkdown,
      }}
      model={model}
      busy={accept.isPending || reject.isPending}
      onAccept={() => accept.mutate(undefined, { onSuccess: onResolved })}
      onReject={() => reject.mutate(undefined, { onSuccess: onResolved })}
    />
  );
}
