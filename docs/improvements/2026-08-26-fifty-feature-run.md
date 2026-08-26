# Fifty-feature product extension run

This queue tracks the user-requested product extension run. Each feature is
implemented on its own branch, reviewed by CI in its own pull request, and
squash-merged into `master` before the next feature starts.

## Merged features 1-20

1. TLP report controls and export labels, PR #68.
2. SARIF finding exchange, PR #70.
3. Inline report renaming, PR #71.
4. Portable Markdown report export, PR #72.
5. Correspondence transcript export, PR #73.
6. Intelligence freshness warnings, PR #74.
7. Selective atomic bulk intake acceptance, PR #75.
8. Case activity CSV export, PR #76.
9. Configurable prior-art checks, PR #77.
10. Finding triage views, PR #78.
11. Evidence digest manifest export, PR #79.
12. Clean case template duplication, PR #80.
13. Readable finding revision comparison, PR #81.
14. Private disclosure calendar export, PR #82.
15. Atomic bulk remediation workflow, PR #83.
16. Security notification inbox with unread state, PR #84.
17. Case handoff brief export, PR #85.
18. Recurring scanner synchronization profiles, PR #86.
19. Prior-art retry and run history, PR #87.
20. Intelligence refresh scheduling controls, PR #88.

## Continuation queue 21-50

21. Case archive version 2 with correspondence.
22. Evidence preview redaction workflow.
23. Evidence chain-of-custody attestations.
24. Affected-version comparison matrix.
25. Remediation SLA tracking.
26. Vendor response SLA tracking.
27. Public advisory builder.
28. CVE request preparation workflow.
29. Vendor contact-route health checks.
30. OpenPGP key-expiry warnings.
31. Submission attachment review workspace.
32. Recoverable offline editing drafts.
33. Keyboard command palette.
34. Personal saved searches.
35. Notification preferences.
36. Failed-job recovery workspace.
37. Verifiable audit-event hash chain.
38. Supported backup command.
39. Restore dry-run and validation report.
40. Operator health telemetry dashboard.
41. Published scale and resource budgets.
42. Accessibility acceptance suite.
43. Privileged-role WebAuthn enforcement.
44. Session and device inventory.
45. Scoped personal API tokens.
46. MCP submission operations.
47. Encrypted case archives.
48. Organization data-retention policies.
49. Organization portability export.
50. Desktop release-channel and update controls.

The queue may be reordered when a prerequisite or a newly discovered product
risk makes another item the safer next change. Reordering does not change the
one-feature-per-branch workflow.
