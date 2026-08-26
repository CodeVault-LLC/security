import type {
  AvatarUpload,
  AiContextPreview,
  AiProviderStatus,
  AiRunWithProposals,
  CreateAiRunRequest,
  PreparedAiRun,
  InviteInspection,
  RecoveryCodeBundle,
  ServerEvent,
  SessionUser,
  SubmissionDelivery,
  ImportCaseArchiveResult,
  IntakeDraft,
  WebAuthnCredentialSummary,
} from "@codevault/contracts";

/**
 * The desktop bridge contract.
 *
 * This is the complete list of things the renderer can ask the main process to
 * do. It is intentionally an inventory of operations, not a transport: there is
 * no `invoke(channel, payload)`, no `exec`, no filesystem access and no way to
 * send an arbitrary command to an AI provider. A payload rendered inside a
 * finding can, at worst, call one of these.
 */

export interface AuthResult {
  user: SessionUser;
  /** Whether the session survives a restart on this machine. */
  persistent: boolean;
  /** Explanation shown when the session cannot be persisted securely. */
  storageWarning: string | null;
}

export interface LoginChallengeResult {
  challenge: "MFA_REQUIRED" | "ENROLLMENT_REQUIRED";
  methods: Array<"TOTP" | "WEBAUTHN">;
  expiresAt: string;
}

export interface ServerPreflight {
  status: "ok";
  apiVersion: string;
  serverVersion: string;
  compatible: boolean;
  compatibilityMessage: string | null;
}

export interface EnrollmentSetup {
  provisioningUri: string;
  manualSecret: string;
  expiresAt: string;
}

export interface ApiRequestOptions {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
}

export interface ApiFailure {
  ok: false;
  category: string;
  message: string;
  requestId: string | null;
  details: Record<string, unknown> | null;
}

export interface ApiSuccess<T> {
  ok: true;
  data: T;
}

export type ApiOutcome<T> = ApiSuccess<T> | ApiFailure;

export interface UploadSelection {
  /** Opaque, one-use capability for a path held only by the main process. */
  selectionId: string;
  filename: string;
  sizeBytes: number;
  mimeType: string;
  sha256: string;
}

export interface UploadProgress {
  /** Stable renderer capability for the selected file. */
  selectionId: string;
  /** Server artifact ID once registration has succeeded. */
  uploadId: string | null;
  filename: string;
  phase: "HASHING" | "UPLOADING" | "COMPLETING" | "DONE" | "FAILED";
  /** 0-1; null while a phase has no measurable progress. */
  progress: number | null;
  message: string | null;
}

export interface UploadBatchItem {
  selectionId: string;
  artifactId: string | null;
  error: string | null;
}

export interface UploadBatchResult {
  items: UploadBatchItem[];
}

export interface FolderIntakeContextInput {
  findingTitles: string[];
  artifactDigests: string[];
}

export interface FolderIntakePreviewResult {
  rootName: string;
  files: Array<{
    relativePath: string;
    sizeBytes: number;
    sha256: string;
    disposition: "MAPPED" | "ATTACHMENT" | "MAPPING_ERROR";
  }>;
  candidates: Array<{
    clientId: string;
    sourcePath: string;
    sourceSha256: string;
    draft: IntakeDraft;
    status: "READY" | "DUPLICATE";
    duplicateReasons: string[];
  }>;
  attachments: Array<{
    relativePath: string;
    sizeBytes: number;
    sha256: string;
    duplicateOf: string | null;
  }>;
  errors: string[];
  totalBytes: number;
  selections: Array<
    UploadSelection & {
      relativePath: string;
      disposition: "MAPPED" | "ATTACHMENT" | "MAPPING_ERROR";
    }
  >;
}

export interface StartUploadRequest {
  caseId: string;
  findingId?: string;
  artifactKind: string;
  visibility: "INTERNAL" | "VENDOR" | "PUBLIC";
  /** Files chosen through the native picker in a previous call. */
  selections: UploadSelection[];
}

export interface ManualBundleResult {
  saved: boolean;
  packageId: string | null;
  sha256: string | null;
}

export interface CaseArchiveExportResult {
  saved: boolean;
  sha256: string | null;
}

export type ReportExportFormat = "PDF" | "MARKDOWN";

export interface ReportExportDownloadResult {
  saved: boolean;
  sha256: string | null;
}

export interface SigningKeySummary {
  fingerprint: string;
  userIds: string[];
  createdAt: string;
  expiresAt: string | null;
  encrypted: boolean;
  persistent: boolean;
}

