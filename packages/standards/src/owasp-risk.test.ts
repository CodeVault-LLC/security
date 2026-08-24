import { describe, expect, it } from "vitest";

import { calculateOwaspRisk } from "./owasp-risk.js";

describe("OWASP Risk Rating", () => {
  it("uses technical impact when business impact is not assessed", () => {
    const result = calculateOwaspRisk(
      "OWASP-RR:1.0/SL:AU/M:P/O:A/SZ:D/ED:D/EE:E/AW:P/ID:A/LC:A/LI:EC/LA:MP/LAC:P",
    );

    expect(result.likelihood).toBe(4.5);
    expect(result.technicalImpact).toBe(7);
    expect(result.impactBasis).toBe("TECHNICAL");
    expect(result.rating).toBe("HIGH");
  });

  it("prefers complete business-impact information", () => {
    const result = calculateOwaspRisk(
      "OWASP-RR:1.0/SL:AU/M:P/O:A/SZ:D/ED:D/EE:E/AW:P/ID:A/LC:A/LI:EC/LA:MP/LAC:P/FD:L/RD:M/NC:M/PV:H",
    );

    expect(result.businessImpact).toBe(2.25);
    expect(result.impactBasis).toBe("BUSINESS");
    expect(result.rating).toBe("LOW");
  });

  it("rejects partial business-impact groups", () => {
    expect(() =>
      calculateOwaspRisk(
        "OWASP-RR:1.0/SL:AU/M:P/O:A/SZ:D/ED:D/EE:E/AW:P/ID:A/LC:A/LI:EC/LA:MP/LAC:P/FD:L",
      ),
    ).toThrow(/supplied together/);
  });
});
