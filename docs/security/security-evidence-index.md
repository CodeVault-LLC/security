# Security evidence index

This index states what the repository proves and what still depends on an operator or external service. It is not a certification.

| Evidence | Repository source | Current state |
| --- | --- | --- |
| Product feature inventory | `docs/feature-register.md` | Current for the `0.1.0-alpha.9` source tree; every implemented row links to at least one acceptance test. Published release and pull-request evidence are added when the tag ships. |
| Threat model | `docs/architecture/threat-model.md` | Implemented; review after trust-boundary changes and at least annually. |
| AI trust policy | `docs/architecture/ai-security.md` | Implemented for in-product AI proposals. Authenticated MCP clients are a separate direct-operation interface whose calls are attributed to the signed-in user. |
| Organization isolation | `docs/architecture/organization-security.md` and authorization tests | Implemented in the product; a security assessment remains required before a stable release. |
| Secure development plan | `.plans/2026-08-20-secure-open-source-release-plan.md` | Repository-controlled work implemented; owner, hosting, signing, release-run, and independent-assessment gates remain. |
| CI gates | `.github/workflows/ci.yml` and the GitHub `Protect master` ruleset | `Validate` runs fast checks on each pull-request commit and the complete gate on the merge queue commit. The ruleset requires the check before a squash merge. |
| MCP inventory | `docs/operations/mcp-tool-inventory.md` and `packages/mcp/src/generate-inventory.ts` | Generated from authenticated live discovery. CI rejects inventory drift. |
| Security analysis | `.github/workflows/ci.yml` and `.github/workflows/security.yml` | The merge queue runs CodeQL, Trivy, dependency, container, and workflow checks before merge. The independent workflow repeats repository-wide analysis each week and on manual dispatch. |
| Release provenance | `.github/workflows/release.yml` and `.github/workflows/reusable-release-build.yml` | Implemented in source. Build Level 3 remains unverified until a real release attestation is assessed. |
| SBOM and VEX | Release workflow and `scripts/release-evidence.ts` | Implemented in source. No release evidence exists before the first workflow run. |
| Self-host baseline | `infra/compose.production.yml` and `docs/operations/self-hosted-production.md` | Implemented and smoke-tested from empty PostgreSQL and object-store volumes. A production restore rehearsal remains an operator task. |
| NIST SSDF | `docs/compliance/nist-ssdf-1.1.md` | Task-level self-assessment with open gaps. |
| OWASP ASVS | `docs/compliance/owasp-asvs-5.0.0-l3.md` | Level 3 target selected. Requirement-level independent verification remains open. |
| OpenSSF OSPS | `docs/compliance/openssf-osps-baseline.md` | Level 1 assessment has external blockers. License controls are implemented. |
| NIST 800-53 | `docs/compliance/nist-800-53-moderate.md` | Responsibility mapping only. The deploying organization tailors and assesses its controls. |
| Vulnerability policy | Root `SECURITY.md` | Approved and implemented. The root policy governs the complete repository. |
| Open-source license | Root `LICENSE` and `NOTICE` | Apache-2.0 selected. Release source, desktop packages, and OCI images carry the license. |
| Independent assessment | Future assessment report | Not performed. |
