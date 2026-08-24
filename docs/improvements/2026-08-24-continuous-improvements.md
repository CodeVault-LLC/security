# Continuous improvements completed on 2026-08-24

This change set stops at 50 reviewed improvements. The count groups supporting
mechanics under the behavior they deliver. It does not count documentation,
formatting, or commits as product improvements.

## Registry search and normalization

1. Added one fixed vocabulary for eight supported asset registries.
2. Added a bounded, strict search-query contract.
3. Added one normalized asset-proposal contract for every registry.
4. Added typed per-registry failure records.
5. Added a small provider interface so registry quirks stay out of routes.
6. Added an aggregator that searches providers through that interface.
7. Restricted registry HTTP requests to a fixed HTTPS host allowlist.
8. Added a five-second timeout to each registry request.
9. Limited each registry response to 1 MiB before JSON parsing.
10. Rejected non-JSON, malformed, oversized, redirected, and failed responses.
11. Encoded all search terms through `URLSearchParams`.
12. Converted registry HTML descriptions and author fields to bounded plain text.
13. Dropped insecure or malformed homepage URLs.
14. Generated ecosystem-specific PURLs for imported package identities.
15. Added WordPress plugin-directory search.
16. Added WordPress theme-directory search.
17. Added npm search.
18. Added crates.io search.
19. Added Packagist search.
20. Added RubyGems search.
21. Added NuGet search.
22. Added Maven Central search.
23. Ran registry lookups concurrently to bound total wait time.
24. Preserved successful results when one or more registries fail.
25. Deduplicated PURLs, ranked exact matches first, and capped the merged result.
26. Added authentication and a 30-requests-per-minute search limit.

## Asset creation

27. Added registry search inside the asset-creation flow.
28. Debounced registry queries by 350 milliseconds.
29. Added an all-registry or single-registry selector.
30. Added distinct initial, loading, empty, error, and retry states.
31. Reported partial registry outages without hiding other results.
32. Made result selection keyboard reachable with visible focus and full names.
33. Prefilled the asset name, version, and PURL from a selected proposal.
34. Prefilled the description and stored registry provenance in asset metadata.
35. Offered an explicit link action when the proposed vendor matches the directory.
36. Prefilled an unmatched vendor name without asserting an unverified contact route.
37. Kept every registry result as a proposal until the researcher submits the form.

## Charts and metrics

38. Added TanStack Charts as the coordinate-plot implementation.
39. Added responsive measurement, keyboard focus, grid calculation, and tooltips to trends.
40. Preserved the existing chart interface and accessible data tables for every caller.
41. Removed the custom SVG path builder and the unused decorative stat sparkline.
42. Added open-case, peer-review backlog, and overdue-vendor-reply headlines.
43. Added remediation-state distribution statistics.
44. Added external-identifier progress statistics.
45. Added six explicit research-coverage counts with visible denominators.
46. Added unresolved-finding age buckets.
47. Extended metric visibility and vocabulary tests for the new aggregates.

## Security intelligence

48. Aggregated multi-CVE EPSS data by the highest current probability and retained its source CVE.
49. Aggregated KEV membership across every CVE attached to a finding.
50. Superseded stale KEV positives with verified negatives while preserving prior data during CISA outages.

## Verification

Run these commands from the repository root:

```sh
bun run typecheck
bun run test -- --reporter=dot
bun run lint
bun run format:check
bun run features:check
bun run --cwd apps/desktop build
```

The server integration suites need `DATABASE_URL`. Without it, Vitest reports
those suites as skipped rather than passing them against mocks.
