/**
 * CodeVault Markdown.
 *
 * The single renderer for everything a researcher writes: finding fields,
 * evidence descriptions, disclosure notes and report sections. It runs
 * unchanged in Node, in the Electron renderer and in the PDF worker, which is
 * what lets a live preview promise to look like the exported document.
 *
 * `./diagrams` is deliberately not re-exported here. It pulls in mermaid, and
 * the API server has no reason to carry a diagramming library.
 */
export * from "./callouts.js";
export * from "./chart-fence.js";
export * from "./diagram-fence.js";
export * from "./ids.js";
export * from "./outline.js";
export * from "./pipeline.js";
export * from "./sanitize.js";
export * from "./styles.js";
export * from "./text.js";
export * from "./svg-sanitise.js";
