import { describe, expect, it } from "vitest";

import { parseInboundMessage, sanitiseEmailHtml } from "./inbound-message.js";

const htmlMessage = new TextEncoder().encode(
  [
    "From: Vendor <security@vendor.test>",
    "To: Researcher <researcher@example.test>",
    "Subject: Formatted update",
    "Message-ID: <formatted@example.test>",
    "Content-Type: text/html; charset=utf-8",
    "",
    '<h2>Fix ready</h2><p>Install <strong>2.4.1</strong>.</p><script>steal()</script><img src="https://tracker.invalid/pixel"><a href="javascript:alert(1)">bad link</a>',
  ].join("\r\n"),
);

describe("inbound HTML email", () => {
  it("keeps useful formatting while removing executable and remote content", () => {
    const html = sanitiseEmailHtml(
      '<table><tr><td style="background:url(https://tracker.invalid)">Ready</td></tr></table><iframe src="https://attacker.invalid"></iframe><a href="https://vendor.test/fix">Advisory</a>',
    );

    expect(html).toContain("<table>");
    expect(html).toContain('href="https://vendor.test/fix"');
    expect(html).not.toContain("style=");
    expect(html).not.toContain("iframe");
    expect(html).not.toContain("tracker.invalid");
    expect(html).not.toContain("attacker.invalid");
  });

  it("returns sanitized HTML only when organization policy allows it", async () => {
    const allowed = await parseInboundMessage(htmlMessage, {
      providerMessageId: "formatted",
      includeHtml: true,
    });
    const blocked = await parseInboundMessage(htmlMessage, {
      providerMessageId: "formatted",
      includeHtml: false,
    });

    expect(allowed.bodyText).toContain("FIX READY");
    expect(allowed.bodyHtml).toContain("<strong>2.4.1</strong>");
    expect(allowed.bodyHtml).not.toContain("script");
    expect(allowed.bodyHtml).not.toContain("tracker.invalid");
    expect(allowed.bodyHtml).not.toContain("javascript:");
    expect(blocked.bodyHtml).toBeNull();
  });
});
