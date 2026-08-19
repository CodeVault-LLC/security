import { describe, expect, it, vi } from "vitest";

import { CodeVaultClient, type CodeVaultApiError } from "./client.js";

const TOKEN = "t".repeat(64);

describe("CodeVaultClient", () => {
  it("rejects cleartext connections to non-loopback servers", () => {
    expect(
      () =>
        new CodeVaultClient({
          baseUrl: "http://codevault.example",
          token: TOKEN,
        }),
    ).toThrow("must use https");
  });

  it("sends the bearer token only in the authorization header", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      jsonResponse({
        user: { id: "user" },
        session: { id: "session" },
      }),
    );
    const client = new CodeVaultClient({
      baseUrl: "http://127.0.0.1:4310/",
      token: TOKEN,
      fetch,
    });

    await client.whoAmI();

    expect(fetch).toHaveBeenCalledWith("http://127.0.0.1:4310/v1/auth/me", {
      method: "GET",
      headers: {
        authorization: `Bearer ${TOKEN}`,
        accept: "application/json",
      },
    });
  });

  it("returns bounded server errors without including the credential", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      jsonResponse(
        {
          error: {
            category: "PERMISSION_DENIED",
            message: "This action requires a writer.",
            requestId: "request-1",
          },
        },
        403,
      ),
    );
    const client = new CodeVaultClient({
      baseUrl: "https://codevault.example",
      token: TOKEN,
      fetch,
    });

    const promise = client.createVendor({ name: "Example" });

    await expect(promise).rejects.toMatchObject({
      status: 403,
      category: "PERMISSION_DENIED",
      requestId: "request-1",
      message: "This action requires a writer.",
    } satisfies Partial<CodeVaultApiError>);
    await expect(promise).rejects.not.toThrow(TOKEN);
  });

  it("records narrative, assets, and affected ranges after draft creation", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(jsonResponse(finding(1)))
      .mockResolvedValueOnce(jsonResponse(finding(2)))
      .mockResolvedValueOnce(jsonResponse(finding(2)))
      .mockResolvedValueOnce(jsonResponse(finding(2)));
    const client = new CodeVaultClient({
      baseUrl: "https://codevault.example",
      token: TOKEN,
      fetch,
    });

    await client.recordFinding({
      caseId: "00000000-0000-4000-8000-000000000001",
      title: "Repository path traversal permits file disclosure",
      summaryMarkdown: "A crafted path escapes the repository root.",
      primaryAssetId: "00000000-0000-4000-8000-000000000002",
      technicalMarkdown: "The path is joined before validation.",
      cweIds: ["CWE-22"],
      affectedRanges: [
        {
          assetId: "00000000-0000-4000-8000-000000000003",
          kind: "EXACT_VERSION",
          expression: "1.2.3",
          status: "CONFIRMED_VULNERABLE",
          evidenceNote: "Reproduced against the tagged release.",
        },
      ],
    });

    expect(fetch).toHaveBeenCalledTimes(4);
    expect(requestAt(fetch, 0)).toMatchObject({
      url: "https://codevault.example/v1/findings",
      method: "POST",
      body: {
        title: "Repository path traversal permits file disclosure",
        primaryAssetId: "00000000-0000-4000-8000-000000000002",
      },
    });
    expect(requestAt(fetch, 1)).toMatchObject({
      method: "PATCH",
      body: {
        technicalMarkdown: "The path is joined before validation.",
        cweIds: ["CWE-22"],
        expectedRevision: 1,
      },
    });
    expect(requestAt(fetch, 2).url).toMatch(/\/assets$/u);
    expect(requestAt(fetch, 3).url).toMatch(/\/affected-ranges$/u);
  });
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function finding(revision: number): Record<string, unknown> {
  return {
    id: "00000000-0000-4000-8000-000000000004",
    revision,
  };
}

function requestAt(
  fetch: ReturnType<typeof vi.fn<typeof globalThis.fetch>>,
  index: number,
): { url: string; method: string; body: Record<string, unknown> } {
  const call = fetch.mock.calls[index];
  if (call === undefined) throw new Error("Missing fetch call.");
  const [url, init] = call;
  return {
    url: String(url),
    method: init?.method ?? "GET",
    body:
      typeof init?.body === "string"
        ? (JSON.parse(init.body) as Record<string, unknown>)
        : {},
  };
}
