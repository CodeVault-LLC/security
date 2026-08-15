import {
  QueryClient,
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryOptions,
  type UseQueryResult,
} from "@tanstack/react-query";

import type { ApiRequestOptions } from "../../../preload/contracts.js";
import { bridge } from "./bridge.js";

/**
 * Server state.
 *
 * TanStack Query owns everything that comes from the API. Nothing here is
 * mirrored into a global store: a second copy of a finding is a second thing
 * that can be stale, and in this product stale means "a researcher acted on a
 * state that had already changed".
 */

export class ApiCallError extends Error {
  readonly category: string;
  readonly requestId: string | null;
  readonly details: Record<string, unknown> | null;

  constructor(
    category: string,
    message: string,
    requestId: string | null,
    details: Record<string, unknown> | null,
  ) {
    super(message);

    this.name = "ApiCallError";
    this.category = category;
    this.requestId = requestId;
    this.details = details;
  }
}

/** Calls the API through the bridge, unwrapping the outcome into a value. */
export async function apiRequest<T>(
  path: string,
  options?: ApiRequestOptions,
): Promise<T> {
  const outcome = await bridge().api.request<T>(path, options);

  if (!outcome.ok) {
    throw new ApiCallError(
      outcome.category,
      outcome.message,
      outcome.requestId,
      outcome.details,
    );
  }

  return outcome.data;
}

/**
 * Query keys.
 *
 * Structured as arrays so a whole subtree can be invalidated at once: a change
 * to one finding invalidates `["finding", id]` and the finding lists, without
 * touching unrelated caches.
 */
export const queryKeys = {
  me: ["me"] as const,
  dashboard: ["dashboard"] as const,
  users: ["users"] as const,
  invites: ["invites"] as const,
  cases: (filters?: Record<string, unknown>) =>
    filters === undefined
      ? (["cases"] as const)
      : (["cases", filters] as const),
  case: (id: string) => ["case", id] as const,
  caseReadiness: (id: string) => ["case", id, "readiness"] as const,
  caseNotes: (id: string) => ["case", id, "notes"] as const,
  findings: (filters?: Record<string, unknown>) =>
    filters === undefined
      ? (["findings"] as const)
      : (["findings", filters] as const),
  finding: (id: string) => ["finding", id] as const,
  assets: (filters?: Record<string, unknown>) =>
    filters === undefined
      ? (["assets"] as const)
      : (["assets", filters] as const),
  asset: (id: string) => ["asset", id] as const,
  evidence: (filters?: Record<string, unknown>) =>
    filters === undefined
      ? (["evidence"] as const)
      : (["evidence", filters] as const),
  reports: (caseId: string) => ["reports", caseId] as const,
  report: (id: string) => ["report", id] as const,
  reportLint: (id: string) => ["report", id, "lint"] as const,
  reportPreview: (id: string) => ["report", id, "preview"] as const,
  reportExports: (id: string) => ["report", id, "exports"] as const,
  reportTemplates: ["report-templates"] as const,
  disclosure: (caseId: string) => ["disclosure", caseId] as const,
  priorArt: (findingId: string) => ["prior-art", findingId] as const,
  aiRuns: (filters: Record<string, unknown>) => ["ai-runs", filters] as const,
  aiPolicies: ["ai-policies"] as const,
  aiProviders: ["ai-providers"] as const,
  activity: (filters?: Record<string, unknown>) =>
    filters === undefined
      ? (["activity"] as const)
      : (["activity", filters] as const),
  search: (query: string) => ["search", query] as const,
} as const;

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // Server-sent events drive invalidation, so polling is unnecessary and
        // a short stale time keeps cached navigation instant.
        staleTime: 30_000,
        refetchOnWindowFocus: false,
        retry: (failureCount, error) => {
          if (error instanceof ApiCallError) {
            const permanent = [
              "PERMISSION_DENIED",
              "NOT_FOUND",
              "VALIDATION",
              "CONFLICT",
              "EXPORT_BLOCKED",
            ];

            if (permanent.includes(error.category)) {
              return false;
            }
          }

          return failureCount < 2;
        },
      },
      mutations: { retry: false },
    },
  });
}

/** Typed GET helper. */
export function useApiQuery<T>(
  key: readonly unknown[],
  path: string,
  options?: Omit<UseQueryOptions<T, ApiCallError>, "queryKey" | "queryFn">,
): UseQueryResult<T, ApiCallError> {
  return useQuery<T, ApiCallError>({
    queryKey: key,
    queryFn: () => apiRequest<T>(path),
    ...options,
  });
}

export interface MutationInput {
  path: string;
  method?: "POST" | "PATCH" | "DELETE";
  body?: unknown;
}

/**
 * Typed mutation helper.
 *
 * `invalidate` lists the query keys a successful mutation makes stale. Stating
 * them at the call site keeps the refresh rules next to the change that causes
 * them rather than in a central table nobody maintains.
 */
export function useApiMutation<TResult, TVariables = void>(
  build: (variables: TVariables) => MutationInput,
  invalidate: (
    result: TResult,
    variables: TVariables,
  ) => readonly (readonly unknown[])[],
): UseMutationResult<TResult, ApiCallError, TVariables> {
  const queryClient = useQueryClient();

  return useMutation<TResult, ApiCallError, TVariables>({
    mutationFn: async (variables: TVariables) => {
      const input = build(variables);

      return apiRequest<TResult>(input.path, {
        method: input.method ?? "POST",
        ...(input.body === undefined ? {} : { body: input.body }),
      });
    },
    onSuccess: async (result, variables) => {
      for (const key of invalidate(result, variables)) {
        await queryClient.invalidateQueries({ queryKey: key });
      }
    },
  });
}

/** Turns an error category into the heading the UX rules prescribe. */
export function errorHeading(error: unknown): string {
  if (!(error instanceof ApiCallError)) {
    return "Something went wrong";
  }

  const headings: Record<string, string> = {
    VALIDATION: "Validation error",
    PERMISSION_DENIED: "Permission denied",
    NOT_FOUND: "Not found",
    CONFLICT: "Conflict — the data changed",
    PROVIDER_UNAVAILABLE: "Provider unavailable",
    AI_OUTPUT_INVALID: "AI output invalid",
    JOB_FAILED: "Background job failed",
    UPLOAD_FAILED: "Upload failed",
    EXPORT_BLOCKED: "Export blocked",
    RATE_LIMITED: "Too many attempts",
    SERVER_ERROR: "Server unavailable",
  };

  return headings[error.category] ?? "Something went wrong";
}
