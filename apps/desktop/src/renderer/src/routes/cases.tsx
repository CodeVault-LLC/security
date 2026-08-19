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
import { Avatar } from "../components/avatar.js";
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
  const editable = canWrite(user);
  const [createOpen, setCreateOpen] = useState(false);
  const [limit, setLimit] = useState(100);

  const cases = useApiQuery<Paginated<CaseSummary>>(
    queryKeys.cases({ limit }),
    `/v1/cases?limit=${limit}`,
  );

  const items = cases.data?.items ?? [];

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="Cases"
        description="Research efforts, each with its own assets, findings and reports."
        actions={
          editable ? (
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
          description={
            editable
              ? "Start a case for one research effort. Findings, evidence, and audience-specific reports stay attached to it."
              : "No cases are available to you. Restricted case names are hidden unless you are a member."
          }
          action={
            editable ? (
              <Button variant="primary" onClick={() => setCreateOpen(true)}>
                <Plus aria-hidden className="size-3.5" />
                New case
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <ul className="divide-y divide-border">
            {items.map((item) => (
              <li key={item.id}>
                <Link
                  to={`/cases/${item.id}`}
                  className="grid min-h-16 grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1 px-4 py-2.5 hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-focus lg:grid-cols-[8rem_minmax(14rem,1fr)_9rem_8rem_6rem_10rem_7rem] lg:items-center"
                >
                  <Mono className="text-text-muted max-lg:row-start-2">
                    {item.ref}
                  </Mono>
                  <span className="min-w-0 font-medium max-lg:col-span-2 max-lg:row-start-1 lg:col-start-2 lg:row-start-1">
                    <span className="break-words">{item.title}</span>
                    {item.restricted ? (
                      <span
                        className="ml-2 text-[11px] text-danger"
                        title="Visible only to named members."
                      >
                        Restricted
                      </span>
                    ) : null}
                  </span>
                  <span className="text-[11px] text-text-muted max-lg:hidden">
                    {humanise(item.profile)}
                  </span>
                  <span className="max-lg:row-start-2">
                    <StateBadge kind="validation" state={item.status} />
                  </span>
                  <span className="text-[11px] text-text-muted max-lg:row-start-3 lg:text-right">
                    {item.findingCount} finding
                    {item.findingCount === 1 ? "" : "s"}
                  </span>
                  <Avatar
                    avatarId={null}
                    userId={item.owner.id}
                    label={item.owner.displayName}
                    size="sm"
                    showLabel
                    className="gap-1.5 max-lg:hidden"
                  />
                  <span className="text-right text-[11px] text-text-muted max-lg:row-start-3">
                    {formatDistanceToNowStrict(item.updatedAt)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          {cases.data?.nextCursor === null ? null : (
            <div className="flex justify-center border-t border-border p-3">
              <Button
                variant="secondary"
                loading={cases.isFetching}
                onClick={() => setLimit((current) => current + 100)}
              >
                Load more cases
              </Button>
            </div>
          )}
        </div>
      )}

      <CreateCaseDialog open={createOpen} onOpenChange={setCreateOpen} />
    </div>
  );
}
