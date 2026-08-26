import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { previewFolder } from "./folder.js";

describe("previewFolder", () => {
  it("maps Markdown, JSON, CSV, and attachments without claiming canonical truth", async () => {
    const root = await mkdtemp(join(tmpdir(), "codevault-folder-"));
    await mkdir(join(root, "captures"));
    await writeFile(
      join(root, "finding.md"),
      [
        "---",
        "title: Header injection in export",
        "cwe: CWE-113",
        "---",
        "# Header injection in export",
        "",
        "Untrusted input reaches a response header.",
      ].join("\n"),
    );
    await writeFile(
      join(root, "findings.json"),
      JSON.stringify([
        {
          title: "Path traversal in archive import",
          summary: "A crafted archive entry escapes the destination.",
          cweIds: ["CWE-22"],
        },
      ]),
    );
    await writeFile(
      join(root, "findings.csv"),
      [
        "title,summary,cwe",
        '"CSV formula injection in export","Cells begin with executable formula characters",CWE-1236',
      ].join("\n"),
    );
    await writeFile(join(root, "captures", "request.bin"), "request bytes");

    const preview = await previewFolder(root);

    expect(preview.candidates.map((item) => item.draft.title)).toEqual([
      "Header injection in export",
      "CSV formula injection in export",
      "Path traversal in archive import",
    ]);
    expect(preview.attachments).toMatchObject([
      {
        relativePath: "captures/request.bin",
        duplicateOf: null,
      },
    ]);
    expect(preview.candidates.every((item) => item.status === "READY")).toBe(
      true,
    );
    expect(preview.totalBytes).toBeGreaterThan(0);
  });

  it("marks digest and title duplicates before acceptance", async () => {
    const root = await mkdtemp(join(tmpdir(), "codevault-folder-"));
    const content = "# Repeated finding title\n\nRepeated body.";
    await writeFile(join(root, "a.md"), content);
    await writeFile(join(root, "b.md"), content);

    const preview = await previewFolder(root, {
      existingTitles: ["Repeated finding title"],
    });

    expect(preview.candidates).toHaveLength(2);
    expect(preview.candidates[0]?.duplicateReasons).toContain(
      "A finding with this normalized title already exists in the case.",
    );
    expect(preview.candidates[1]?.duplicateReasons).toContain(
      "Another selected file has the same SHA-256 digest.",
    );
    expect(
      preview.candidates.every((item) => item.status === "DUPLICATE"),
    ).toBe(true);
  });

  it("marks repeated titles within the selected folder as duplicates", async () => {
    const root = await mkdtemp(join(tmpdir(), "codevault-folder-"));
    await writeFile(
      join(root, "a.md"),
      "# Repeated finding title\n\nFirst body.",
    );
    await writeFile(
      join(root, "b.md"),
      "# Repeated finding title\n\nDifferent body.",
    );

    const preview = await previewFolder(root);

    expect(preview.candidates[0]?.status).toBe("READY");
    expect(preview.candidates[1]?.status).toBe("DUPLICATE");
    expect(preview.candidates[1]?.duplicateReasons).toContain(
      "Another selected finding has the same normalized title.",
    );
  });

  it("reports mapping errors without dropping the original file", async () => {
    const root = await mkdtemp(join(tmpdir(), "codevault-folder-"));
    await writeFile(join(root, "broken.json"), "{ definitely not json");

    const preview = await previewFolder(root);

    expect(preview.candidates).toEqual([]);
    expect(preview.files).toMatchObject([
      {
        relativePath: "broken.json",
        disposition: "MAPPING_ERROR",
      },
    ]);
    expect(preview.errors[0]).toContain("broken.json");
  });

  it("reports a mapped draft that cannot pass the intake contract", async () => {
    const root = await mkdtemp(join(tmpdir(), "codevault-folder-"));
    await writeFile(join(root, "short.md"), "# Short\n\nBody");

    const preview = await previewFolder(root);

    expect(preview.candidates).toEqual([]);
    expect(preview.files[0]?.disposition).toBe("MAPPING_ERROR");
    expect(preview.errors[0]).toContain("8 to 200 characters");
  });
});
