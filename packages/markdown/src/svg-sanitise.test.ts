/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from "vitest";

import {
  sanitiseSvgElement,
  SVG_POLICY,
  type SvgPolicy,
} from "./svg-sanitise.js";

/**
 * SVG sanitisation.
 *
 * Mermaid renders node labels taken from a finding's diagram source, so its
 * output carries attacker-influenced text into an SVG that this application
 * then inserts into a live document. These are the payloads that would matter
 * if mermaid's own escaping were bypassed or regressed.
 */

function parse(markup: string): Element {
  const parsed = new DOMParser().parseFromString(markup, "image/svg+xml");

  return parsed.documentElement;
}

function sanitise(markup: string): Element | null {
  return sanitiseSvgElement(parse(markup), SVG_POLICY);
}

const OPEN = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">';

describe("structure", () => {
  it("keeps ordinary drawing elements", async () => {
    const result = sanitise(
      `${OPEN}<g><rect x="1" y="1" width="4" height="4" fill="#eee"/><text x="2" y="3">GET /admin</text></g></svg>`,
    );

    expect(result?.querySelector("rect")).not.toBeNull();
    expect(result?.querySelector("text")?.textContent).toBe("GET /admin");
  });

  it("rejects a fragment that is not an SVG", () => {
    const div = document.createElement("div");

    expect(sanitiseSvgElement(div, SVG_POLICY)).toBeNull();
  });

  it("removes script elements", () => {
    const result = sanitise(`${OPEN}<script>alert(1)</script><rect/></svg>`);

    expect(result?.querySelector("script")).toBeNull();
    expect(result?.querySelector("rect")).not.toBeNull();
  });

  /**
   * `foreignObject` embeds arbitrary HTML inside an SVG. It is the standard
   * way an SVG-only allow-list is defeated, and mermaid uses it for HTML
   * labels — which is why the mermaid config disables them.
   */
  it("removes foreignObject and everything inside it", () => {
    const result = sanitise(
      `${OPEN}<foreignObject><body xmlns="http://www.w3.org/1999/xhtml"><img src="x"/></body></foreignObject></svg>`,
    );

    expect(result?.querySelector("foreignObject")).toBeNull();
    expect(result?.querySelector("img")).toBeNull();
  });

  it("removes image elements, which would fetch", () => {
    const result = sanitise(
      `${OPEN}<image href="https://example.test/x.png"/></svg>`,
    );

    expect(result?.querySelector("image")).toBeNull();
  });

  it("removes animation elements", () => {
    const result = sanitise(
      `${OPEN}<animate attributeName="x" to="1"/><set attributeName="y" to="2"/></svg>`,
    );

    expect(result?.querySelector("animate")).toBeNull();
    expect(result?.querySelector("set")).toBeNull();
  });
});

describe("attributes", () => {
  it("removes every event handler", () => {
    const result = sanitise(
      `${OPEN.replace(">", ' onload="alert(1)">')}<rect onclick="alert(2)" onmouseover="alert(3)"/></svg>`,
    );

    expect(result?.getAttribute("onload")).toBeNull();
    expect(result?.querySelector("rect")?.getAttribute("onclick")).toBeNull();
    expect(
      result?.querySelector("rect")?.getAttribute("onmouseover"),
    ).toBeNull();
  });

  it("removes attributes that are not on the allow-list", () => {
    const result = sanitise(
      `${OPEN}<rect requiredExtensions="evil" fill="#eee"/></svg>`,
    );

    const rect = result?.querySelector("rect");

    expect(rect?.getAttribute("requiredExtensions")).toBeNull();
    expect(rect?.getAttribute("fill")).toBe("#eee");
  });

  it("keeps same-document references, which arrowheads need", () => {
    const result = sanitise(
      `${OPEN}<path d="M0 0" marker-end="url(#arrow)"/><use href="#shape"/></svg>`,
    );

    expect(result?.querySelector("path")?.getAttribute("marker-end")).toBe(
      "url(#arrow)",
    );
    expect(result?.querySelector("use")?.getAttribute("href")).toBe("#shape");
  });

  it("removes references that point anywhere else", () => {
    const result = sanitise(
      `${OPEN}<use href="https://example.test/x.svg#a"/><path marker-end="url(https://example.test/m.svg#a)"/></svg>`,
    );

    expect(result?.querySelector("use")?.getAttribute("href")).toBeNull();
    expect(
      result?.querySelector("path")?.getAttribute("marker-end"),
    ).toBeNull();
  });

  it("removes a javascript: reference", () => {
    const result = sanitise(`${OPEN}<use href="javascript:alert(1)"/></svg>`);

    expect(result?.querySelector("use")?.getAttribute("href")).toBeNull();
  });
});

