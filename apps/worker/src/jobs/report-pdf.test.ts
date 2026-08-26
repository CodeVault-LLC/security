import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { markdownReportOutput } from "./report-pdf.js";

describe("Markdown report output", () => {
  it("encodes UTF-8 bytes with an artifact digest and Markdown metadata", () => {
    const markdown = "# Advisory\n\nAffected component: café.\n";
    const output = markdownReportOutput(markdown);

    expect(new TextDecoder().decode(output.bytes)).toBe(markdown);
    expect(output.mimeType).toBe("text/markdown; charset=utf-8");
    expect(output.extension).toBe("md");
    expect(output.sha256).toBe(
      createHash("sha256").update(markdown, "utf8").digest("hex"),
    );
  });
});
