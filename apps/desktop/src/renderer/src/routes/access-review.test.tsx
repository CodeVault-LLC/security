import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type * as TanStackRouter from "@tanstack/react-router";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type {
  CaseAccessHistoryResponse,
  CaseAccessReviewResponse,
} from "@codevault/contracts";

import { AccessReviewRoute } from "./access-review.js";

const apiRequest = vi.hoisted(() => vi.fn());

vi.mock("@tanstack/react-router", async (importOriginal) => {
  const original = await importOriginal<typeof TanStackRouter>();
  return {
    ...original,
    Link: ({
      children,
      ...props
    }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
      <a {...props}>{children}</a>
    ),
    useRouterState: () => "/organization/access-review",
  };
});

vi.mock("../lib/bridge.js", () => ({
  bridge: () => ({ api: { request: apiRequest } }),
}));

const CASE_ID = "018f47d2-7d20-7a31-8fb8-9d5f3d680001";
const OWNER_ID = "018f47d2-7d20-7a31-8fb8-9d5f3d680002";
const MEMBER_ID = "018f47d2-7d20-7a31-8fb8-9d5f3d680003";

const review: CaseAccessReviewResponse = {
  items: [
    {
      id: CASE_ID,
      ref: "CASE-2026-0001",
      title: "Embargoed parser research",
      status: "OPEN",
      restricted: true,
      updatedAt: "2026-08-28T10:00:00.000Z",
      principals: [
        {
          user: {
            id: OWNER_ID,
            displayName: "Case Owner",
            email: "owner@example.test",
          },
          role: "MEMBER",
          disabled: false,
          source: "OWNER",
          grantedCapabilities: ["READ", "WRITE", "APPROVAL", "DISCLOSURE"],
          effectiveCapabilities: ["READ", "WRITE", "APPROVAL", "DISCLOSURE"],
          grantedAt: null,
        },
        {
          user: {
            id: MEMBER_ID,
            displayName: "Disclosure Reviewer",
            email: "reviewer@example.test",
          },
          role: "VIEWER",
          disabled: false,
          source: "GRANT",
          grantedCapabilities: ["READ", "APPROVAL", "DISCLOSURE"],
          effectiveCapabilities: ["READ"],
          grantedAt: "2026-08-28T10:00:00.000Z",
        },
      ],
    },
  ],
  nextCursor: null,
  total: 1,
};

const history: CaseAccessHistoryResponse = {
  items: [
    {
      id: "018f47d2-7d20-7a31-8fb8-9d5f3d680004",
      kind: "UPDATED",
      actor: review.items[0]!.principals[0]!.user,
      subject: review.items[0]!.principals[1]!.user,
      previousSubject: null,
      beforeCapabilities: ["READ", "WRITE"],
      afterCapabilities: ["READ", "APPROVAL", "DISCLOSURE"],
      requestId: "request-1",
      occurredAt: "2026-08-28T10:05:00.000Z",
    },
  ],
  nextCursor: null,
  total: 1,
};

describe("AccessReviewRoute", () => {
  it("shows effective capability ceilings and the selected case audit history", async () => {
    apiRequest.mockImplementation((path: string) =>
      Promise.resolve({
        ok: true,
        data: path.includes("access-history") ? history : review,
      }),
    );
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const user = userEvent.setup();

    render(
      <QueryClientProvider client={client}>
        <AccessReviewRoute />
      </QueryClientProvider>,
    );

    expect(
      (await screen.findAllByText("Embargoed parser research")).length,
    ).toBe(2);
    expect(screen.getByText("Case Owner")).toBeTruthy();
    expect(screen.getByText("Disclosure Reviewer")).toBeTruthy();
    expect(screen.getByText("Role ceiling")).toBeTruthy();

    await user.click(
      screen.getByRole("button", { name: "Review access history" }),
    );

    expect(await screen.findByText("Access changed")).toBeTruthy();
    expect(
      screen.getByText("read · write → read · approval · disclosure"),
    ).toBeTruthy();

    await user.type(screen.getByLabelText("Filter access review"), "missing");
    expect(
      await screen.findByText("No access rows match this filter"),
    ).toBeTruthy();
  });
});
