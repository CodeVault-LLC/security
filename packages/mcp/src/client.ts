import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { basename } from "node:path";

import type {
  AddAssetIdentifierRequest,
  AddAssetRelationshipRequest,
  AddAssetVersionRequest,
  AddAffectedRangeRequest,
  AddFindingIdentifierRequest,
  AddFindingScoreRequest,
  ApproveReportRequest,
  Artifact,
  ArtifactDownload,
  AssetDetail,
  AssetSummary,
  CaseNote,
  CaseReadiness,
  CaseDetail,
  CaseSummary,
  Claim,
  CreateAssetRequest,
  CreateCaseRequest,
  CreateCaseNoteRequest,
  CreateClaimRequest,
  CreateDisclosureEventRequest,
  CreateEvidenceRequest,
  CreateFindingRequest,
  CreateReferenceRequest,
  CreateReportExportRequest,
  CreateReportRequest,
  CreateStakeholderRequest,
  CreateUploadRequest,
  CreateVendorPublicKeyRequest,
  CreateVendorRouteRequest,
  CreateVendorRequest,
  DisclosureEvent,
  DisclosureOverview,
  Evidence,
  ExternalReference,
  FindingDetail,
  FindingSummary,
  ReportDetail,
  ReportExport,
  ReportPreview,
  ReportSummary,
  ReportTemplateSummary,
  SetEmbargoRequest,
  Stakeholder,
  UpdateAssetRequest,
  UpdateCaseRequest,
  UpdateEvidenceRequest,
  LinkFindingAssetRequest,
  LintResult,
  MeResponse,
  UpdateReportRequest,
  UpdateReportSectionRequest,
  UpdateFindingRequest,
  UpdateVendorRequest,
  UpdateVendorRouteRequest,
  UploadInstructions,
  VendorPublicKey,
  VendorRoute,
  VendorDetail,
  VendorSummary,
  VerifyVendorPublicKeyRequest,
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

export interface ListEvidenceOptions extends ListOptions {
  caseId?: string | undefined;
  findingId?: string | undefined;
  visibility?: string | undefined;
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

export interface UploadEvidenceFileRequest {
  caseId: string;
  findingId?: string;
  filePath: string;
  mimeType: string;
  artifactKind: CreateUploadRequest["artifactKind"];
  visibility: CreateUploadRequest["visibility"];
  capturedAt?: string;
  metadata?: Record<string, unknown>;
  evidenceId?: string;
  evidenceTitle?: string;
  evidenceDescriptionMarkdown?: string;
}

export interface UploadEvidenceFileResult {
  artifact: Artifact;
  evidence: Evidence;
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

  updateFinding(
    id: string,
    body: UpdateFindingRequest,
  ): Promise<FindingDetail> {
    return this.#request(
      `/v1/findings/${encodeURIComponent(id)}`,
      "PATCH",
      body,
    );
  }

  addFindingScore(
    findingId: string,
    body: AddFindingScoreRequest,
  ): Promise<FindingDetail> {
    return this.#request(
      `/v1/findings/${encodeURIComponent(findingId)}/scores`,
      "POST",
      body,
    );
  }

  approveFindingScore(
    findingId: string,
    scoreId: string,
  ): Promise<FindingDetail> {
    return this.#request(
      `/v1/findings/${encodeURIComponent(findingId)}/scores/${encodeURIComponent(scoreId)}/approve`,
      "POST",
    );
  }

  addFindingIdentifier(
    findingId: string,
    body: AddFindingIdentifierRequest,
  ): Promise<FindingDetail> {
    return this.#request(
      `/v1/findings/${encodeURIComponent(findingId)}/identifiers`,
      "POST",
      body,
    );
  }

  addFindingClaim(findingId: string, body: CreateClaimRequest): Promise<Claim> {
    return this.#request(
      `/v1/findings/${encodeURIComponent(findingId)}/claims`,
      "POST",
      body,
    );
  }

  addFindingReference(
    findingId: string,
    body: CreateReferenceRequest,
  ): Promise<ExternalReference> {
    return this.#request(
      `/v1/findings/${encodeURIComponent(findingId)}/references`,
      "POST",
      body,
    );
  }

  listEvidence(options: ListEvidenceOptions = {}): Promise<Page<Evidence>> {
    return this.#request(`/v1/evidence${queryString(options)}`);
  }

  createEvidence(body: CreateEvidenceRequest): Promise<Evidence> {
    return this.#request("/v1/evidence", "POST", body);
  }

  updateEvidence(id: string, body: UpdateEvidenceRequest): Promise<Evidence> {
    return this.#request(
      `/v1/evidence/${encodeURIComponent(id)}`,
      "PATCH",
      body,
    );
  }

  getArtifactDownload(id: string): Promise<ArtifactDownload> {
    return this.#request(`/v1/artifacts/${encodeURIComponent(id)}`);
  }

  async uploadEvidenceFile(
    input: UploadEvidenceFileRequest,
  ): Promise<UploadEvidenceFileResult> {
    const file = await stat(input.filePath);
    if (!file.isFile()) {
      throw new Error("The evidence path must identify a regular file.");
    }

    const bytes = await readFile(input.filePath);
    const filename = basename(input.filePath);
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const instructions = await this.#request<UploadInstructions>(
      "/v1/uploads",
      "POST",
      compact({
        caseId: input.caseId,
        findingId: input.findingId,
        filename,
        mimeType: input.mimeType,
        sizeBytes: file.size,
        sha256,
        artifactKind: input.artifactKind,
        visibility: input.visibility,
        capturedAt: input.capturedAt,
        metadata: input.metadata,
      }) as CreateUploadRequest,
    );

    const parts: Array<{ partNumber: number; etag: string }> = [];
    if (instructions.strategy === "SINGLE") {
      if (instructions.url === null) {
        throw new Error(
          "CodeVault returned no URL for the single-part upload.",
        );
      }
      await this.#putUpload(
        instructions.url,
        Uint8Array.from(bytes),
        instructions.requiredHeaders,
      );
    } else {
      for (const [index, url] of instructions.partUrls.entries()) {
        const offset = index * instructions.partSizeBytes;
        const chunk = Uint8Array.from(
          bytes.subarray(offset, offset + instructions.partSizeBytes),
        );
        const response = await this.#putUpload(
          url,
          chunk,
          instructions.requiredHeaders,
        );
        const etag = response.headers.get("etag");
        if (etag === null || etag.trim() === "") {
          throw new Error(
            "Object storage did not return an ETag for an upload part.",
          );
        }
        parts.push({ partNumber: index + 1, etag });
      }
    }

    const artifact = await this.#request<Artifact>(
      `/v1/uploads/${encodeURIComponent(instructions.artifactId)}/complete`,
      "POST",
      instructions.strategy === "MULTIPART" ? { parts } : {},
    );

    let evidence: Evidence;
    if (input.evidenceId === undefined) {
      evidence = await this.createEvidence(
        compact({
          caseId: input.caseId,
          findingId: input.findingId,
          title: input.evidenceTitle ?? filename,
          descriptionMarkdown: input.evidenceDescriptionMarkdown,
          visibility: input.visibility,
          capturedAt: input.capturedAt,
          artifactIds: [artifact.id],
        }) as CreateEvidenceRequest,
      );
    } else {
      const existing = (
        await this.listEvidence({ caseId: input.caseId, limit: 200 })
      ).items.find((item) => item.id === input.evidenceId);
      if (existing === undefined) {
        throw new Error(
          "The requested evidence record was not found in the supplied case.",
        );
      }
      evidence = await this.updateEvidence(existing.id, {
        artifactIds: unique([
          ...existing.artifacts.map((item) => item.id),
          artifact.id,
        ]),
        expectedRevision: existing.revision,
      });
    }

    return { artifact, evidence };
  }

  getCase(id: string): Promise<CaseDetail> {
    return this.#request(`/v1/cases/${encodeURIComponent(id)}`);
  }

  updateCase(id: string, body: UpdateCaseRequest): Promise<CaseDetail> {
    return this.#request(`/v1/cases/${encodeURIComponent(id)}`, "PATCH", body);
  }

  listCaseNotes(caseId: string): Promise<{ items: CaseNote[] }> {
    return this.#request(`/v1/cases/${encodeURIComponent(caseId)}/notes`);
  }

  addCaseNote(caseId: string, body: CreateCaseNoteRequest): Promise<CaseNote> {
    return this.#request(
      `/v1/cases/${encodeURIComponent(caseId)}/notes`,
      "POST",
      body,
    );
  }

  getCaseReadiness(caseId: string): Promise<CaseReadiness> {
    return this.#request(`/v1/cases/${encodeURIComponent(caseId)}/readiness`);
  }

  getCaseDisclosure(caseId: string): Promise<DisclosureOverview> {
    return this.#request(`/v1/cases/${encodeURIComponent(caseId)}/disclosure`);
  }

  addCaseStakeholder(
    caseId: string,
    body: CreateStakeholderRequest,
  ): Promise<Stakeholder> {
    return this.#request(
      `/v1/cases/${encodeURIComponent(caseId)}/stakeholders`,
      "POST",
      body,
    );
  }

  addDisclosureEvent(
    caseId: string,
    body: CreateDisclosureEventRequest,
  ): Promise<DisclosureEvent> {
    return this.#request(
      `/v1/cases/${encodeURIComponent(caseId)}/disclosure-events`,
      "POST",
      body,
    );
  }

  setCaseEmbargo(
    caseId: string,
    body: SetEmbargoRequest,
  ): Promise<DisclosureOverview> {
    return this.#request(
      `/v1/cases/${encodeURIComponent(caseId)}/embargo`,
      "POST",
      body,
    );
  }

  getAsset(id: string): Promise<AssetDetail> {
    return this.#request(`/v1/assets/${encodeURIComponent(id)}`);
  }

  updateAsset(id: string, body: UpdateAssetRequest): Promise<AssetDetail> {
    return this.#request(`/v1/assets/${encodeURIComponent(id)}`, "PATCH", body);
  }

  addAssetIdentifier(
    assetId: string,
    body: AddAssetIdentifierRequest,
  ): Promise<AssetDetail> {
    return this.#request(
      `/v1/assets/${encodeURIComponent(assetId)}/identifiers`,
      "POST",
      body,
    );
  }

  addAssetVersion(
    assetId: string,
    body: AddAssetVersionRequest,
  ): Promise<AssetDetail> {
    return this.#request(
      `/v1/assets/${encodeURIComponent(assetId)}/versions`,
      "POST",
      body,
    );
  }

  addAssetRelationship(
    assetId: string,
    body: AddAssetRelationshipRequest,
  ): Promise<AssetDetail> {
    return this.#request(
      `/v1/assets/${encodeURIComponent(assetId)}/relationships`,
      "POST",
      body,
    );
  }

  getVendor(id: string): Promise<VendorDetail> {
    return this.#request(`/v1/vendors/${encodeURIComponent(id)}`);
  }

  updateVendor(id: string, body: UpdateVendorRequest): Promise<VendorDetail> {
    return this.#request(
      `/v1/vendors/${encodeURIComponent(id)}`,
      "PATCH",
      body,
    );
  }

  addVendorContactRoute(
    vendorId: string,
    body: CreateVendorRouteRequest,
  ): Promise<VendorRoute> {
    return this.#request(
      `/v1/vendors/${encodeURIComponent(vendorId)}/routes`,
      "POST",
      body,
    );
  }

  getVendorContactRoute(id: string): Promise<VendorRoute> {
    return this.#request(`/v1/vendor-routes/${encodeURIComponent(id)}`);
  }

  updateVendorContactRoute(
    id: string,
    body: UpdateVendorRouteRequest,
  ): Promise<VendorRoute> {
    return this.#request(
      `/v1/vendor-routes/${encodeURIComponent(id)}`,
      "PATCH",
      body,
    );
  }

  addVendorPublicKey(
    vendorId: string,
    body: CreateVendorPublicKeyRequest,
  ): Promise<VendorPublicKey> {
    return this.#request(
      `/v1/vendors/${encodeURIComponent(vendorId)}/public-keys`,
      "POST",
      body,
    );
  }

  verifyVendorPublicKey(
    vendorId: string,
    keyId: string,
    body: VerifyVendorPublicKeyRequest,
  ): Promise<VendorPublicKey> {
    return this.#request(
      `/v1/vendors/${encodeURIComponent(vendorId)}/public-keys/${encodeURIComponent(keyId)}/verify`,
      "POST",
      body,
    );
  }

  listReportTemplates(): Promise<{ items: ReportTemplateSummary[] }> {
    return this.#request("/v1/report-templates");
  }

  listReports(caseId: string): Promise<{ items: ReportSummary[] }> {
    return this.#request(`/v1/reports${queryString({ caseId })}`);
  }

  createReport(body: CreateReportRequest): Promise<ReportDetail> {
    return this.#request("/v1/reports", "POST", body);
  }

  getReport(id: string): Promise<ReportDetail> {
    return this.#request(`/v1/reports/${encodeURIComponent(id)}`);
  }

  updateReport(id: string, body: UpdateReportRequest): Promise<ReportDetail> {
    return this.#request(
      `/v1/reports/${encodeURIComponent(id)}`,
      "PATCH",
      body,
    );
  }

  updateReportSection(
    reportId: string,
    sectionId: string,
    body: UpdateReportSectionRequest,
  ): Promise<ReportDetail> {
    return this.#request(
      `/v1/reports/${encodeURIComponent(reportId)}/sections/${encodeURIComponent(sectionId)}`,
      "PATCH",
      body,
    );
  }

  lintReport(id: string): Promise<LintResult> {
    return this.#request(`/v1/reports/${encodeURIComponent(id)}/lint`);
  }

  previewReport(id: string): Promise<ReportPreview> {
    return this.#request(`/v1/reports/${encodeURIComponent(id)}/preview`);
  }

  approveReport(id: string, body: ApproveReportRequest): Promise<ReportDetail> {
    return this.#request(
      `/v1/reports/${encodeURIComponent(id)}/approve`,
      "POST",
      body,
    );
  }

  listReportExports(reportId: string): Promise<{ items: ReportExport[] }> {
    return this.#request(`/v1/reports/${encodeURIComponent(reportId)}/exports`);
  }

  exportReport(
    reportId: string,
    body: CreateReportExportRequest,
  ): Promise<ReportExport> {
    return this.#request(
      `/v1/reports/${encodeURIComponent(reportId)}/exports`,
      "POST",
      body,
    );
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

  async #putUpload(
    url: string,
    bytes: Uint8Array,
    requiredHeaders: Record<string, string>,
  ): Promise<Response> {
    const response = await this.#fetch(url, {
      method: "PUT",
      headers: requiredHeaders,
      body: new Blob([bytes]),
    });
    if (!response.ok) {
      throw new CodeVaultApiError({
        status: response.status,
        message: `Object storage rejected the upload with HTTP ${response.status}.`,
      });
    }
    return response;
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

function compact<T extends object>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== undefined),
  ) as T;
}

function isLoopback(hostname: string): boolean {
  return ["localhost", "127.0.0.1", "[::1]", "::1"].includes(
    hostname.toLowerCase(),
  );
}
