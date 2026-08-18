import type {
  SubmissionRouteSnapshot,
  SubmissionValidationFinding,
} from "@codevault/contracts";
import type { ContentVisibility, CryptoMode } from "@codevault/core";

const GMAIL_MAX_MESSAGE_BYTES = 25 * 1024 * 1024;
const GMAIL_BLOCKED_EXTENSIONS = new Set([
  ".ade",
  ".adp",
  ".apk",
  ".appx",
  ".bat",
  ".cab",
  ".chm",
  ".cmd",
  ".com",
  ".cpl",
  ".dll",
  ".dmg",
  ".exe",
  ".hta",
  ".img",
  ".ins",
  ".iso",
  ".isp",
  ".jar",
  ".js",
  ".jse",
  ".lib",
  ".lnk",
  ".mde",
  ".msc",
  ".msi",
  ".msp",
  ".mst",
  ".nsh",
  ".pif",
  ".ps1",
  ".scr",
  ".sct",
  ".shb",
  ".sys",
  ".vb",
  ".vbe",
  ".vbs",
  ".vxd",
  ".wsc",
  ".wsf",
  ".wsh",
]);

export interface ValidationAttachment {
  artifactId: string;
  filename: string;
  mimeType: string;
  visibility: ContentVisibility;
  status: "STORED" | "QUARANTINED" | "DELETED";
  sizeBytes: number;
  sha256: string;
  sourceRevision: number | null;
  currentSourceRevision: number | null;
  /** Null means the artifact is not a proof of concept. */
  pocApprovedForVendor: boolean | null;
}

export interface ValidationPublicKey {
  id: string;
  verified: boolean;
  expired: boolean;
  revoked: boolean;
  superseded: boolean;
  fingerprint: string;
}

export interface SubmissionValidationInput {
  submissionId: string;
  revision: number;
  routeSnapshot: SubmissionRouteSnapshot;
  subject: string;
  bodyMarkdown: string;
  manualFields: Record<string, string>;
  cryptoMode: CryptoMode;
  attachments: ValidationAttachment[];
  requiredFieldContent: Partial<Record<string, boolean>>;
  approvedVendorReport: boolean;
  completedReportExport: boolean;
  aiDraftReviewed: boolean;
  publicKey: ValidationPublicKey | null;
  gmailConnectionAvailable: boolean;
  estimatedFinalMimeBytes: number;
  disclosureAllowed: boolean;
  tlpAllowsVendor: boolean;
  checkedAt: string;
}

export interface SubmissionValidationOutcome {
  findings: SubmissionValidationFinding[];
  blocking: boolean;
}

export function validateSubmission(
  input: SubmissionValidationInput,
): SubmissionValidationOutcome {
  const findings: SubmissionValidationFinding[] = [];
  const add = (
    severity: "BLOCKING" | "WARNING" | "INFO",
    code: string,
    field: string | null,
    message: string,
  ): void => {
    findings.push({ severity, code, field, message });
  };
  const route = input.routeSnapshot.route;

  if (!input.approvedVendorReport) {
    add(
      "BLOCKING",
      "VENDOR_REPORT_NOT_APPROVED",
      "reportExportId",
      "Approve the vendor report before preparing a delivery package.",
    );
  } else if (!input.completedReportExport) {
    add(
      "BLOCKING",
      "VENDOR_REPORT_EXPORT_INCOMPLETE",
      "reportExportId",
      "Generate a completed vendor PDF before sealing the submission.",
    );
  }

  if (!input.disclosureAllowed) {
    add(
      "BLOCKING",
      "DISCLOSURE_NOT_ALLOWED",
      null,
      "The case disclosure controls do not currently allow a vendor submission.",
    );
  }
  if (!input.tlpAllowsVendor) {
    add(
      "BLOCKING",
      "TLP_VENDOR_CONFLICT",
      null,
      "The selected TLP handling rule does not permit sharing this content with the vendor.",
    );
  }
  if (!input.aiDraftReviewed) {
    add(
      "BLOCKING",
      "AI_DRAFT_REVIEW_REQUIRED",
      null,
      "A person must review AI-assisted text before it can be approved or sealed.",
    );
  }

  if (route.sourceReviewedAt !== undefined && route.sourceReviewedAt !== null) {
    const age =
      Date.parse(input.checkedAt) - Date.parse(route.sourceReviewedAt);
    if (!Number.isFinite(age) || age > 180 * 86_400_000) {
      add(
        "WARNING",
        "ROUTE_SOURCE_STALE",
        "route",
        "The disclosure route source was reviewed more than 180 days ago. Recheck the official vendor instructions.",
      );
    }
  } else {
    add(
      "WARNING",
      "ROUTE_SOURCE_UNVERIFIED",
      "route",
      "This disclosure route has no recorded source review date.",
    );
  }

  for (const required of route.type === "EMAIL" ? route.requiredFields : []) {
    if (input.requiredFieldContent[required] !== true) {
      add(
        "BLOCKING",
        "REQUIRED_FIELD_MISSING",
        required,
        `Complete the required ${required.replaceAll("_", " ")} content.`,
      );
    }
  }
  if (route.type === "MANUAL") {
    for (const mapping of route.fieldMappings.filter(
      (field) => field.required,
    )) {
      if ((input.manualFields[mapping.key] ?? "").trim().length === 0) {
        add(
          "BLOCKING",
          "REQUIRED_FIELD_MISSING",
          `manualFields.${mapping.key}`,
          `Complete the required portal field “${mapping.label}”.`,
        );
      }
    }
  }

  validateAttachments(input, add);

  if (route.type === "EMAIL") {
    validateEmailRoute(input, add);
  } else {
    validateManualRoute(input, add);
  }

  if (
    /zero[- ]?day|remote code execution|\brce\b|auth(?:entication)? bypass|sql injection|pre-?auth/i.test(
      input.subject,
    )
  ) {
    add(
      "WARNING",
      "SUBJECT_CONTAINS_SENSITIVE_DETAIL",
      "subject",
      "Email and provider metadata expose the subject. Prefer a neutral case reference without vulnerability details.",
    );
  }
  if (input.cryptoMode === "ENCRYPTED") {
    add(
      "WARNING",
      "SUBJECT_NOT_ENCRYPTED",
      "subject",
      "OpenPGP protects the message body and attachments, not the email subject or routing metadata.",
    );
  }

  return {
    findings,
    blocking: findings.some((finding) => finding.severity === "BLOCKING"),
  };
}

