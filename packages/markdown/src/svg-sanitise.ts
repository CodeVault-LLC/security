/**
 * SVG sanitisation.
 *
 * Mermaid draws node labels from the diagram source, and that source is part of
 * a finding — which means it quotes hostnames, payloads and parameter names an
 * attacker chose. Mermaid's own `securityLevel: "strict"` is not treated as
 * sufficient: its output is an SVG fragment that this module re-checks against
 * an allow-list before anything inserts it into a document.
 *
 * The same fragment ends up in the exported PDF, rendered by a Chromium that
 * the worker launches. `sanitiseSvgElement` is therefore written to be
 * self-contained — no imports, no closure over module scope — so its source can
 * be injected into that page verbatim. `svg-sanitise.test.ts` enforces that by
 * re-creating it from its own source text and running it there.
 */

export interface SvgPolicy {
  /** Elements kept; anything else is removed along with its subtree. */
  tags: readonly string[];
  /** Attributes kept on any allowed element. */
  attributes: readonly string[];
  /**
   * Attributes holding a reference. Kept only when the value is a same
   * document fragment, which is what markers and gradients use.
   */
  referenceAttributes: readonly string[];
}

/**
 * The allow-list.
 *
 * Drawing primitives, text, and the defs mermaid needs for arrowheads. Notably
 * absent: `foreignObject`, which embeds arbitrary HTML inside an SVG and is the
 * usual way an "SVG-only" sanitiser is defeated; `image` and `use` of anything
 * remote, which would fetch; and `script`.
 */
export const SVG_POLICY: SvgPolicy = {
  tags: [
    "svg",
    "g",
    "defs",
    "marker",
    "path",
    "rect",
    "circle",
    "ellipse",
    "line",
    "polyline",
    "polygon",
    "text",
    "tspan",
    "title",
    "desc",
    "linearGradient",
    "radialGradient",
    "stop",
    "clipPath",
    "pattern",
    "symbol",
    "use",
    "style",
  ],
  attributes: [
    "class",
    "id",
    "viewBox",
    "xmlns",
    "width",
    "height",
    "d",
    "fill",
    "fill-opacity",
    "fill-rule",
    "stroke",
    "stroke-width",
    "stroke-dasharray",
    "stroke-dashoffset",
    "stroke-linecap",
    "stroke-linejoin",
    "stroke-opacity",
    "stroke-miterlimit",
    "opacity",
    "transform",
    "x",
    "y",
    "dx",
    "dy",
    "x1",
    "y1",
    "x2",
    "y2",
    "cx",
    "cy",
    "r",
    "rx",
    "ry",
    "points",
    "offset",
    "stop-color",
    "stop-opacity",
    "gradientUnits",
    "gradientTransform",
    "patternUnits",
    "markerWidth",
    "markerHeight",
    "markerUnits",
    "refX",
    "refY",
    "orient",
    "text-anchor",
    "dominant-baseline",
    "alignment-baseline",
    "font-family",
    "font-size",
    "font-style",
    "font-weight",
    "letter-spacing",
    "white-space",
    "xml:space",
    "preserveAspectRatio",
    "style",
  ],
  referenceAttributes: [
    "marker-start",
    "marker-mid",
    "marker-end",
    "clip-path",
    "mask",
    "href",
    "xlink:href",
  ],
};

/**
 * Sanitises an SVG element in place, returning it, or null if it is not one.
 *
 * Self-contained by contract: everything it needs is either a DOM API or comes
 * in through `policy`. Do not reach for an import or a module constant here.
 */
export function sanitiseSvgElement(
  root: Element,
  policy: SvgPolicy,
): Element | null {
  if (root.tagName.toLowerCase() !== "svg") {
    return null;
  }

  /**
   * Rejects CSS that can reach the network or escape its element.
   *
   * `@import` pulls in a remote stylesheet, and a `url()` pointing anywhere
   * but this document fetches. Either would let an opened report signal that
   * it had been opened, which the threat model treats as the leak that
   * matters.
   *
   * Same-document `url(#arrowhead)` references are kept: that is how every
   * arrowhead, gradient and clip path in a diagram is attached, and dropping
   * them leaves an unstyled black box where the diagram should be.
   */
  const isSafeCss = (value: string): boolean => {
    const normalised = value.toLowerCase().replace(/\s+/g, "");

    if (
      normalised.includes("@import") ||
      normalised.includes("expression(") ||
      normalised.includes("javascript:") ||
      normalised.includes("<")
    ) {
      return false;
    }

    let at = normalised.indexOf("url(");

    while (at !== -1) {
      const target = normalised.slice(at + 4).replace(/^["']/, "");

      if (!target.startsWith("#")) {
        return false;
      }

      at = normalised.indexOf("url(", at + 4);
    }

    return true;
  };

  /** Only same-document fragments: `url(#arrow)` or `#arrow`. */
  const isSafeReference = (value: string): boolean => {
    const trimmed = value.trim();

    return (
      trimmed.startsWith("#") ||
      /^url\(\s*['"]?#[^)'"]*['"]?\s*\)$/i.test(trimmed)
    );
  };

  const tags = new Set(policy.tags.map((tag) => tag.toLowerCase()));
  const attributes = new Set(
    policy.attributes.map((name) => name.toLowerCase()),
  );
  const references = new Set(
    policy.referenceAttributes.map((name) => name.toLowerCase()),
  );

  const clean = (element: Element): void => {
    for (const child of Array.from(element.children)) {
      if (!tags.has(child.tagName.toLowerCase())) {
        child.remove();
        continue;
      }

      clean(child);
    }

    if (element.tagName.toLowerCase() === "style") {
      if (!isSafeCss(element.textContent ?? "")) {
        element.textContent = "";
      }

      return;
    }

    for (const attribute of Array.from(element.attributes)) {
      const name = attribute.name.toLowerCase();
      const value = attribute.value;

      // Event handlers first: `onload` on an <svg> fires on insertion, and no
      // allow-list entry should ever be able to bring one back.
      if (name.startsWith("on")) {
        element.removeAttribute(attribute.name);
        continue;
      }

      if (references.has(name)) {
        if (!isSafeReference(value)) {
          element.removeAttribute(attribute.name);
        }

        continue;
      }

      if (!attributes.has(name)) {
        element.removeAttribute(attribute.name);
        continue;
      }

      if (name === "style" && !isSafeCss(value)) {
        element.removeAttribute(attribute.name);
      }
    }
  };

  clean(root);

  return root;
}
