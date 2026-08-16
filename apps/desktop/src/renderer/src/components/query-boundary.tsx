import type { UseQueryResult } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { Button, ErrorState, InlineError, LoadingState } from "@codevault/ui";

import { errorHeading, type ApiCallError } from "../lib/api.js";

/**
 * A failed secondary request, stated inline.
 *
 * Panels and side lists load their own data alongside the thing a page is
 * about. When one of those fails, `data?.items ?? []` renders an empty list
 * that is indistinguishable from a genuinely empty one, so the failure is
 * said out loud next to the section it belongs to, with a way to retry.
 */
export function QueryError({
  query,
  className,
}: {
  query: Pick<
    UseQueryResult<unknown, ApiCallError>,
    "error" | "refetch" | "isFetching"
  >;
  className?: string;
}): React.JSX.Element | null {
  if (query.error === null) {
    return null;
  }

  return (
    <InlineError {...(className === undefined ? {} : { className })}>
      <span className="font-medium">{errorHeading(query.error)}.</span>{" "}
      {query.error.message}{" "}
      <button
        type="button"
        className="underline underline-offset-2 hover:no-underline"
        onClick={() => void query.refetch()}
      >
        {query.isFetching ? "Retrying…" : "Try again"}
      </button>
    </InlineError>
  );
}

/**
 * The three states of a request, rendered in one place.
 *
 * Most screens used to branch on `data === undefined` alone, which renders a
 * failed request as a permanent "Loading…". That is the worst of both: the
 * researcher waits on something that is never coming, and nothing says what
 * broke. Errors are shown, named, and retryable; loading is a spinner.
 */
export function QueryBoundary<T>({
  query,
  loadingLabel,
  children,
  className,
}: {
  query: UseQueryResult<T, ApiCallError>;
  loadingLabel?: string;
  children: (data: T) => ReactNode;
  className?: string;
}): React.JSX.Element {
  if (query.error !== null) {
    return (
      <ErrorState
        title={errorHeading(query.error)}
        description={query.error.message}
        {...(className === undefined ? {} : { className })}
        action={
          <Button
            variant="secondary"
            size="sm"
            loading={query.isFetching}
            onClick={() => void query.refetch()}
          >
            Try again
          </Button>
        }
      />
    );
  }

  if (query.data === undefined) {
    return (
      <LoadingState
        {...(loadingLabel === undefined ? {} : { label: loadingLabel })}
        {...(className === undefined ? {} : { className })}
      />
    );
  }

  return <>{children(query.data)}</>;
}