function validateAttachments(
  input: SubmissionValidationInput,
  add: (
    severity: "BLOCKING" | "WARNING" | "INFO",
    code: string,
    field: string | null,
    message: string,
  ) => void,
): void {
  input.attachments.forEach((attachment, index) => {
    const field = `attachments.${index}`;
    if (attachment.visibility === "INTERNAL") {
      add(
        "BLOCKING",
        "ATTACHMENT_VISIBILITY_VIOLATION",
        field,
        `“${attachment.filename}” is internal and cannot be included in a vendor submission.`,
      );
    }
    if (attachment.status !== "STORED") {
      add(
        "BLOCKING",
        "ATTACHMENT_NOT_AVAILABLE",
        field,
        `“${attachment.filename}” is ${attachment.status.toLowerCase()} and cannot be packaged.`,
      );
    }
    if (!/^[0-9a-f]{64}$/i.test(attachment.sha256)) {
      add(
        "BLOCKING",
        "ATTACHMENT_HASH_INVALID",
        field,
        `“${attachment.filename}” has no valid SHA-256 digest.`,
      );
    }
    if (attachment.sourceRevision !== attachment.currentSourceRevision) {
      add(
        "BLOCKING",
        "ATTACHMENT_SOURCE_CHANGED",
        field,
        `“${attachment.filename}” changed after it was selected. Review and select the current revision.`,
      );
    }
    if (attachment.pocApprovedForVendor === false) {
      add(
        "BLOCKING",
        "POC_VENDOR_APPROVAL_REQUIRED",
        field,
        `“${attachment.filename}” is a proof of concept that has not been approved for the vendor audience.`,
      );
    }
    if (
      input.routeSnapshot.route.type === "EMAIL" &&
      GMAIL_BLOCKED_EXTENSIONS.has(fileExtension(attachment.filename))
    ) {
      add(
        "BLOCKING",
        "GMAIL_BLOCKED_EXTENSION",
        field,
        `Gmail blocks the “${fileExtension(attachment.filename)}” attachment type, including when it is placed inside an archive.`,
      );
    }
  });
}

