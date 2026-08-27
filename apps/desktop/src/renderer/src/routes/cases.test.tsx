import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type * as TanStackRouter from "@tanstack/react-router";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { CaseSummary } from "@codevault/contracts";

import { CasesRoute } from "./cases.js";

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
    useNavigate: () => vi.fn(),
  };
});

vi.mock("../lib/bridge.js", () => ({
  bridge: () => ({
    api: { request: apiRequest },
    avatars: {
      loadUser: () => Promise.resolve({ ok: true, data: null }),
    },
  }),
}));

const firstCase = makeCase(
  "11111111-1111-4111-8111-111111111111",
  "CASE-000001",
  "First page case",
);
const secondCase = makeCase(
  "22222222-2222-4222-8222-222222222222",
  "CASE-000002",
  "Second page case",
);
const thirdCase = makeCase(
  "33333333-3333-4333-8333-333333333333",
  "CASE-000003",
  "Third page case",
);

describe("CasesRoute pagination", () => {
  it("shows the total and jumps directly between numbered pages", async () => {
    apiRequest.mockImplementation((path: string) => {
      if (path === "/v1/organization/users") {
        return Promise.resolve({ ok: true, data: { items: [] } });
      }

      if (path.includes("page=2")) {
        return Promise.resolve({
          ok: true,
          data: { items: [secondCase], nextCursor: null, total: 1_250 },
        });
      }

      if (path.includes("page=3")) {
        return Promise.resolve({
          ok: true,
          data: { items: [thirdCase], nextCursor: null, total: 1_250 },
        });
      }

      return Promise.resolve({
        ok: true,
        data: { items: [firstCase], nextCursor: null, total: 1_250 },
      });
    });
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <QueryClientProvider client={client}>
        <CasesRoute />
      </QueryClientProvider>,
    );

    expect(await screen.findByText("First page case")).toBeTruthy();
    expect(screen.getByText("1,250 cases")).toBeTruthy();
    expect(screen.getByText("Page 1 of 25")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Page 25" })).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Page 3" }));

    expect(await screen.findByText("Third page case")).toBeTruthy();
    await waitFor(() =>
      expect(
        apiRequest.mock.calls.some(
          ([path]) => path === "/v1/cases?limit=50&page=3",
        ),
      ).toBe(true),
    );
    expect(
      apiRequest.mock.calls
        .map(([path]) => String(path))
        .some((path) => /limit=(?:[2-9]\d\d|\d{4,})/.test(path)),
    ).toBe(false);

    await userEvent.click(screen.getByRole("button", { name: "Page 1" }));
    expect(await screen.findByText("First page case")).toBeTruthy();

    await userEvent.click(screen.getByRole("button", { name: "Page 2" }));
    expect(await screen.findByText("Second page case")).toBeTruthy();
    await userEvent.type(
      screen.getByRole("textbox", { name: "Search cases" }),
      "kernel",
    );

    await waitFor(() =>
      expect(
        apiRequest.mock.calls.some(
          ([path]) => path === "/v1/cases?limit=50&page=1&query=kernel",
        ),
      ).toBe(true),
    );
    expect(
      screen
        .getByRole("button", { name: "Page 1" })
        .getAttribute("aria-current"),
    ).toBe("page");
  });
});

function makeCase(id: string, ref: string, title: string): CaseSummary {
  return {
    id,
    ref,
    title,
    summary: null,
    profile: "STANDARD",
    status: "OPEN",
    restricted: false,
    disclosureEnabled: false,
    owner: {
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      displayName: "Researcher",
      email: "researcher@example.com",
    },
    findingCount: 0,
    createdAt: "2026-08-26T09:00:00.000Z",
    updatedAt: "2026-08-26T09:00:00.000Z",
    revision: 1,
  };
}
