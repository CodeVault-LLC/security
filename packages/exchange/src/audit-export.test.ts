import { describe, expect, it } from "vitest";

import type { AuditEvent } from "@codevault/contracts";

import { exportAuditEventsCsv } from "./audit-export.js";

const event: AuditEvent = {
  id: "11111111-1111-4111-8111-111111111111",
  action: "finding.updated",
  entityType: "finding",
  entityId: "22222222-2222-4222-8222-222222222222",
  caseId: "33333333-3333-4333-8333-333333333333",
  actor: {
    id: "44444444-4444-4444-8444-444444444444",
    displayName: '=Researcher, "Red"',
    email: "researcher@example.test",
  },
  sessionId: "55555555-5555-4555-8555-555555555555",
  requestId: "request-1",
  aiRunId: null,
  before: { z: 1, nested: { beta: true, alpha: false } },
  after: { title: "Line one\nLine two", a: 2 },
  occurredAt: "2026-08-26T10:15:30.000Z",
};

describe("audit event CSV export", () => {
  it("writes a stable, complete audit row", () => {
    const csv = exportAuditEventsCsv([event]);

    expect(csv).toMatch(/^event_id,occurred_at,action,/u);
    expect(csv).toContain("'=" + 'Researcher, ""Red""');
    expect(csv).toContain('"{""a"":2,""title"":""Line one\\nLine two""}"');
    expect(csv).toContain(
      '"{""nested"":{""alpha"":false,""beta"":true},""z"":1}"',
    );
    expect(csv.endsWith("\r\n")).toBe(true);
  });

  it("labels actorless events as system and emits empty optional fields", () => {
    const csv = exportAuditEventsCsv([
      {
        ...event,
        actor: null,
        entityId: null,
        caseId: null,
        sessionId: null,
        requestId: null,
        before: null,
        after: null,
      },
    ]);

    expect(csv).toContain(",system,,finding,");
  });
});