export interface DecryptedCorrespondence {
  messageId: string;
  bodyText: string;
  attachmentCount: number;
}

export interface CorrespondenceTranscriptExportResult {
  saved: boolean;
  sha256: string | null;
}

export interface AuditCsvExportResult {
  saved: boolean;
  sha256: string | null;
}

/**
 * What the renderer may say about a run.
 *
 * Exactly the server's own request shape and nothing more. Execution settings —
 * the timeout, the tool capability, the settings scope — are resolved on the
 * server against the workspace policy, so there is no field here through which
 * the renderer could influence how the provider is spawned.
 */
export type AiRunRequest = CreateAiRunRequest;

export interface CodeVaultDesktopApi {
  app: {
    version(): Promise<string>;
    platform(): Promise<"darwin" | "win32" | "linux">;
    /** Opens a link in the system browser, after the policy check. */
    openExternal(url: string): Promise<boolean>;
  };

  auth: {
    preflight(serverUrl: string): Promise<ApiOutcome<ServerPreflight>>;
    loginStart(
      serverUrl: string,
      email: string,
      password: string,
      rememberMe: boolean,
    ): Promise<ApiOutcome<LoginChallengeResult | AuthResult>>;
    loginComplete(totp: string): Promise<ApiOutcome<AuthResult>>;
    loginSecurityKey(): Promise<ApiOutcome<AuthResult>>;
    registerSecurityKey(
      name: string,
    ): Promise<ApiOutcome<WebAuthnCredentialSummary>>;
    enrollmentStart(): Promise<ApiOutcome<EnrollmentSetup>>;
    enrollmentConfirm(totp: string): Promise<ApiOutcome<RecoveryCodeBundle>>;
    logout(): Promise<void>;
    /** Restores a persisted session at startup, if one is available. */
    restore(): Promise<ApiOutcome<AuthResult> | null>;
    /** Warning to display when the session could not be stored securely. */
    storageWarning(): Promise<string | null>;
    /** Fires after the server rejects the current session. */
    onSessionExpired(listener: () => void): () => void;
  };

  invitation: {
    inspect(
      serverUrl: string,
      token: string,
    ): Promise<ApiOutcome<InviteInspection>>;
    start(
      displayName: string,
      password: string,
    ): Promise<ApiOutcome<EnrollmentSetup>>;
    confirm(totp: string): Promise<ApiOutcome<RecoveryCodeBundle>>;
  };

  /**
   * Authenticated API access.
   *
   * The renderer names a path and a method; the main process attaches the
   * token. The renderer never sees the token, and never chooses a host.
   */
  api: {
    request<T>(
      path: string,
      options?: ApiRequestOptions,
    ): Promise<ApiOutcome<T>>;
  };

  uploads: {
    /** Opens the native picker and hashes each selection out of process. */
    select(): Promise<UploadSelection[]>;
    start(request: StartUploadRequest): Promise<ApiOutcome<UploadBatchResult>>;
    /** Deletes uploaded artifacts that were never attached to a record. */
    discard(artifactIds: string[]): Promise<ApiOutcome<{ ok: true }>>;
    onProgress(listener: (progress: UploadProgress) => void): () => void;
  };

  intake: {
    /** Selects and maps a folder without exposing local paths to the renderer. */
    selectFolder(
      context: FolderIntakeContextInput,
    ): Promise<ApiOutcome<FolderIntakePreviewResult | null>>;
  };

  caseArchives: {
    exportCase(caseId: string): Promise<ApiOutcome<CaseArchiveExportResult>>;
    importCase(): Promise<ApiOutcome<ImportCaseArchiveResult | null>>;
  };

  reports: {
    /** Downloads and verifies a completed report export through a native picker. */
    downloadExport(
      artifactId: string,
      format: ReportExportFormat,
    ): Promise<ApiOutcome<ReportExportDownloadResult>>;
  };

  audit: {
    /** Saves a locally assembled, case-scoped audit CSV. */
    saveCsv(
      caseId: string,
      csv: string,
    ): Promise<ApiOutcome<AuditCsvExportResult>>;
  };

  avatars: {
    selectAndUpload(
      target: "USER" | "ORGANIZATION",
    ): Promise<ApiOutcome<AvatarUpload | null>>;
    load(avatarId: string): Promise<ApiOutcome<string>>;
    loadUser(userId: string): Promise<ApiOutcome<string>>;
  };

