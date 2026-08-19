import type {
  AddAffectedRangeRequest,
  AssetDetail,
  AssetSummary,
  CaseDetail,
  CaseSummary,
  CreateAssetRequest,
  CreateCaseRequest,
  CreateFindingRequest,
  CreateVendorRequest,
  FindingDetail,
  FindingSummary,
  LinkFindingAssetRequest,
  MeResponse,
  UpdateFindingRequest,
  VendorDetail,
  VendorSummary,
} from "@codevault/contracts";

type Fetch = typeof globalThis.fetch;

interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

export interface CodeVaultClientConfig {
  baseUrl: string;
  token: string;
  fetch?: Fetch;
}

export interface ListOptions {
  query?: string | undefined;
  limit?: number | undefined;
  cursor?: string | undefined;
}

export interface ListCasesOptions extends ListOptions {
  status?: string | undefined;
  profile?: string | undefined;
}

export interface ListAssetsOptions extends ListOptions {
  caseId?: string | undefined;
  kind?: string | undefined;
}

export interface ListFindingsOptions extends ListOptions {
  caseId?: string | undefined;
  assetId?: string | undefined;
}

export interface RecordFindingRequest extends CreateFindingRequest {
  technicalMarkdown?: string;
  preconditionsMarkdown?: string;
  attackPathMarkdown?: string;
  impactMarkdown?: string;
  reproductionMarkdown?: string;
  remediationMarkdown?: string;
  researcherNotesMarkdown?: string;
  cweIds?: string[];
  additionalAssetIds?: string[];
  affectedRanges?: AddAffectedRangeRequest[];
}

export class CodeVaultApiError extends Error {
  readonly status: number;
  readonly category: string | null;
  readonly requestId: string | null;

  constructor(options: {
    status: number;
    message: string;
    category?: string;
    requestId?: string;
  }) {
    super(options.message);
    this.name = "CodeVaultApiError";
    this.status = options.status;
    this.category = options.category ?? null;
    this.requestId = options.requestId ?? null;
  }
}

/**
 * The HTTP seam used by every MCP tool.
 *
 * Authentication, authorization, validation, auditing, and domain transitions
 * remain server concerns. This client only turns typed MCP requests into calls
 * to the same routes used by the desktop app.
 */
export class CodeVaultClient {
  readonly #baseUrl: string;
  readonly #token: string;
  readonly #fetch: Fetch;

  constructor(config: CodeVaultClientConfig) {
    const baseUrl = new URL(config.baseUrl);

    if (baseUrl.protocol !== "http:" && baseUrl.protocol !== "https:") {
      throw new Error("CODEVAULT_URL must use http or https.");
    }
    if (baseUrl.protocol === "http:" && !isLoopback(baseUrl.hostname)) {
      throw new Error(
        "CODEVAULT_URL must use https unless it is a loopback URL.",
      );
    }
    if (
      baseUrl.username !== "" ||
      baseUrl.password !== "" ||
      baseUrl.search !== "" ||
      baseUrl.hash !== ""
    ) {
      throw new Error(
        "CODEVAULT_URL cannot contain credentials, a query, or a fragment.",
      );
    }
    if (config.token.trim().length < 32) {
      throw new Error("CODEVAULT_TOKEN is missing or too short.");
    }

    this.#baseUrl = baseUrl.toString().replace(/\/$/u, "");
    this.#token = config.token.trim();
    this.#fetch = config.fetch ?? globalThis.fetch;
  }

  whoAmI(): Promise<MeResponse> {
    return this.#request("/v1/auth/me");
  }

  listCases(options: ListCasesOptions = {}): Promise<Page<CaseSummary>> {
    return this.#request(`/v1/cases${queryString(options)}`);
  }

  createCase(body: CreateCaseRequest): Promise<CaseDetail> {
    return this.#request("/v1/cases", "POST", body);
  }

  listVendors(options: ListOptions = {}): Promise<Page<VendorSummary>> {
    return this.#request(`/v1/vendors${queryString(options)}`);
  }

  createVendor(body: CreateVendorRequest): Promise<VendorDetail> {
    return this.#request("/v1/vendors", "POST", body);
  }

  listAssets(options: ListAssetsOptions = {}): Promise<Page<AssetSummary>> {
    return this.#request(`/v1/assets${queryString(options)}`);
  }

  createAsset(body: CreateAssetRequest): Promise<AssetDetail> {
    return this.#request("/v1/assets", "POST", body);
  }

