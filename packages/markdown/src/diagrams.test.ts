/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi } from "vitest";

import {
  DIAGRAM_ATTRIBUTE,
  DIAGRAM_CLASS,
  DIAGRAM_SOURCE_CLASS,
} from "./diagram-fence.js";
import { hydrateDiagramsIn, type DiagramRenderer } from "./diagrams.js";
import { renderMarkdown } from "./pipeline.js";
import { sanitiseSvgElement, SVG_POLICY } from "./svg-sanitise.js";

/**
 * Diagram hydration.
 *
 * Mermaid itself is not exercised here: it needs layout APIs jsdom does not
 * implement, and what this module owns is the surrounding contract — what gets
 * drawn, what happens when drawing fails, and that nothing reaches the
 * document without passing the sanitiser.
 */

const SVG = '<svg xmlns="http://www.w3.org/2000/svg"><rect fill="#eee"/></svg>';

function stub(svg = SVG): DiagramRenderer {
  return vi.fn(() => Promise.resolve({ svg }));
}

function dependencies(render: DiagramRenderer) {
  return { render, sanitise: sanitiseSvgElement, policy: SVG_POLICY };
}

async function mount(markdown: string): Promise<HTMLElement> {
  const host = document.createElement("div");

  host.innerHTML = await renderMarkdown(markdown);
  document.body.append(host);

  return host;
}

const DIAGRAM = "```mermaid\ngraph TD;\nA-->B;\n```";

describe("hydration", () => {
  it("replaces the source block with the rendered diagram", async () => {
    const host = await mount(DIAGRAM);
    const result = await hydrateDiagramsIn(host, dependencies(stub()));

    expect(result).toEqual({ rendered: 1, failed: 0 });
    expect(host.querySelector("svg")).not.toBeNull();
    expect(host.querySelector(`.${DIAGRAM_SOURCE_CLASS}`)).toBeNull();
  });

  it("passes the fence's source to the renderer", async () => {
    const host = await mount(DIAGRAM);
    const render = stub();

    await hydrateDiagramsIn(host, dependencies(render));

    expect(render).toHaveBeenCalledWith(
      expect.any(String),
      expect.stringContaining("A-->B;"),
    );
  });

  /**
   * A React effect in the preview pane runs twice under StrictMode, and the
   * user can also re-render while a diagram is still drawing.
   */
  it("does not draw the same diagram twice", async () => {
    const host = await mount(DIAGRAM);
    const render = stub();

    await hydrateDiagramsIn(host, dependencies(render));
    const second = await hydrateDiagramsIn(host, dependencies(render));

    expect(second).toEqual({ rendered: 0, failed: 0 });
    expect(render).toHaveBeenCalledTimes(1);
    expect(host.querySelectorAll("svg")).toHaveLength(1);
  });

  it("draws every diagram in a document", async () => {
    const host = await mount(`${DIAGRAM}\n\ntext\n\n${DIAGRAM}`);
    const result = await hydrateDiagramsIn(host, dependencies(stub()));

    expect(result.rendered).toBe(2);
    expect(host.querySelectorAll("svg")).toHaveLength(2);
  });

  it("ignores a fence with no source", async () => {
    const host = await mount("```mermaid\n```");
    const render = stub();

    await hydrateDiagramsIn(host, dependencies(render));

    expect(render).not.toHaveBeenCalled();
  });
});

describe("failure", () => {
  /**
   * The rule the whole feature follows: a reader must be able to see that
   * something was meant to be here. A blank frame in a report sent to a vendor
   * is worse than a visible error next to the source that produced it.
   */
  it("keeps the source visible and explains itself", async () => {
    const host = await mount(DIAGRAM);
    const render: DiagramRenderer = () =>
      Promise.reject(new Error("Parse error on line 2"));

    const result = await hydrateDiagramsIn(host, dependencies(render));

    expect(result).toEqual({ rendered: 0, failed: 1 });
    expect(host.querySelector(`.${DIAGRAM_SOURCE_CLASS}`)).not.toBeNull();
    expect(host.querySelector(".cv-diagram-error")?.textContent).toContain(
      "Parse error on line 2",
    );
  });

  it("rejects a renderer that returns something other than an SVG", async () => {
    const host = await mount(DIAGRAM);
    const result = await hydrateDiagramsIn(
      host,
      dependencies(stub("<div>not a diagram</div>")),
    );

    expect(result.failed).toBe(1);
    expect(host.querySelector("div.cv-diagram > div")).toBeNull();
  });

  it("does not stack error messages across repeated attempts", async () => {
    const host = await mount(DIAGRAM);
    const render: DiagramRenderer = () => Promise.reject(new Error("nope"));

    await hydrateDiagramsIn(host, dependencies(render));
    // The marker has to be cleared for a retry to reach the renderer at all,
    // which is what the preview pane does when the source changes.
    host.querySelector(`.${DIAGRAM_CLASS}`)?.removeAttribute("data-cv-drawn");
    await hydrateDiagramsIn(host, dependencies(render));

    expect(host.querySelectorAll(".cv-diagram-error")).toHaveLength(1);
  });
});

describe("sanitisation", () => {
  it("strips script from whatever the renderer produced", async () => {
    const host = await mount(DIAGRAM);

    await hydrateDiagramsIn(
      host,
      dependencies(
        stub(
          '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script><rect/></svg>',
        ),
      ),
    );

    expect(host.querySelector("script")).toBeNull();
    expect(host.querySelector("rect")).not.toBeNull();
  });

  it("strips an event handler from whatever the renderer produced", async () => {
    const host = await mount(DIAGRAM);

    await hydrateDiagramsIn(
      host,
      dependencies(
        stub(
          '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><rect/></svg>',
        ),
      ),
    );

    expect(host.querySelector("svg")?.getAttribute("onload")).toBeNull();
  });
});

/**
 * `hydrateDiagramsIn` has to be injectable into the PDF worker's browser
 * context, so it names these classes as literals instead of importing them.
 * This is the check that the two spellings stay in step.
 */
describe("selector agreement", () => {
  it("matches the markup the renderer emits", async () => {
    const html = await renderMarkdown(DIAGRAM);

    expect(html).toContain(`${DIAGRAM_ATTRIBUTE}="mermaid"`);
    expect(html).toContain(`class="${DIAGRAM_CLASS}"`);
    expect(html).toContain(`class="${DIAGRAM_SOURCE_CLASS}"`);
    expect(hydrateDiagramsIn.toString()).toContain(
      `[${DIAGRAM_ATTRIBUTE}="mermaid"]`,
    );
    expect(hydrateDiagramsIn.toString()).toContain(`.${DIAGRAM_SOURCE_CLASS}`);
  });
});