  submissions: {
    /** Builds, verifies, seals, and saves one manual disclosure bundle. */
    downloadManualBundle(
      submissionId: string,
    ): Promise<ApiOutcome<ManualBundleResult>>;
    /** Seals email through a native exact-content confirmation. */
    seal(submissionId: string): Promise<ApiOutcome<ManualBundleResult>>;
    /** Sends only after a second native review of the sealed package. */
    send(submissionId: string): Promise<ApiOutcome<SubmissionDelivery>>;
  };

  signingKeys: {
    list(): Promise<SigningKeySummary[]>;
    import(persist: boolean): Promise<ApiOutcome<SigningKeySummary | null>>;
    remove(fingerprint: string): Promise<ApiOutcome<{ ok: true }>>;
  };

  correspondence: {
    /** Decrypts only after native confirmation; plaintext is memory-only. */
    decrypt(messageId: string): Promise<ApiOutcome<DecryptedCorrespondence>>;
    /** Saves a locally assembled transcript through a native picker. */
    exportTranscript(
      submissionId: string,
      markdown: string,
    ): Promise<ApiOutcome<CorrespondenceTranscriptExportResult>>;
  };

  ai: {
    /** Detected local providers and their versions. */
    providers(): Promise<AiProviderStatus[]>;
    /** Builds and shows the exact context a run would send. */
    previewContext(
      request: CreateAiRunRequest,
    ): Promise<ApiOutcome<AiContextPreview>>;
    /**
     * Prepares a run on the server, executes it locally, and submits the
     * result for validation. The renderer supplies an action and a target,
     * never a prompt.
     */
    run(request: AiRunRequest): Promise<ApiOutcome<AiRunWithProposals>>;
    cancel(runId: string): Promise<void>;
    onRunStateChange(
      listener: (state: {
        runId: string;
        status: PreparedAiRun["status"];
      }) => void,
    ): () => void;
  };

  events: {
    /** Server-sent events, forwarded from the main process. */
    subscribe(listener: (event: ServerEvent) => void): () => void;
    /** Connection state, so the UI can show when it is stale. */
    onConnectionChange(listener: (connected: boolean) => void): () => void;
  };
}

/** Channel names. Internal to the bridge; never exposed to the renderer. */
export const IPC_CHANNELS = {
  appVersion: "app:version",
  appPlatform: "app:platform",
  appOpenExternal: "app:open-external",
  authLoginStart: "auth:login-start",
  authPreflight: "auth:preflight",
  authLoginComplete: "auth:login-complete",
  authLoginSecurityKey: "auth:login-security-key",
  authRegisterSecurityKey: "auth:register-security-key",
  authEnrollmentStart: "auth:enrollment-start",
  authEnrollmentConfirm: "auth:enrollment-confirm",
  authLogout: "auth:logout",
  authRestore: "auth:restore",
  authStorageWarning: "auth:storage-warning",
  authSessionExpired: "auth:session-expired",
  invitationInspect: "invitation:inspect",
  invitationStart: "invitation:start",
  invitationConfirm: "invitation:confirm",
  apiRequest: "api:request",
  uploadsSelect: "uploads:select",
  uploadsStart: "uploads:start",
  uploadsDiscard: "uploads:discard",
  uploadsProgress: "uploads:progress",
  intakeSelectFolder: "intake:select-folder",
  caseArchivesExport: "case-archives:export",
  caseArchivesImport: "case-archives:import",
  reportsDownloadExport: "reports:download-export",
  auditSaveCsv: "audit:save-csv",
  avatarsSelectAndUpload: "avatars:select-and-upload",
  avatarsLoad: "avatars:load",
  avatarsLoadUser: "avatars:load-user",
  submissionsDownloadManualBundle: "submissions:download-manual-bundle",
  submissionsSeal: "submissions:seal",
  submissionsSend: "submissions:send",
  signingKeysList: "signing-keys:list",
  signingKeysImport: "signing-keys:import",
  signingKeysRemove: "signing-keys:remove",
  correspondenceDecrypt: "correspondence:decrypt",
  correspondenceExportTranscript: "correspondence:export-transcript",
  aiProviders: "ai:providers",
  aiPreviewContext: "ai:preview-context",
  aiRun: "ai:run",
  aiCancel: "ai:cancel",
  aiRunState: "ai:run-state",
  eventsMessage: "events:message",
  eventsConnection: "events:connection",
} as const;

export type IpcChannel = (typeof IPC_CHANNELS)[keyof typeof IPC_CHANNELS];