describe("styles", () => {
  it("keeps ordinary inline style", () => {
    const result = sanitise(
      `${OPEN}<rect style="fill:#eee;stroke:#333"/></svg>`,
    );

    expect(result?.querySelector("rect")?.getAttribute("style")).toBe(
      "fill:#eee;stroke:#333",
    );
  });

  /**
   * Every arrowhead, gradient and clip path in a mermaid diagram is attached
   * through a `url(#...)` in its own CSS. Rejecting those outright is what
   * turns a rendered diagram into a row of black boxes.
   */
  it("keeps a same-document url() reference in CSS", () => {
    const css = "#cv-1 .flowchart-link{marker-end:url(#arrowhead);fill:none}";
    const result = sanitise(`${OPEN}<style>${css}</style><rect/></svg>`);

    expect(result?.querySelector("style")?.textContent).toBe(css);
  });

  it("keeps a quoted same-document url() reference", () => {
    const result = sanitise(`${OPEN}<rect style="fill:url('#grad')"/></svg>`);

    expect(result?.querySelector("rect")?.getAttribute("style")).toBe(
      "fill:url('#grad')",
    );
  });

  it("removes CSS mixing a safe reference with a remote one", () => {
    const result = sanitise(
      `${OPEN}<style>.a{marker-end:url(#arrow)}.b{fill:url(https://example.test/t.png)}</style></svg>`,
    );

    expect(result?.querySelector("style")?.textContent).toBe("");
  });

  /**
   * A `url()` pointing off the document fetches. An embargoed report that
   * fetches anything when it is opened has told someone that it was opened.
   */
  it("removes inline style that would fetch", () => {
    const result = sanitise(
      `${OPEN}<rect style="fill:url(https://example.test/t.png)"/></svg>`,
    );

    expect(result?.querySelector("rect")?.getAttribute("style")).toBeNull();
  });

  it("empties a style element that imports a remote stylesheet", () => {
    const result = sanitise(
      `${OPEN}<style>@import url("https://example.test/x.css");</style><rect/></svg>`,
    );

    expect(result?.querySelector("style")?.textContent).toBe("");
  });

  it("keeps a style element mermaid generated for its own theme", () => {
    const css = "#cv-1 .node rect{fill:#eee;stroke:#333}";
    const result = sanitise(`${OPEN}<style>${css}</style><rect/></svg>`);

    expect(result?.querySelector("style")?.textContent).toBe(css);
  });

  it("empties a style element containing a legacy expression", () => {
    const result = sanitise(
      `${OPEN}<style>rect{width:expression(alert(1))}</style></svg>`,
    );

    expect(result?.querySelector("style")?.textContent).toBe("");
  });
});

/**
 * Self-containment.
 *
 * The PDF worker injects this function's source into a Chromium page, where
 * module scope does not exist. Rebuilding it from its own source text and
 * running it is the only way to keep that contract from quietly breaking the
 * next time someone adds a helpful import.
 */
describe("injectability", () => {
  it("works when rebuilt from its own source text", () => {
    const rebuilt = new Function(
      `return (${sanitiseSvgElement.toString()});`,
    )() as (root: Element, policy: SvgPolicy) => Element | null;

    const result = rebuilt(
      parse(
        `${OPEN}<script>alert(1)</script><rect fill="#eee" onclick="x"/></svg>`,
      ),
      SVG_POLICY,
    );

    expect(result?.querySelector("script")).toBeNull();
    expect(result?.querySelector("rect")?.getAttribute("onclick")).toBeNull();
    expect(result?.querySelector("rect")?.getAttribute("fill")).toBe("#eee");
  });
});
