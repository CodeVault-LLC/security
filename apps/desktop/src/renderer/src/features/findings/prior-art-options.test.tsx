import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { vi } from "vitest";

import type { FindingDetail } from "@codevault/contracts";

import { parsePriorArtKeywords } from "./prior-art-options.js";
import { PriorArtPanel } from "./prior-art-panel.js";

describe("prior-art check options", () => {
  it("normalizes comma and newline separated terms while preserving order", () => {
    expect(
      parsePriorArtKeywords(" wp_ajax, nonce\nWP_AJAX\n capability check "),
    ).toEqual({
      keywords: ["wp_ajax", "nonce", "capability check"],
      error: null,
    });
  });

  it("rejects terms longer than the API contract permits", () => {
    const result = parsePriorArtKeywords("a".repeat(101));

    expect(result.keywords).toEqual([]);
    expect(result.error).toContain("100 characters");
  });

  it("rejects more than 20 distinct terms", () => {
    const result = parsePriorArtKeywords(
      Array.from({ length: 21 }, (_, index) => `term-${index}`).join(","),
    );

    expect(result.keywords).toEqual([]);
    expect(result.error).toContain("20 keywords");
  });
});

describe("configured prior-art checks", () => {
  it("submits normalized terms and the source-only choice", async () => {
    const request = vi.fn(async (_path: string, options?: unknown) => ({
      ok: true as const,
      data:
        options === undefined
          ? { items: [] }
          : {
              id: "11111111-1111-4111-8111-111111111111",
              status: "QUEUED",
            },
    }));
    Object.defineProperty(window, "codevault", {
      configurable: true,
      value: { api: { request } },
    });
    const client = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
    const finding = {
      id: "22222222-2222-4222-8222-222222222222",
      priorArtState: "UNCHECKED",
    } as FindingDetail;
    const user = userEvent.setup();

    render(
      <QueryClientProvider client={client}>
        <PriorArtPanel finding={finding} canEdit />
      </QueryClientProvider>,
    );

    await user.click(
      await screen.findByRole("button", { name: "Check prior art" }),
    );
    await user.type(
      screen.getByLabelText("Additional keywords (optional)"),
      "wp_ajax, nonce, WP_AJAX",
    );
    await user.click(screen.getByLabelText("Skip AI comparison"));
    await user.click(screen.getByRole("button", { name: "Start check" }));

    await waitFor(() =>
      expect(request).toHaveBeenCalledWith(
        `/v1/findings/${finding.id}/prior-art-checks`,
        {
          method: "POST",
          body: {
            keywords: ["wp_ajax", "nonce"],
            skipAiSynthesis: true,
          },
        },
      ),
    );
  });
});
