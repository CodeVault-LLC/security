import { describe, expect, it } from "vitest";

import {
  applyResolvedDirectiveText,
  applyResolvedDirectives,
  isKnownDirectiveKind,
  parseDirectives,
  placeholderFor,
  resolveDirectives,
  type DirectiveResolver,
} from "./directives.js";

/**
 * Directive resolution.
 *
 * Two properties matter. An unknown or unresolvable directive must never
 * disappear silently — a report with a hole where a figure should be is worse
 * than one that says so. And a directive pointing at content the audience may
 * not see must be refused, not quietly filtered.
 */

const RESOLVER: DirectiveResolver = {
  async resolve(kind, argument) {
    if (argument === "EVID-000404") {
      return null;
    }

    const visibility =
      argument === "EVID-000001"
        ? "INTERNAL"
        : argument === "EVID-000002"
          ? "VENDOR"
          : "PUBLIC";

    return {
      kind,
      argument,
      visibility,
      html: `<div class="cv-evidence">${argument}</div>`,
      text: argument,
    };
  },
};

describe("parseDirectives", () => {
  it("finds directives with an argument", () => {
    const directives = parseDirectives(
      "See [evidence:EVID-000123] and [asset:AST-000001].",
    );

    expect(directives.map((item) => item.kind)).toEqual(["evidence", "asset"]);
    expect(directives[0]?.argument).toBe("EVID-000123");
  });

  it("finds a bare directive", () => {
    const directives = parseDirectives("## Timeline\n\n[disclosure-timeline]");

    expect(directives[0]?.kind).toBe("disclosure-timeline");
    expect(directives[0]?.argument).toBe("");
  });

  it("ignores ordinary Markdown links", () => {
    expect(parseDirectives("[the advisory](https://example.com)")).toHaveLength(
      0,
    );
  });

  it("ignores directive-shaped reference link text", () => {
    expect(
      parseDirectives(
        "See [evidence:EVID-000123][capture].\n\n[capture]: https://example.com",
      ),
    ).toHaveLength(0);
  });

  it("ignores directive-shaped text inside inline code", () => {
    expect(
      parseDirectives("Run `[asset:AST-000001]` to illustrate the syntax."),
    ).toHaveLength(0);
  });

  it("ignores a backslash-escaped directive", () => {
    expect(parseDirectives("Literal \\[asset:AST-000001].")).toHaveLength(0);
  });

  it("ignores directive-shaped text inside fenced code", () => {
    expect(
      parseDirectives(
        ["```text", "[asset:AST-000001]", "```", "[finding:FIND-1]"].join("\n"),
      ).map((item) => item.raw),
    ).toEqual(["[finding:FIND-1]"]);
  });

  it("ignores directive-shaped text inside indented code", () => {
    expect(
      parseDirectives(
        "Example:\n\n    [asset:AST-000001]\n\t[evidence:EVID-1]",
      ),
    ).toHaveLength(0);
  });

  it("ignores directives inside HTML comments", () => {
    expect(
      parseDirectives("<!-- [evidence:EVID-000001] -->\n[finding:FIND-1]").map(
        (item) => item.raw,
      ),
    ).toEqual(["[finding:FIND-1]"]);
  });

  it("handles long unmatched link and code delimiters in linear time", () => {
    const markdown = `${"[".repeat(50_000)}${"`".repeat(50_000)}\n[finding:FIND-1]`;

    expect(parseDirectives(markdown).at(-1)?.raw).toBe("[finding:FIND-1]");
  });

  it("records the line so a lint message can point at it", () => {
    const directives = parseDirectives("line one\nline two\n[evidence:EVID-1]");

    expect(directives[0]?.line).toBe(3);
  });

  it("counts carriage-return line endings without double-counting CRLF", () => {
    expect(parseDirectives("one\rtwo\r[evidence:EVID-1]")[0]?.line).toBe(3);
    expect(parseDirectives("one\r\ntwo\r\n[evidence:EVID-1]")[0]?.line).toBe(3);
  });

  it("recognises exactly the known kinds", () => {
    expect(isKnownDirectiveKind("evidence")).toBe(true);
    expect(isKnownDirectiveKind("score")).toBe(true);
    expect(isKnownDirectiveKind("exec")).toBe(false);
    expect(isKnownDirectiveKind("include")).toBe(false);
  });
});

