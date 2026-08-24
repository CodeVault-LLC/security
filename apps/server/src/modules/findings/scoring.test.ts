import { describe, expect, it } from "vitest";

import { computeScore, normaliseScoreSubmission } from "./scoring.js";

const CWSS_VECTOR =
  "(TI:H,0.9/AP:A,1.0/AL:A,1.0/IC:N,1.0/FC:T,1.0/RP:L,0.9/RL:A,1.0/AV:I,1.0/AS:N,1.0/IN:T,0.9/SC:A,1.0/BI:C,1.0/DI:H,1.0/EX:H,1.0/EC:N,1.0/P:NA,1.0)";

describe("alternative finding scoring", () => {
  it("computes CWSS without assigning a CVSS severity", () => {
    const result = computeScore("CWSS10", CWSS_VECTOR);

    expect(result.score).toBe(92.6);
    expect(result.severity).toBeNull();
    expect(result.metrics.scale).toBe(100);
  });

  it("computes OWASP and SSVC categorical outcomes", () => {
    const owasp = computeScore(
      "OWASP_RR",
      "OWASP-RR:1.0/SL:AU/M:P/O:A/SZ:D/ED:D/EE:E/AW:P/ID:A/LC:A/LI:EC/LA:MP/LAC:P",
    );
    const ssvc = computeScore(
      "SSVC",
      "SSVCv2/COORDINATOR-PUBLISH/SI:U/E:P/VA:A",
    );

    expect(owasp).toMatchObject({ score: null, severity: null });
    expect(owasp.metrics.rating).toBe("HIGH");
    expect(ssvc.metrics.decision).toBe("PUBLISH");
  });

  it("retains EVSS only as sourced external intelligence", () => {
    expect(
      normaliseScoreSubmission({
        scheme: "EVSS",
        score: 8.6,
        sourceName: "Edgescan assessment 2026-08-24",
      }),
    ).toMatchObject({
      scheme: "EVSS",
      score: 8.6,
      severity: null,
      sourceName: "Edgescan assessment 2026-08-24",
    });

    expect(() =>
      normaliseScoreSubmission({ scheme: "EVSS", score: 8.6 }),
    ).toThrow(/must name its source/);
    expect(() =>
      normaliseScoreSubmission({
        scheme: "EVSS",
        score: 8.6,
        sourceName: "   ",
      }),
    ).toThrow(/must name its source/);
    expect(() =>
      normaliseScoreSubmission({
        scheme: "EVSS",
        score: 11,
        sourceName: "Edgescan",
      }),
    ).toThrow(/0 to 10/);
    expect(
      normaliseScoreSubmission({
        scheme: "EVSS",
        score: 8.6,
        sourceName: "  Edgescan  ",
      }).sourceName,
    ).toBe("Edgescan");
  });

  it("does not mislabel custom scales with CVSS severity bands", () => {
    expect(
      normaliseScoreSubmission({ scheme: "CUSTOM", score: 75 }),
    ).toMatchObject({
      score: 75,
      severity: null,
    });
  });
});
