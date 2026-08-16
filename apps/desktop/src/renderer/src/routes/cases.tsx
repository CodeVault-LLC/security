import { Link } from "@tanstack/react-router";
import { Plus } from "lucide-react";
import { useState } from "react";

import type { CaseSummary } from "@codevault/contracts";
import {
  Button,
  EmptyState,
  ErrorState,
  LoadingState,
  Mono,
  StateBadge,
} from "@codevault/ui";

import { PageHeader } from "../components/app-shell.js";
import { CreateCaseDialog } from "../features/cases/create-case-dialog.js";
import { formatDistanceToNowStrict } from "../lib/dates.js";
import { humanise } from "../lib/format.js";
import { errorHeading, queryKeys, useApiQuery } from "../lib/api.js";
import { canWrite, useSession } from "../lib/session.js";

/**
 * The case list.
 *
 * Restricted cases the researcher is not on simply do not appear — the server
 * filters them out rather than showing a locked row, because the existence of
 * an embargoed case is itself information.
 */

interface Paginated<T> {
  items: T[];
  nextCursor: string | null;
}

export function CasesRoute(): React.JSX.Element {
  const user = useSession((state) => state.user);
  const [createOpen, setCreateOpen] = useState(false);

  const cases = useApiQuery<Paginated<CaseSummary>>(
    queryKeys.cases(),
    "/v1/cases?limit=100",
  );

  const items = cases.data?.items ?? [];

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="Cases"
        description="Research efforts, each with its own assets, findings and reports."
        actions={
          canWrite(user) ? (
            <Button variant="primary" onClick={() => setCreateOpen(true)}>
              <Plus aria-hidden className="size-3.5" />
              New case
            </Button>
          ) : undefined
        }
      />

      {cases.error !== null ? (
        <ErrorState
          title={errorHeading(cases.error)}
          description={cases.error.message}
          action={
            <Button
              variant="secondary"
              size="sm"
              loading={cases.isFetching}
              onClick={() => void cases.refetch()}
            >
              Try again
            </Button>
          }
        />
      ) : cases.isLoading ? (
        <LoadingState label="Loading cases…" />
      ) : items.length === 0 ? (
        <EmptyState
          title="No cases yet"
          description="A case holds the target context, the findings, the evidence and the reports for one piece of research."
        />
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <table className="w-full text-[12px]">
            <thead className="sticky top-0 bg-surface">
              <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-text-muted">
                <th className="px-4 py-2 font-medium">Reference</th>
                <th className="px-2 py-2 font-medium">Title</th>
                <th className="px-2 py-2 font-medium">Profile</th>
                <th className="px-2 py-2 font-medium">Status</th>
                <th className="px-2 py-2 text-right font-medium">Findings</th>
                <th className="px-2 py-2 font-medium">Owner</th>
                <th className="px-4 py-2 text-right font-medium">Updated</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr
                  key={item.id}
                  className="border-b border-border hover:bg-surface-hover"
                >
                  <td className="px-4 py-1.5">
                    <Link to={`/cases/${item.id}`} className="hover:underline">
                      <Mono>{item.ref}</Mono>
                    </Link>
                  </td>
                  <td className="max-w-md truncate px-2 py-1.5">
                    <Link to={`/cases/${item.id}`} className="hover:underline">
                      {item.title}
                    </Link>
                    {item.restricted ? (
                      <span
                        className="ml-2 rounded border border-danger/50 px-1 text-[10px] uppercase text-danger"
                        title="Visible only to named members."
                      >
                        Restricted
                      </span>
                    ) : null}
                  </td>
                  <td className="px-2 py-1.5 text-text-muted">
                    {humanise(item.profile)}
                  </td>
                  <td className="px-2 py-1.5">
                    <StateBadge kind="validation" state={item.status} />
                  </td>
                  <td className="px-2 py-1.5 text-right font-mono tabular-nums">
                    {item.findingCount}
                  </td>
                  <td className="px-2 py-1.5 text-text-muted">
                    {item.owner.displayName}
                  </td>
                  <td className="px-4 py-1.5 text-right text-text-muted">
                    {formatDistanceToNowStrict(item.updatedAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <CreateCaseDialog open={createOpen} onOpenChange={setCreateOpen} />
    </div>
  );
}