describe("resolveDirectives", () => {
  it("replaces resolved directives with placeholders", async () => {
    const result = await resolveDirectives(
      "Before [evidence:EVID-000003] after.",
      "PUBLIC",
      RESOLVER,
    );

    expect(result.markdown).toBe(`Before ${placeholderFor(0)} after.`);
    expect(result.errors).toHaveLength(0);
    expect(result.resolved).toHaveLength(1);
  });

  it("reports an unknown directive rather than dropping it", async () => {
    const result = await resolveDirectives(
      "[shell:whoami] and [evidence:EVID-000003]",
      "PUBLIC",
      RESOLVER,
    );

    expect(result.errors[0]?.reason).toBe("UNKNOWN_DIRECTIVE");
    expect(result.errors[0]?.message).toContain("[shell:whoami]");
  });

  it("reports an unknown bare directive", async () => {
    const result = await resolveDirectives("[timeline]", "PUBLIC", RESOLVER);

    expect(result.errors[0]?.reason).toBe("UNKNOWN_DIRECTIVE");
  });

  it("reports a directive that resolves to nothing", async () => {
    const result = await resolveDirectives(
      "[evidence:EVID-000404]",
      "INTERNAL",
      RESOLVER,
    );

    expect(result.errors[0]?.reason).toBe("NOT_FOUND");
  });

  it("refuses internal evidence in a public report", async () => {
    const result = await resolveDirectives(
      "[evidence:EVID-000001]",
      "PUBLIC",
      RESOLVER,
    );

    expect(result.errors[0]?.reason).toBe("VISIBILITY_DENIED");
    expect(result.errors[0]?.message).toContain("INTERNAL");
    expect(result.resolved).toHaveLength(0);
  });

  it("refuses internal evidence in a vendor report", async () => {
    const result = await resolveDirectives(
      "[evidence:EVID-000001]",
      "VENDOR",
      RESOLVER,
    );

    expect(result.errors[0]?.reason).toBe("VISIBILITY_DENIED");
  });

  it("allows vendor evidence in a vendor report", async () => {
    const result = await resolveDirectives(
      "[evidence:EVID-000002]",
      "VENDOR",
      RESOLVER,
    );

    expect(result.errors).toHaveLength(0);
    expect(result.resolved).toHaveLength(1);
  });

  it("refuses vendor evidence in a public report", async () => {
    const result = await resolveDirectives(
      "[evidence:EVID-000002]",
      "PUBLIC",
      RESOLVER,
    );

    expect(result.errors[0]?.reason).toBe("VISIBILITY_DENIED");
  });

  it("allows everything in an internal report", async () => {
    const result = await resolveDirectives(
      "[evidence:EVID-000001] [evidence:EVID-000002] [evidence:EVID-000003]",
      "INTERNAL",
      RESOLVER,
    );

    expect(result.errors).toHaveLength(0);
    expect(result.resolved).toHaveLength(3);
  });

  it("resolves a repeated directive only once per render", async () => {
    let calls = 0;
    const counting: DirectiveResolver = {
      async resolve(kind, argument) {
        calls += 1;
        return RESOLVER.resolve(kind, argument);
      },
    };

    const result = await resolveDirectives(
      "[evidence:EVID-000003] then [evidence:EVID-000003]",
      "PUBLIC",
      counting,
    );

    expect(calls).toBe(1);
    expect(result.resolved).toHaveLength(2);
  });

  it("survives a resolver that throws", async () => {
    const throwing: DirectiveResolver = {
      async resolve() {
        throw new Error("database is down");
      },
    };

    const result = await resolveDirectives(
      "[evidence:EVID-1]",
      "INTERNAL",
      throwing,
    );

    expect(result.errors[0]?.reason).toBe("RESOLVER_FAILED");
  });
});

describe("applyResolvedDirectives", () => {
  it("substitutes generated HTML back in after sanitisation", async () => {
    const resolution = await resolveDirectives(
      "Figure: [evidence:EVID-000003]",
      "PUBLIC",
      RESOLVER,
    );

    const html = applyResolvedDirectives(
      `<p>Figure: ${placeholderFor(0)}</p>`,
      resolution.substitutions,
    );

    expect(html).toContain('<div class="cv-evidence">EVID-000003</div>');
    expect(html).not.toContain(placeholderFor(0));
  });

  it("substitutes a visible error for a directive that was refused", async () => {
    const resolution = await resolveDirectives(
      "[evidence:EVID-000001]",
      "PUBLIC",
      RESOLVER,
    );

    const html = applyResolvedDirectives(
      `<p>${placeholderFor(0)}</p>`,
      resolution.substitutions,
    );

    expect(html).toContain("cv-directive-error");
    expect(html).toContain("cannot appear in a PUBLIC report");
    // The identifier of internal evidence never reaches a public rendering.
    expect(html).not.toContain("EVID-000001");
  });

  it("leaves no placeholder behind for any directive", async () => {
    const resolution = await resolveDirectives(
      "[evidence:EVID-000003] [evidence:EVID-000404] [nonsense:X]",
      "PUBLIC",
      RESOLVER,
    );

    const html = applyResolvedDirectives(
      resolution.markdown,
      resolution.substitutions,
    );

    expect(html).not.toContain("cvdirective");
  });

  it("does not replace literal text that resembles a placeholder", async () => {
    const resolution = await resolveDirectives(
      "Literal cvdirective0x then [evidence:EVID-000003]",
      "PUBLIC",
      RESOLVER,
    );

    const html = applyResolvedDirectives(
      resolution.markdown,
      resolution.substitutions,
    );

    expect(html).toContain("Literal cvdirective0x then");
    expect(html.match(/cv-evidence/g)).toHaveLength(1);
  });
});

describe("applyResolvedDirectiveText", () => {
  it("substitutes portable text into Markdown without leaking placeholders", async () => {
    const resolution = await resolveDirectives(
      "Evidence: [evidence:EVID-000003]",
      "PUBLIC",
      RESOLVER,
    );

    expect(
      applyResolvedDirectiveText(resolution.markdown, resolution.substitutions),
    ).toBe("Evidence: EVID-000003");
  });
});