  listFindings(
    options: ListFindingsOptions = {},
  ): Promise<Page<FindingSummary>> {
    return this.#request(`/v1/findings${queryString(options)}`);
  }

  getFinding(id: string): Promise<FindingDetail> {
    return this.#request(`/v1/findings/${encodeURIComponent(id)}`);
  }

  async recordFinding(body: RecordFindingRequest): Promise<FindingDetail> {
    let finding = await this.#request<FindingDetail>("/v1/findings", "POST", {
      caseId: body.caseId,
      title: body.title,
      ...(body.summaryMarkdown === undefined
        ? {}
        : { summaryMarkdown: body.summaryMarkdown }),
      ...(body.primaryAssetId === undefined
        ? {}
        : { primaryAssetId: body.primaryAssetId }),
      ...(body.initialSeverity === undefined
        ? {}
        : { initialSeverity: body.initialSeverity }),
    } satisfies CreateFindingRequest);

    const narrative = pickDefined(body, [
      "technicalMarkdown",
      "preconditionsMarkdown",
      "attackPathMarkdown",
      "impactMarkdown",
      "reproductionMarkdown",
      "remediationMarkdown",
      "researcherNotesMarkdown",
      "cweIds",
    ]);

    if (Object.keys(narrative).length > 0) {
      finding = await this.#request(
        `/v1/findings/${encodeURIComponent(finding.id)}`,
        "PATCH",
        {
          ...narrative,
          expectedRevision: finding.revision,
        } satisfies UpdateFindingRequest,
      );
    }

    const linkedAssetIds = unique([
      ...(body.additionalAssetIds ?? []),
      ...(body.affectedRanges ?? []).map((range) => range.assetId),
    ]);

    for (const assetId of linkedAssetIds) {
      if (assetId === body.primaryAssetId) continue;
      finding = await this.#request(
        `/v1/findings/${encodeURIComponent(finding.id)}/assets`,
        "POST",
        { assetId } satisfies LinkFindingAssetRequest,
      );
    }

    for (const affectedRange of body.affectedRanges ?? []) {
      finding = await this.#request(
        `/v1/findings/${encodeURIComponent(finding.id)}/affected-ranges`,
        "POST",
        affectedRange,
      );
    }

    return finding;
  }

  async #request<T>(
    path: string,
    method: "GET" | "POST" | "PATCH" = "GET",
    body?: unknown,
  ): Promise<T> {
    const response = await this.#fetch(`${this.#baseUrl}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${this.#token}`,
        accept: "application/json",
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const payload = await readJson(response);

    if (!response.ok) {
      const error = errorFields(payload);
      throw new CodeVaultApiError({
        status: response.status,
        message: error.message ?? `CodeVault returned HTTP ${response.status}.`,
        ...(error.category === undefined ? {} : { category: error.category }),
        ...(error.requestId === undefined
          ? {}
          : { requestId: error.requestId }),
      });
    }

    return payload as T;
  }
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();

  if (text.trim() === "") return null;

  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new CodeVaultApiError({
      status: response.status,
      message: "CodeVault returned a response that was not JSON.",
    });
  }
}

function errorFields(payload: unknown): {
  message?: string;
  category?: string;
  requestId?: string;
} {
  if (payload === null || typeof payload !== "object") return {};
  const envelope = payload as Record<string, unknown>;
  const error = envelope["error"];

  if (error === null || typeof error !== "object") return {};
  const fields = error as Record<string, unknown>;

  return {
    ...(typeof fields["message"] === "string"
      ? { message: fields["message"] }
      : {}),
    ...(typeof fields["category"] === "string"
      ? { category: fields["category"] }
      : {}),
    ...(typeof fields["requestId"] === "string"
      ? { requestId: fields["requestId"] }
      : {}),
  };
}

function queryString(options: object): string {
  const query = new URLSearchParams();

  for (const [key, value] of Object.entries(options)) {
    if (value !== undefined) query.set(key, String(value));
  }

  const encoded = query.toString();
  return encoded === "" ? "" : `?${encoded}`;
}

function pickDefined<T extends object, K extends keyof T>(
  source: T,
  keys: readonly K[],
): Partial<Pick<T, K>> {
  const result: Partial<Pick<T, K>> = {};

  for (const key of keys) {
    if (source[key] !== undefined) result[key] = source[key];
  }

  return result;
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function isLoopback(hostname: string): boolean {
  return ["localhost", "127.0.0.1", "[::1]", "::1"].includes(
    hostname.toLowerCase(),
  );
}
