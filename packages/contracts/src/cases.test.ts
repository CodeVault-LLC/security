import { FormatRegistry } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import { describe, expect, it } from "vitest";

import { isUuid } from "@codevault/core";

import {
  AddCaseMemberRequest,
  CaseAccessHistoryResponse,
  CaseAccessReviewResponse,
} from "./cases.js";

FormatRegistry.Set("uuid", isUuid);
FormatRegistry.Set("date-time", (value) => Number.isFinite(Date.parse(value)));
FormatRegistry.Set("email", (value) =>
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(value),
);

const USER_ID = "018f47d2-7d20-7a31-8fb8-9d5f3d680001";

describe("case capability grants", () => {
  it("accepts independent capabilities when read is present", () => {
    expect(
      Value.Check(AddCaseMemberRequest, {
        userId: USER_ID,
        capabilities: ["READ", "APPROVAL", "DISCLOSURE"],
      }),
    ).toBe(true);
  });

  it("rejects action capabilities without read", () => {
    expect(
      Value.Check(AddCaseMemberRequest, {
        userId: USER_ID,
        capabilities: ["WRITE"],
      }),
    ).toBe(false);
  });

  it("rejects duplicate capabilities and the legacy access field", () => {
    expect(
      Value.Check(AddCaseMemberRequest, {
        userId: USER_ID,
        capabilities: ["READ", "READ"],
      }),
    ).toBe(false);
    expect(
      Value.Check(AddCaseMemberRequest, {
        userId: USER_ID,
        access: "WRITE",
      }),
    ).toBe(false);
  });

  it("describes assigned and effective access separately", () => {
    expect(
      Value.Check(CaseAccessReviewResponse, {
        items: [
          {
            id: USER_ID,
            ref: "CASE-2026-0001",
            title: "Embargoed case",
            status: "OPEN",
            restricted: true,
            principals: [
              {
                user: {
                  id: USER_ID,
                  displayName: "Read-only owner",
                  email: "owner@example.test",
                },
                role: "VIEWER",
                disabled: false,
                source: "OWNER",
                grantedCapabilities: [
                  "READ",
                  "WRITE",
                  "APPROVAL",
                  "DISCLOSURE",
                ],
                effectiveCapabilities: ["READ"],
                grantedAt: null,
              },
            ],
            updatedAt: "2026-08-28T10:00:00.000Z",
          },
        ],
        nextCursor: null,
        total: 1,
      }),
    ).toBe(true);
  });

  it("represents a complete capability change history", () => {
    expect(
      Value.Check(CaseAccessHistoryResponse, {
        items: [
          {
            id: USER_ID,
            kind: "UPDATED",
            actor: null,
            subject: null,
            previousSubject: null,
            beforeCapabilities: ["READ", "WRITE"],
            afterCapabilities: ["READ", "APPROVAL"],
            requestId: null,
            occurredAt: "2026-08-28T10:00:00.000Z",
          },
          {
            id: "018f47d2-7d20-7a31-8fb8-9d5f3d680002",
            kind: "LEGACY_CHANGE",
            actor: null,
            subject: null,
            previousSubject: null,
            beforeCapabilities: null,
            afterCapabilities: ["READ", "WRITE"],
            requestId: null,
            occurredAt: "2026-08-28T09:00:00.000Z",
          },
        ],
        nextCursor: null,
        total: 1,
      }),
    ).toBe(true);
  });
});
