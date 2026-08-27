import { Link } from "@tanstack/react-router";
import { MailSearch } from "lucide-react";

import type { SubmissionDetail } from "@codevault/contracts";
import { Button } from "@codevault/ui";

export function ChooseFromMail({
  submission,
}: {
  submission: Pick<SubmissionDetail, "id">;
}): React.JSX.Element {
  return (
    <div className="mt-3 border-t border-border pt-3">
      <Button asChild variant="secondary" size="sm">
        <Link
          to="/mail"
          search={{
            folder: "SENT",
            submissionId: submission.id,
            connectionId: undefined,
            threadId: undefined,
          }}
        >
          <MailSearch aria-hidden /> Choose from Mail
        </Link>
      </Button>
      <p className="mt-1.5 text-pretty text-[11px] leading-4 text-text-muted">
        Open sent Gmail, review the conversation, then track it against this
        disclosure.
      </p>
    </div>
  );
}
