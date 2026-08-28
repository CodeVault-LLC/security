import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { CaseDetail } from "@codevault/contracts";

import { CaseMemberManager } from "./case-member-manager.js";

const CASE: CaseDetail = {
  id: "018f47d2-7d20-7a31-8fb8-9d5f3d680001",
  ref: "CASE-2026-0001",
  title: "Embargoed case",
  summary: null,
  profile: "COORDINATED_DISCLOSURE",
  status: "OPEN",
  restricted: true,
  disclosureEnabled: true,
  owner: {
    id: "018f47d2-7d20-7a31-8fb8-9d5f3d680002",
    displayName: "Owner",
    email: "owner@example.test",
  },
  findingCount: 0,
  createdAt: "2026-08-28T10:00:00.000Z",
  updatedAt: "2026-08-28T10:00:00.000Z",
  revision: 1,
  members: [],
  policyPackIds: [],
};

describe("case member capability management", () => {
  it("submits read plus independently selected action capabilities", async () => {
    const request = vi.fn(
      async (path: string, _options?: { body?: unknown }) => {
        if (path === "/v1/users") {
          return {
            ok: true as const,
            data: {
              items: [
                {
                  id: "018f47d2-7d20-7a31-8fb8-9d5f3d680003",
                  displayName: "Reviewer",
                  email: "reviewer@example.test",
                  role: "MEMBER",
                  disabled: false,
                  createdAt: "2026-08-28T10:00:00.000Z",
                  lastLoginAt: null,
                },
              ],
            },
          };
        }
        return { ok: true as const, data: CASE };
      },
    );
    Object.defineProperty(window, "codevault", {
      configurable: true,
      value: { api: { request } },
    });
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const user = userEvent.setup();

    render(
      <QueryClientProvider client={client}>
        <CaseMemberManager researchCase={CASE} canManage />
      </QueryClientProvider>,
    );

    await user.click(screen.getByRole("button", { name: "Add member" }));
    await user.selectOptions(
      await screen.findByLabelText("Member"),
      "018f47d2-7d20-7a31-8fb8-9d5f3d680003",
    );
    await user.click(screen.getByRole("checkbox", { name: "Approval" }));
    await user.click(screen.getByRole("checkbox", { name: "Disclosure" }));
    await user.click(screen.getByRole("button", { name: "Save access" }));

    expect(request).toHaveBeenCalledWith(
      `/v1/cases/${CASE.id}/members`,
      expect.objectContaining({
        method: "POST",
        body: {
          userId: "018f47d2-7d20-7a31-8fb8-9d5f3d680003",
          capabilities: ["READ", "APPROVAL", "DISCLOSURE"],
        },
      }),
    );
  });
});
