import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { uuidv7 } from "@codevault/core/crypto";

import { createDatabase, type DatabaseHandle } from "./client.js";
import { assets } from "./schema/assets.js";
import { users } from "./schema/auth.js";
import { cases } from "./schema/cases.js";
import { artifacts } from "./schema/evidence.js";
import { mailboxConnections, mailboxSyncEvents } from "./schema/mail.js";
import {
  submissionDeliveryAttempts,
  submissionDeliveries,
  submissionPackages,
  submissions,
} from "./schema/submissions.js";
import { vendorRoutes, vendors } from "./schema/vendors.js";

describe("vendor submission schema", () => {
  it("exports the ownership, immutable evidence, and mailbox tables", () => {
    expect(vendors.id).toBeDefined();
    expect(vendorRoutes.vendorId).toBeDefined();
    expect(assets.vendorId).toBeDefined();
    expect(submissions.routeSnapshot).toBeDefined();
    expect(submissionPackages.packageSha256).toBeDefined();
    expect(submissionDeliveryAttempts.deliveryId).toBeDefined();
    expect(mailboxConnections.refreshTokenCiphertext).toBeDefined();
    expect(mailboxSyncEvents.historyId).toBeDefined();
  });
});

const connectionString = process.env.DATABASE_URL;
const describeIntegration = connectionString ? describe : describe.skip;