function validateEmailRoute(
  input: SubmissionValidationInput,
  add: (
    severity: "BLOCKING" | "WARNING" | "INFO",
    code: string,
    field: string | null,
    message: string,
  ) => void,
): void {
  const route = input.routeSnapshot.route;
  if (route.type !== "EMAIL") return;
  if (
    route.to.length === 0 ||
    [...route.to, ...route.cc].some((address) => !validEmail(address))
  ) {
    add(
      "BLOCKING",
      "EMAIL_RECIPIENT_INVALID",
      "route",
      "The snapshotted email route has a missing or invalid recipient.",
    );
  }
  if (!input.gmailConnectionAvailable) {
    add(
      "BLOCKING",
      "GMAIL_CONNECTION_REQUIRED",
      null,
      "Connect an authorized Gmail account before sealing an email submission.",
    );
  }
  const attachmentBytes = input.attachments.reduce(
    (total, attachment) => total + attachment.sizeBytes,
    0,
  );
  if (attachmentBytes > route.maximumAttachmentBytes) {
    add(
      "BLOCKING",
      "ROUTE_ATTACHMENT_LIMIT_EXCEEDED",
      "attachments",
      "The selected attachments exceed the vendor route limit.",
    );
  }
  if (input.estimatedFinalMimeBytes > GMAIL_MAX_MESSAGE_BYTES) {
    add(
      "BLOCKING",
      "GMAIL_MESSAGE_LIMIT_EXCEEDED",
      "attachments",
      "The estimated final MIME message exceeds Gmail’s 25 MiB limit after encoding.",
    );
  }
  if (
    input.cryptoMode === "ENCRYPTED" &&
    route.encryptionPolicy === "FORBIDDEN"
  ) {
    add(
      "BLOCKING",
      "ENCRYPTION_FORBIDDEN",
      "cryptoMode",
      "This route forbids encrypted delivery.",
    );
  }
  if (
    input.cryptoMode !== "ENCRYPTED" &&
    route.encryptionPolicy === "REQUIRED"
  ) {
    add(
      "BLOCKING",
      "ENCRYPTION_REQUIRED",
      "cryptoMode",
      "This route requires OpenPGP encryption.",
    );
  }
  if (input.cryptoMode === "ENCRYPTED")
    validateKey(route.publicKeyId, input.publicKey, add);
}

function validateManualRoute(
  input: SubmissionValidationInput,
  add: (
    severity: "BLOCKING" | "WARNING" | "INFO",
    code: string,
    field: string | null,
    message: string,
  ) => void,
): void {
  const route = input.routeSnapshot.route;
  if (route.type !== "MANUAL") return;
  if (!route.destinationUrl.startsWith("https://")) {
    add(
      "BLOCKING",
      "MANUAL_DESTINATION_INVALID",
      "route",
      "The manual route destination must use HTTPS.",
    );
  }
  if (input.attachments.length > route.maximumFileCount) {
    add(
      "BLOCKING",
      "MANUAL_FILE_COUNT_EXCEEDED",
      "attachments",
      "The selected attachments exceed the portal file-count limit.",
    );
  }
  for (const attachment of input.attachments) {
    if (attachment.sizeBytes > route.maximumFileBytes) {
      add(
        "BLOCKING",
        "MANUAL_FILE_SIZE_EXCEEDED",
        "attachments",
        `“${attachment.filename}” exceeds the portal per-file limit.`,
      );
    }
    if (
      route.acceptedExtensions.length > 0 &&
      !route.acceptedExtensions.includes(fileExtension(attachment.filename))
    ) {
      add(
        "BLOCKING",
        "MANUAL_FILE_EXTENSION_REJECTED",
        "attachments",
        `“${attachment.filename}” does not use an extension accepted by the portal.`,
      );
    }
  }
}

function validateKey(
  expectedKeyId: string | null,
  key: ValidationPublicKey | null,
  add: (
    severity: "BLOCKING" | "WARNING" | "INFO",
    code: string,
    field: string | null,
    message: string,
  ) => void,
): void {
  if (expectedKeyId === null || key === null || key.id !== expectedKeyId) {
    add(
      "BLOCKING",
      "ENCRYPTION_KEY_MISSING",
      "cryptoMode",
      "Select the exact public-key version captured by this route.",
    );
    return;
  }
  if (!key.verified)
    add(
      "BLOCKING",
      "ENCRYPTION_KEY_UNVERIFIED",
      "cryptoMode",
      "Verify the public-key fingerprint through an independent channel.",
    );
  if (key.expired)
    add(
      "BLOCKING",
      "ENCRYPTION_KEY_EXPIRED",
      "cryptoMode",
      "The selected public key has expired.",
    );
  if (key.revoked)
    add(
      "BLOCKING",
      "ENCRYPTION_KEY_REVOKED",
      "cryptoMode",
      "The selected public key is revoked.",
    );
  if (key.superseded)
    add(
      "BLOCKING",
      "ENCRYPTION_KEY_SUPERSEDED",
      "cryptoMode",
      "The selected public key was superseded by a newer version.",
    );
}

function fileExtension(filename: string): string {
  const index = filename.lastIndexOf(".");
  return index < 0 ? "" : filename.slice(index).toLocaleLowerCase("en-US");
}

function validEmail(value: string): boolean {
  return (
    value.length <= 320 &&
    !/[\r\n]/.test(value) &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
  );
}
