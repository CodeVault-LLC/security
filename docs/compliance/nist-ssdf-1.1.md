# NIST SSDF 1.1 self-assessment

Assessment date: 2026-08-20  
Scope: repository, GitHub workflows, official release artifacts, and supported self-host deployment  
Authority: [NIST SP 800-218, Secure Software Development Framework 1.1](https://csrc.nist.gov/pubs/sp/800/218/final)

This is a task-level self-assessment. **Implemented** means repository evidence exists; it does not mean NIST or another assessor has verified the task.

| Task | Status | Evidence or remaining work |
| --- | --- | --- |
| PO.1.1 | Implemented | The secure-release plan defines the selected practices and outcomes. |
| PO.1.2 | Partial | `CONTRIBUTING.md` and CI define developer practices; formal training evidence is not applicable to public contributors and remains an operator responsibility for staff. |
| PO.1.3 | Partial | `docs/security/security-evidence-index.md` indexes repository evidence; release-specific measurement history does not exist yet. |
| PO.2.1 | Implemented | `GOVERNANCE.md`, `SECURITY.md`, and `docs/security/repository-settings.md` define security roles and external settings. |
| PO.2.2 | Partial | Solo-maintainer responsibilities are explicit; a second trusted human and independent assessor remain gaps. |
| PO.2.3 | Partial | Signing, GitHub, database, and deployment trust relationships are documented; supplier agreements are outside the repository. |
| PO.3.1 | Implemented | The threat model, release policy, and production deployment identify security requirements. |
| PO.3.2 | Implemented | Contribution expectations are documented, and source and release artifacts use Apache-2.0. |
| PO.3.3 | Implemented | `docs/architecture/threat-model.md` and related architecture documents define risk-based design requirements. |
| PO.4.1 | Implemented | CI, CodeQL, dependency review, Trivy, actionlint, zizmor, audit, tests, and build gates are declared in pinned workflows. |
| PO.4.2 | Partial | Tool configuration is version controlled; workflow results and false-positive decisions will exist only after CI runs. |
| PO.5.1 | Implemented | `docs/security/security-evidence-index.md` defines evidence locations and limitations. |
| PO.5.2 | Partial | Release artifacts have a retention policy; organization-level audit and retention records are external. |
| PS.1.1 | Partial | The default branch uses a required merge-queue gate. Pinned actions, least-privilege permissions, and secret isolation exist. Organization MFA evidence remains external. |
| PS.2.1 | Partial | Release evidence is immutable by policy; a first published release and registry-retention evidence are pending. |
| PS.3.1 | Implemented | Each release emits checksums, an evidence manifest, CycloneDX SBOMs, VEX, and attestations. |
| PS.3.2 | Partial | Release verification is documented; long-term evidence access must be confirmed after the first release. |
| PW.1.1 | Implemented | Architecture and threat-model documents define security requirements and trust boundaries. |
| PW.1.2 | Implemented | Requirements are tracked in the plan, policy, evidence index, and control mappings. |
| PW.1.3 | Partial | Third-party component risk is gated by audit and dependency review; a documented exception history does not yet exist. |
| PW.2.1 | Implemented | Repository structure separates the API, general worker, hostile media decoder, database, and storage trust zones. |
| PW.4.1 | Implemented | Threat modeling covers identities, tenants, parsers, AI, exports, and release boundaries. |
| PW.4.2 | Partial | Threat models link controls and tests; formal review records begin with the first release assessment. |
| PW.4.4 | Partial | Architecture decisions are documented, but no independent security architecture review has occurred. |
| PW.5.1 | Implemented | The project uses maintained frameworks and pinned build/runtime versions instead of custom security primitives where practical. |
| PW.6.1 | Implemented | Contribution policy requires tests and secure handling; CI enforces lint, formatting, type checking, tests, audit, and builds. |
| PW.6.2 | Partial | Review guidance exists; a solo maintainer and AI review do not provide independent human review. |
| PW.7.1 | Implemented | Workflows use frozen dependencies, pinned actions, digest-pinned images, isolated credentials, and explicit permissions. |
| PW.7.2 | Partial | Release attestations and evidence are generated; SLSA Build L3 must be assessed against a real run. |
| PW.8.1 | Implemented | Dependency review, `bun audit`, Dependabot, SBOM generation, and image scanning cover imported components. |
| PW.8.2 | Partial | Update automation exists; remediation exceptions and response-time history do not exist yet. |
| PW.9.1 | Implemented | Automated unit, DOM, integration, decoder, CodeQL, dependency, workflow, secret, filesystem, and image checks are configured. |
| PW.9.2 | Gap | An independent human penetration test and ASVS Level 3 verification are required before a stable or government production release. |
| RV.1.1 | Implemented | Private reporting, supported versions, reportability, scope, and response targets are defined in `SECURITY.md`. |
| RV.1.2 | Implemented | Dependabot, CodeQL, dependency review, Trivy, audit, and private reports feed vulnerability identification. |
| RV.1.3 | Partial | Findings can be triaged through GitHub advisories; production telemetry and customer support intake are operator-dependent. |
| RV.2.1 | Implemented | Release gates block moderate-or-higher dependency audit findings and high/critical image findings. |
| RV.2.2 | Partial | VEX generation exists; release-specific exploitability decisions require human review and justification. |
| RV.3.1 | Partial | Git history and advisories support root-cause analysis; no post-incident record exists yet. |
| RV.3.2 | Implemented | The contribution and release policies require tests and systemic fixes for security changes. |
| RV.3.3 | Partial | Recurrence scanning is configured; metrics and completed incident evidence do not yet exist. |
| RV.3.4 | Partial | Coordinated disclosure is documented; downstream notification channels will be established with the first public release. |

## Acceptance rule

Before signing a customer or CISA secure-software attestation, an authorized human must verify every applicable task against release-specific evidence. Open items must be resolved or described in a private plan of action and milestones when the requesting authority permits one.