describeIntegration("vendor submission persistence", () => {
  let handle: DatabaseHandle;

  beforeAll(() => {
    handle = createDatabase({ connectionString: connectionString as string });
  });

  afterAll(async () => {
    await handle.close();
  });

  it("allows one vendor to own many assets and preserves a route snapshot", async () => {
    const actorId = uuidv7();
    const caseId = uuidv7();
    const vendorId = uuidv7();
    const routeId = uuidv7();
    const submissionId = uuidv7();
    const routeSnapshot = {
      routeId,
      routeRevision: 1,
      vendorId,
      capturedAt: "2026-08-18T10:00:00.000Z",
      route: {
        name: "PSIRT email",
        type: "EMAIL",
        to: ["security@example.com"],
        cc: [],
        subjectTemplate: "Security report: {caseRef}",
        encryptionPolicy: "OPTIONAL",
        publicKeyId: null,
        maximumAttachmentBytes: 20_000_000,
        acknowledgementBusinessDays: 5,
        updateCadenceDays: 42,
        requiredFields: ["affected_product", "reproduction", "impact"],
      },
    };

    await expect(
      handle.db.transaction(async (tx) => {
        await tx.insert(users).values({
          id: actorId,
          email: `vendor-schema-${actorId}@codevault.test`,
          displayName: "Vendor Schema Probe",
          passwordHash: "not-a-real-hash",
          role: "MEMBER",
        });
        await tx.insert(cases).values({
          id: caseId,
          ref: `CASE-2099-${actorId.slice(-4)}`,
          title: "Vendor schema probe",
          profile: "CRITICAL_ZERO_DAY",
          ownerId: actorId,
          restricted: true,
        });
        await tx.insert(vendors).values({
          id: vendorId,
          ref: `VND-${actorId.slice(-6)}`,
          slug: `vendor-${actorId}`,
          name: `Vendor ${actorId}`,
          normalizedName: `vendor ${actorId}`,
          createdBy: actorId,
        });
        await tx.insert(vendorRoutes).values({
          id: routeId,
          vendorId,
          name: "PSIRT email",
          type: "EMAIL",
          requirements: routeSnapshot.route,
          createdBy: actorId,
        });
        await tx.insert(assets).values([
          {
            ref: `AST-${actorId.slice(-6)}`,
            name: "Archer",
            kind: "DEVICE",
            vendorId,
            createdBy: actorId,
          },
          {
            ref: `AST-${actorId.slice(-5)}1`,
            name: "Tapo",
            kind: "DEVICE",
            vendorId,
            createdBy: actorId,
          },
        ]);
        await tx.insert(submissions).values({
          id: submissionId,
          ref: `SUB-${actorId.slice(-6)}`,
          caseId,
          vendorId,
          routeId,
          routeSnapshot,
          createdBy: actorId,
          lastEditedBy: actorId,
        });

        await tx
          .update(vendorRoutes)
          .set({ name: "Replacement PSIRT email", revision: 2 })
          .where(eq(vendorRoutes.id, routeId));

        const ownedAssets = await tx
          .select({ vendorId: assets.vendorId })
          .from(assets)
          .where(eq(assets.vendorId, vendorId));
        const [storedSubmission] = await tx
          .select({ routeSnapshot: submissions.routeSnapshot })
          .from(submissions)
          .where(eq(submissions.id, submissionId));

        expect(ownedAssets).toHaveLength(2);
        expect(ownedAssets.every((asset) => asset.vendorId === vendorId)).toBe(
          true,
        );
        expect(storedSubmission?.routeSnapshot).toEqual(routeSnapshot);

        throw new Error("ROLLBACK_VENDOR_SUBMISSION_TEST");
      }),
    ).rejects.toThrow("ROLLBACK_VENDOR_SUBMISSION_TEST");
  });

  it("refuses to update or delete package, attempt, and sync evidence", async () => {
    const actorId = uuidv7();
    const caseId = uuidv7();
    const vendorId = uuidv7();
    const routeId = uuidv7();
    const submissionId = uuidv7();
    const artifactId = uuidv7();
    const protectedPackageId = uuidv7();
    const deliveryPackageId = uuidv7();
    const connectionId = uuidv7();
    const deliveryId = uuidv7();
    const attemptId = uuidv7();
    const syncEventId = uuidv7();
    const routeSnapshot = {
      routeId,
      routeRevision: 1,
      vendorId,
      capturedAt: "2026-08-18T10:00:00.000Z",
      route: {
        name: "Manual intake",
        type: "MANUAL",
        destinationUrl: "https://example.com/security",
        fieldMappings: [],
      },
    };

    await expect(
      handle.db.transaction(async (tx) => {
        await tx.insert(users).values({
          id: actorId,
          email: `append-only-${actorId}@codevault.test`,
          displayName: "Append-only Probe",
          passwordHash: "not-a-real-hash",
          role: "MEMBER",
        });
        await tx.insert(cases).values({
          id: caseId,
          ref: `CASE-2098-${actorId.slice(-4)}`,
          title: "Append-only probe",
          profile: "COORDINATED_DISCLOSURE",
          ownerId: actorId,
        });
        await tx.insert(vendors).values({
          id: vendorId,
          ref: `VND-${actorId.slice(-6)}`,
          slug: `append-only-${actorId}`,
          name: `Append-only ${actorId}`,
          normalizedName: `append-only ${actorId}`,
          createdBy: actorId,
        });
        await tx.insert(vendorRoutes).values({
          id: routeId,
          vendorId,
          name: "Manual intake",
          type: "MANUAL",
          requirements: routeSnapshot.route,
          createdBy: actorId,
        });
        await tx.insert(mailboxConnections).values({
          id: connectionId,
          userId: actorId,
          provider: "gmail",
          externalAccountId: `account-${actorId}`,
          emailAddress: `append-only-${actorId}@codevault.test`,
          capabilities: ["SEND"],
          refreshTokenCiphertext: new Uint8Array([1]),
          refreshTokenNonce: new Uint8Array(12),
          refreshTokenAuthTag: new Uint8Array(16),
          tokenKeyVersion: 1,
        });
        await tx.insert(submissions).values({
          id: submissionId,
          ref: `SUB-${actorId.slice(-6)}`,
          caseId,
          vendorId,
          routeId,
          routeSnapshot,
          createdBy: actorId,
          lastEditedBy: actorId,
        });
        await tx.insert(artifacts).values({
          id: artifactId,
          caseId,
          filename: "sealed.eml",
          objectKey: `tests/${artifactId}`,
          mimeType: "message/rfc822",
          sizeBytes: 20,
          sha256: "a".repeat(64),
          artifactKind: "DOCUMENT",
          visibility: "VENDOR",
          status: "STORED",
          uploadedBy: actorId,
        });
        await tx.insert(submissionPackages).values([
          {
            id: protectedPackageId,
            submissionId,
            intentId: uuidv7(),
            manifest: { version: 1 },
            manifestSha256: "b".repeat(64),
            packageSha256: "c".repeat(64),
            artifactId,
            sizeBytes: 20,
            createdBy: actorId,
          },
          {
            id: deliveryPackageId,
            submissionId,
            intentId: uuidv7(),
            manifest: { version: 1 },
            manifestSha256: "d".repeat(64),
            packageSha256: "e".repeat(64),
            artifactId,
            sizeBytes: 20,
            createdBy: actorId,
          },
        ]);
        await tx.insert(submissionDeliveries).values({
          id: deliveryId,
          submissionId,
          packageId: deliveryPackageId,
          mailboxConnectionId: connectionId,
          provider: "gmail",
          status: "FAILED",
          recipients: { to: ["security@example.com"], cc: [] },
          routeSnapshot,
          createdBy: actorId,
        });
        await tx.insert(submissionDeliveryAttempts).values({
          id: attemptId,
          deliveryId,
          attemptNumber: 1,
          outcome: "FAILED",
          errorCategory: "TIMEOUT",
          startedAt: "2026-08-18T10:00:00.000Z",
          completedAt: "2026-08-18T10:01:00.000Z",
        });
        await tx.insert(mailboxSyncEvents).values({
          id: syncEventId,
          mailboxConnectionId: connectionId,
          notificationId: `notification-${actorId}`,
          historyId: "9007199254740993",
          outcome: "PROCESSED",
        });

        await tx
          .update(submissionPackages)
          .set({ packageSha256: "f".repeat(64) })
          .where(eq(submissionPackages.id, protectedPackageId));
        await tx
          .delete(submissionPackages)
          .where(eq(submissionPackages.id, protectedPackageId));
        await tx
          .update(submissionDeliveryAttempts)
          .set({ outcome: "SENT" })
          .where(eq(submissionDeliveryAttempts.id, attemptId));
        await tx
          .delete(submissionDeliveryAttempts)
          .where(eq(submissionDeliveryAttempts.id, attemptId));
        await tx
          .update(mailboxSyncEvents)
          .set({ outcome: "FAILED" })
          .where(eq(mailboxSyncEvents.id, syncEventId));
        await tx
          .delete(mailboxSyncEvents)
          .where(eq(mailboxSyncEvents.id, syncEventId));

        const [storedPackage] = await tx
          .select({ sha256: submissionPackages.packageSha256 })
          .from(submissionPackages)
          .where(eq(submissionPackages.id, protectedPackageId));
        const [storedAttempt] = await tx
          .select({ outcome: submissionDeliveryAttempts.outcome })
          .from(submissionDeliveryAttempts)
          .where(eq(submissionDeliveryAttempts.id, attemptId));
        const [storedSync] = await tx
          .select({ outcome: mailboxSyncEvents.outcome })
          .from(mailboxSyncEvents)
          .where(eq(mailboxSyncEvents.id, syncEventId));

        expect(storedPackage?.sha256).toBe("c".repeat(64));
        expect(storedAttempt?.outcome).toBe("FAILED");
        expect(storedSync?.outcome).toBe("PROCESSED");

        throw new Error("ROLLBACK_APPEND_ONLY_TEST");
      }),
    ).rejects.toThrow("ROLLBACK_APPEND_ONLY_TEST");
  });
});
