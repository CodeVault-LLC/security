# Security data and validation improvements completed on 2026-08-24

This change set contains 51 reviewed improvements. The count treats each CWE
rank or catalogue entry as one data improvement. It groups the code needed to
deliver one validation behavior under that behavior.

MITRE CWE List 4.20 is the catalogue source. The rank data comes from the
[2025 CWE Top 25](https://cwe.mitre.org/top25/archive/2025/2025_cwe_top25.html),
which MITRE updated on December 15, 2025.

## CWE Top 25 rank data

1. Recorded the 2025 rank for CWE-79.
2. Recorded the 2025 rank for CWE-89.
3. Recorded the 2025 rank for CWE-352.
4. Recorded the 2025 rank for CWE-862.
5. Recorded the 2025 rank for CWE-787.
6. Recorded the 2025 rank for CWE-22.
7. Recorded the 2025 rank for CWE-416.
8. Recorded the 2025 rank for CWE-125.
9. Recorded the 2025 rank for CWE-78.
10. Recorded the 2025 rank for CWE-94.
11. Recorded the 2025 rank for CWE-120.
12. Recorded the 2025 rank for CWE-434.
13. Recorded the 2025 rank for CWE-476.
14. Recorded the 2025 rank for CWE-121.
15. Recorded the 2025 rank for CWE-502.
16. Recorded the 2025 rank for CWE-122.
17. Recorded the 2025 rank for CWE-863.
18. Recorded the 2025 rank for CWE-20.
19. Recorded the 2025 rank for CWE-284.
20. Recorded the 2025 rank for CWE-200.
21. Recorded the 2025 rank for CWE-306.
22. Recorded the 2025 rank for CWE-918.
23. Recorded the 2025 rank for CWE-77.
24. Recorded the 2025 rank for CWE-639.
25. Recorded the 2025 rank for CWE-770.

## Missing Top 25 catalogue entries

26. Added CWE-77, Command Injection.
27. Added CWE-121, Stack-based Buffer Overflow.
28. Added CWE-122, Heap-based Buffer Overflow.
29. Added CWE-476, NULL Pointer Dereference.
30. Added CWE-770, Allocation of Resources Without Limits or Throttling.
31. Added CWE-862, Missing Authorization.

## Other catalogue entries

32. Added CWE-59, Link Following.
33. Added CWE-88, Argument Injection.
34. Added CWE-93, CRLF Injection.
35. Added CWE-295, Improper Certificate Validation.
36. Added CWE-319, Cleartext Transmission of Sensitive Information.
37. Added CWE-444, HTTP Request or Response Smuggling.
38. Added CWE-532, Sensitive Information in Log Files.
39. Added CWE-601, Open Redirect.
40. Added CWE-942, Permissive Cross-domain Security Policy.
41. Added CWE-1321, Prototype Pollution.
42. Added CWE-1333, Inefficient Regular Expression Complexity.

## Validation and query behavior

43. Recorded CWE List 4.20 and the 2025 Top 25 year in exported constants.
44. Added canonical parsing for prefixed, unprefixed, mixed-case, and padded CWE IDs.
45. Prevented malformed CWE IDs from producing MITRE links.
46. Bounded CWE search results and made negative, non-finite, and excessive limits safe.
47. Added a rank-ordered Top 25 query with optional category filtering.
48. Rejected non-finite and out-of-range CVSS scores before severity classification.
49. Added canonical TLP parsing, including conversion of the retired `TLP:WHITE` label to `TLP:CLEAR`.
50. Hardened finding identifiers from API contract to database commit. The server now rejects unknown schemes, canonicalizes authority IDs, creates links only for valid IDs, commits identifier and audit changes atomically, and treats retried inserts as idempotent.
51. Replaced the bootstrap integration fixture's hand-picked migration list with the production migration runner so schema tests cannot omit later migrations.

## Verification

Run these commands from the repository root:

```sh
bun run test
bun run typecheck
bun run lint
bun run format:check
bun run features:check
bun run build
```

The database integration suites require `DATABASE_URL`. Without that variable,
Vitest reports those suites as skipped.
