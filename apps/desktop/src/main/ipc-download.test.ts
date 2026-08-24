import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { downloadVerifiedFile } from "./artifact-download.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("verified native downloads", () => {
  it("saves bytes from an HTTP object-storage URL after digest verification", async () => {
    const bytes = new TextEncoder().encode("verified report pdf");
    const expectedSha256 = createHash("sha256").update(bytes).digest("hex");
    const directory = await mkdtemp(join(tmpdir(), "codevault-download-test-"));
    temporaryDirectories.push(directory);
    const destination = join(directory, "report.pdf");
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(bytes));

    await downloadVerifiedFile(
      "http://127.0.0.1:9000/codevault/report.pdf",
      destination,
      expectedSha256,
      fetchImpl,
    );

    expect(await readFile(destination)).toEqual(Buffer.from(bytes));
  });

  it("removes a download whose digest does not match", async () => {
    const directory = await mkdtemp(join(tmpdir(), "codevault-download-test-"));
    temporaryDirectories.push(directory);
    const destination = join(directory, "report.pdf");
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      Promise.resolve(new Response("tampered bytes")),
    );

    await expect(
      downloadVerifiedFile(
        "http://127.0.0.1:9000/codevault/report.pdf",
        destination,
        "a".repeat(64),
        fetchImpl,
      ),
    ).rejects.toThrow("failed verification");
    await expect(readFile(destination)).rejects.toMatchObject({
      code: "ENOENT",
    });
  });
});
