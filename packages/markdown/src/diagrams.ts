import {
  sanitiseSvgElement,
  SVG_POLICY,
  type SvgPolicy,
} from "./svg-sanitise.js";

// Re-exported so a consumer that hydrates diagrams — the PDF worker injects
// both of these into a browser context — has one import to reach for.
export { sanitiseSvgElement, SVG_POLICY, type SvgPolicy };

/**
 * Diagram hydration.
 *
 * Turns the inert containers left by `rehypeDiagramFence` into drawn SVG. This
 * runs in the two places that have a DOM: the desktop preview pane, and the
 * Chromium the PDF worker launches. Both call `hydrateDiagramsIn`, which is
 * written to be self-contained so the worker can inject its source into a page
 * — see the note in `svg-sanitise.ts`.
 *
 * Mermaid is imported lazily and only when a document actually contains a
 * diagram. It is close to a megabyte, and most findings have none.
 */

/** Renders mermaid source to an SVG string. */
export type DiagramRenderer = (
  id: string,
  source: string,
) => Promise<{ svg: string }>;

export interface HydrateDependencies {
  render: DiagramRenderer;
  sanitise: (root: Element, policy: SvgPolicy) => Element | null;
  policy: SvgPolicy;
}

export interface HydrateResult {
  rendered: number;
  failed: number;
}

/**
 * Mermaid configuration.
 *
 * Plain JSON so the PDF worker can pass it through to a browser context.
 *
 * `securityLevel: "strict"` disables click handlers and HTML labels. `secure`
 * extends mermaid's own list of settings a diagram may not override through an
 * `%%{init:...}%%` directive: without `themeCSS` and friends in it, a diagram's
 * author could inject stylesheet text into the document that quotes it.
 */
export const MERMAID_CONFIG = {
  startOnLoad: false,
  securityLevel: "strict",
  secure: [
    "secure",
    "securityLevel",
    "startOnLoad",
    "initialize",
    "themeCSS",
    "theme",
    "themeVariables",
    "fontFamily",
    "altFontFamily",
  ],
  htmlLabels: false,
  flowchart: { htmlLabels: false, useMaxWidth: true },
  sequence: { useMaxWidth: true },
  // Neutral reads correctly in print and does not depend on colour alone.
  theme: "neutral",
  fontFamily: "inherit",
} as const;

/**
 * Draws every un-hydrated diagram under `root`.
 *
 * Self-contained by contract; the literals below intentionally duplicate the
 * constants in `diagram-fence.ts`, and `diagrams.test.ts` asserts they agree.
 *
 * A diagram that fails to parse keeps its source visible and gains an error
 * line. A silently empty box in a report is worse than a visible mistake: the
 * author can fix what they can see.
 */
export async function hydrateDiagramsIn(
  root: ParentNode,
  dependencies: HydrateDependencies,
): Promise<HydrateResult> {
  const containers = Array.from(
    root.querySelectorAll('[data-cv-diagram="mermaid"]:not([data-cv-drawn])'),
  );

  let rendered = 0;
  let failed = 0;

  for (const [index, container] of containers.entries()) {
    const source = container.querySelector(".cv-diagram-source");
    const text = source?.textContent ?? "";

    if (text.trim().length === 0) {
      continue;
    }

    // Marked before rendering, so a re-entrant call — a React effect firing
    // twice — cannot start the same diagram again.
    container.setAttribute("data-cv-drawn", "");

    const ownerDocument = container.ownerDocument;
    const previous = container.querySelector(".cv-diagram-error");

    previous?.remove();

    try {
      const id = `cv-mermaid-${String(index)}-${String(text.length)}`;
      const { svg } = await dependencies.render(id, text);
      const parsed = new DOMParser().parseFromString(svg, "image/svg+xml");
      const element = parsed.documentElement;

      if (element.tagName.toLowerCase() !== "svg") {
        throw new Error("Renderer did not return an SVG.");
      }

      const safe = dependencies.sanitise(element, dependencies.policy);

      if (safe === null) {
        throw new Error("Rendered diagram failed sanitisation.");
      }

      const imported = ownerDocument.importNode(safe, true);

      if (source === null) {
        container.append(imported);
      } else {
        source.replaceWith(imported);
      }

      rendered += 1;
    } catch (error) {
      failed += 1;

      const message = ownerDocument.createElement("p");

      message.className = "cv-diagram-error";
      message.textContent = `Diagram could not be drawn: ${
        error instanceof Error ? error.message : "unknown error"
      }`;
      container.append(message);
    }
  }

  return { rendered, failed };
}

let initialised = false;

/**
 * Loads mermaid on first use and hydrates `root` with it.
 *
 * The dynamic import is what keeps mermaid out of the initial bundle; a
 * document with no diagrams never pays for it.
 */
export async function hydrateDiagrams(
  root: ParentNode,
): Promise<HydrateResult> {
  const pending = root.querySelectorAll(
    '[data-cv-diagram="mermaid"]:not([data-cv-drawn])',
  );

  if (pending.length === 0) {
    return { rendered: 0, failed: 0 };
  }

  const mermaid = (await import("mermaid")).default;

  if (!initialised) {
    // Copied out of the shared constant: mermaid declares `secure` as a
    // mutable array, and the constant has to stay readonly and serialisable
    // for the PDF worker to pass it into a browser context.
    mermaid.initialize({
      ...MERMAID_CONFIG,
      secure: [...MERMAID_CONFIG.secure],
    });
    initialised = true;
  }

  return hydrateDiagramsIn(root, {
    render: (id, source) => mermaid.render(id, source),
    sanitise: sanitiseSvgElement,
    policy: SVG_POLICY,
  });
}
