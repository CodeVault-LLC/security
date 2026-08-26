import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { SecurityNotificationInbox } from "@codevault/contracts";

import { queryKeys } from "../lib/api.js";
import { NotificationsRoute } from "./notifications.js";

const apiRequest = vi.hoisted(() => vi.fn());

vi.mock("../lib/bridge.js", () => ({
  bridge: () => ({ api: { request: apiRequest } }),
}));

const data: SecurityNotificationInbox = {
  unreadCount: 1,
  items: [
    {
      id: "11111111-1111-4111-8111-111111111111",
      eventType: "RECOVERY_CODE_USED",
      details: {},
      occurredAt: "2026-08-26T12:00:00.000Z",
      readAt: null,
    },
  ],
};

describe("NotificationsRoute", () => {
  it("shows unread security events and marks one through the API", async () => {
    apiRequest.mockImplementation((path: string) =>
      Promise.resolve(
        path === "/v1/notifications"
          ? { ok: true, data }
          : {
              ok: true,
              data: {
                ...data.items[0],
                readAt: "2026-08-26T12:01:00.000Z",
              },
            },
      ),
    );
    const client = new QueryClient({
      defaultOptions: {
        queries: { staleTime: Number.POSITIVE_INFINITY },
        mutations: { retry: false },
      },
    });
    client.setQueryData(queryKeys.notifications, data);
    render(
      <QueryClientProvider client={client}>
        <NotificationsRoute />
      </QueryClientProvider>,
    );

    expect(screen.getByText("Recovery code used")).toBeTruthy();
    expect(screen.getByLabelText("Unread")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Mark read" }));

    await waitFor(() =>
      expect(apiRequest).toHaveBeenCalledWith(
        `/v1/notifications/${data.items[0]!.id}/read`,
        { method: "POST" },
      ),
    );
  });
});
