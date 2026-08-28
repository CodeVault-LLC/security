import { describe, expect, it } from "vitest";

import type { ServerEvent } from "@codevault/contracts";

import { createEventBroker } from "./events.js";

describe("case access events", () => {
  it("delivers a targeted revocation event after ordinary visibility is gone", async () => {
    const broker = createEventBroker();
    const revokedEvents: ServerEvent[] = [];
    const otherEvents: ServerEvent[] = [];
    broker.setVisibilityFilter(() => false);
    broker.subscribe({
      id: "revoked-subscriber",
      userId: "revoked-user",
      send: (event) => revokedEvents.push(event),
    });
    broker.subscribe({
      id: "other-subscriber",
      userId: "other-user",
      send: (event) => otherEvents.push(event),
    });

    broker.publish({
      type: "case.access_changed",
      entityType: "case_access",
      entityId: "case-1",
      caseId: "018f47d2-7d20-7a31-8fb8-9d5f3d680001",
      targetUserId: "revoked-user",
      detail: { canRead: false },
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(revokedEvents).toHaveLength(1);
    expect(otherEvents).toHaveLength(0);
  });

  it("does not bypass visibility for a targeted grant event", async () => {
    const broker = createEventBroker();
    const events: ServerEvent[] = [];
    broker.setVisibilityFilter(() => false);
    broker.subscribe({
      id: "disabled-subscriber",
      userId: "disabled-user",
      send: (event) => events.push(event),
    });

    broker.publish({
      type: "case.access_changed",
      entityType: "case_access",
      entityId: "case-1",
      caseId: "018f47d2-7d20-7a31-8fb8-9d5f3d680001",
      targetUserId: "disabled-user",
      detail: { canRead: true, capabilities: ["READ"] },
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(events).toHaveLength(0);
  });
});
