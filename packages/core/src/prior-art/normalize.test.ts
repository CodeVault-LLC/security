import { describe, expect, it } from "vitest";

import {
  normalizeIdentity,
  normalizeName,
  parseCpe23,
  parsePurl,
  titleSimilarity,
} from "./normalize.js";

describe("normalizeName", () => {
  it("collapses punctuation and casing", () => {
    expect(normalizeName("Hummingbird-Performance")).toBe(
      "hummingbird performance",
    );
    expect(normalizeName("wp_smush.it")).toBe("wp smush it");
  });

  it("drops noise words that never distinguish products", () => {
    expect(normalizeName("Foo Plugin for WordPress")).toBe("foo");
    expect(normalizeName("Acme Corp Software")).toBe("acme");
  });
});

describe("parsePurl", () => {
  it("parses a namespaced package with a version", () => {
    expect(parsePurl("pkg:npm/@scope/name@1.2.3")).toEqual({
      type: "npm",
      namespace: "@scope",
      name: "name",
      version: "1.2.3",
    });
  });

  it("parses a package without a version", () => {
    expect(parsePurl("pkg:wordpress/hummingbird-performance")).toEqual({
      type: "wordpress",
      namespace: null,
      name: "hummingbird-performance",
      version: null,
    });
  });

  it("ignores qualifiers", () => {
    expect(parsePurl("pkg:deb/debian/curl@7.50.3?arch=i386")?.name).toBe("curl");
  });

  it("rejects non-PURL input", () => {
    expect(parsePurl("https://example.com")).toBeNull();
    expect(parsePurl("pkg:npm")).toBeNull();
  });
});

describe("parseCpe23", () => {
  it("parses a formatted CPE string", () => {
    expect(parseCpe23("cpe:2.3:a:acme:widget:1.0:*:*:*:*:*:*:*")).toEqual({
      part: "a",
      vendor: "acme",
      product: "widget",
      version: "1.0",
    });
  });

  it("rejects CPE 2.2 URIs and junk", () => {
    expect(parseCpe23("cpe:/a:acme:widget:1.0")).toBeNull();
    expect(parseCpe23("acme widget")).toBeNull();
  });
});

describe("normalizeIdentity", () => {
  it("prefers a PURL over the display name", () => {
    const identity = normalizeIdentity({
      name: "Hummingbird Performance Plugin",
      vendor: "WPMU DEV",
      identifiers: [
        { scheme: "PURL", value: "pkg:wordpress/hummingbird-performance" },
      ],
    });

    expect(identity).toEqual({
      vendor: "wpmu dev",
      product: "hummingbird performance",
      ecosystem: "wordpress",
      packageName: "hummingbird-performance",
    });
  });

  it("falls back to a CPE when no PURL exists", () => {
    const identity = normalizeIdentity({
      name: "Widget",
      identifiers: [
        { scheme: "CPE23", value: "cpe:2.3:a:acme:widget:1.0:*:*:*:*:*:*:*" },
      ],
    });

    expect(identity.vendor).toBe("acme");
    expect(identity.product).toBe("widget");
    expect(identity.ecosystem).toBeNull();
  });

  it("works from free text alone", () => {
    const identity = normalizeIdentity({ name: "Acme Router RT-1200" });

    expect(identity.product).toBe("acme router rt 1200");
    expect(identity.packageName).toBeNull();
  });
});

describe("titleSimilarity", () => {
  it("scores identical titles as 1", () => {
    expect(titleSimilarity("SQL injection in login", "SQL injection in login"))
      .toBe(1);
  });

  it("scores unrelated titles at zero", () => {
    expect(titleSimilarity("SQL injection", "Firmware signature bypass")).toBe(
      0,
    );
  });

  it("scores partial overlap between the extremes", () => {
    const score = titleSimilarity(
      "Unauthenticated SQL injection in export endpoint",
      "SQL injection in export handler",
    );

    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThan(1);
  });
});
