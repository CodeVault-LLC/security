# Secure open-source release and supply-chain plan

Status: Repository-controlled implementation complete; external and owner decisions remain  
Date: 2026-08-20  
Scope: CodeVault Security source, CI, release builds, desktop packages, OCI images, and self-host deployment guidance

## Implementation result

Implemented on 2026-08-20:

- Pinned CI, security, and protected reusable release workflows with explicit permissions and no inherited secret set.
- Frozen, digest-pinned desktop and OCI builds with explicit artifact inventory checks.
- Per-artifact CycloneDX 1.7 SBOMs, VEX, SHA-256 checksums, release manifests, GitHub attestations, and keyless OCI signatures.
- A hardened production Compose deployment with generated file-backed secrets, distinct database and object-store roles, internal data networks, non-root application images, read-only filesystems, dropped capabilities, and resource limits.
- Approved vulnerability policy, governance and contribution policies, release verification guidance, an evidence index, and SSDF, ASVS, OSPS, and 800-53 mappings under `docs/`.
- Local verification of frozen installation, lint, formatting, type checking, 750 unit/DOM tests, 170 isolated database integration tests, dependency audit, application build, workflow linting, workflow security analysis, all three OCI builds, and a clean production-stack smoke test.

The following items cannot be completed by repository code alone:

- Apache-2.0 is the selected OSI-approved license. The root license and notice are included in release artifacts.
- The private GitHub repository must become public or use a plan that supports branch and tag rulesets. Organization MFA, security features, the protected `release` environment, and signing secrets must be configured in GitHub.
- SLSA Build Level 3 must be verified against provenance from a real official release. SLSA Source Level 3 still needs eligible source provenance and a source VSA.
- ASVS Level 3, an independent security assessment, government authorization, and legal attestations remain human assessment or operator activities.

## Outcome

Implement a release process in which a user can trace every official artifact to an immutable source revision, verify who built it, inspect its software components, reject a tampered artifact, and deploy the self-hosted product with secure defaults.

The target assurance profile is:

- SLSA v1.2 Build Level 3 for every official binary and OCI image.
- SLSA v1.2 Source Level 3 when the source control system can issue the required source provenance and verification summary attestations. Until then, implement the Level 3 controls and describe the attestation gap without claiming the level.
- NIST SP 800-218 SSDF 1.1 for all applicable secure development practices.
- OWASP ASVS 5.0.0 Level 3 for applicable web, API, authentication, file-handling, cryptography, logging, and data-protection requirements.
- OpenSSF OSPS Baseline Level 1 using the version current when the assessment is made. The current version at plan creation is `2026.02.19`.
- CISA 2025 Minimum Elements for SBOMs, represented as CycloneDX 1.7 JSON unless a newer format is deliberately adopted and pinned.
- A product and deployment mapping to the NIST SP 800-53 Rev. 5 Moderate baseline. This is supporting evidence for an operator's authorization process, not a product certification.

SLSA Source Level 4 and OpenSSF OSPS Baseline Level 2 are deferred because they require a genuine second trusted human or maintainer. An AI review can be retained as automated evidence, but it does not satisfy a two-person control, independence requirement, legal attestation, or external assessment.

## Current project facts

- The repository is a Bun monorepo pinned to Bun 1.3.14 and Node.js 24.
- `bun.lock` supports frozen dependency installation.
- The root already provides `build`, `test`, `typecheck`, `lint`, `format:check`, and `e2e` commands.
- The desktop application is packaged with Electron Builder for macOS, Windows, and Linux.
- Server, worker, and media-worker container builds already exist under `infra/`.
- CI already runs quality, integration, audit, and tagged desktop packaging jobs.
- The repository already contains threat-model and security-architecture documents.
- GitHub Actions are referenced by mutable major-version tags.
- The tagged package job does not depend on the audit job and ignores missing package files.
- Official server and worker images are not published by a release workflow.
- Release artifacts do not yet have SBOMs, VEX statements, checksums, signatures, or build provenance.
- The initial assessment found no `LICENSE` or public `SECURITY.md`. Both are now present, with Apache-2.0 selected for the project.

## Required decisions before implementation

| ID | Decision | Requirement | Expected result |
| --- | --- | --- | --- |
| D-01 | Open-source license | Select an OSI-approved license and record copyright ownership. Legal advice may be needed if contributions or third-party code create ambiguity. | GitHub identifies the license, users know their rights, and release archives contain the license. |
| D-02 | Supported releases | Define whether security fixes cover only the latest release or multiple release lines. | `SECURITY.md` and support documentation give reporters and operators one unambiguous policy. |
| D-03 | Official distributions | Confirm that desktop installers plus server, worker, and media-worker OCI images are the official deliverables. Do not publish workspace packages to npm unless a public library distribution is intentionally added later. | The release workflow has a finite artifact inventory and no accidental package publication. |
| D-04 | Registry and release host | Select the OCI registry and use GitHub Releases for downloadable artifacts unless another host is required. | Verification instructions can name stable identities and registry locations. |
| D-05 | Platform signing | Obtain and protect Apple and Windows code-signing credentials for official desktop releases. Decide whether unsigned preview builds are allowed outside official releases. | Official macOS and Windows downloads pass native trust checks. A missing signing credential blocks an official release. |
| D-06 | Commercial model | Decide whether the project is non-commercial FOSS, commercially supported, dual-licensed, or sold as a hosted service. | The Cyber Resilience Act and procurement obligations can be scoped correctly. |

## Tool and package requirements

Supply-chain tooling should run in CI or a release container. It should not become an application runtime dependency.

| Capability | Required | Preferred implementation | Repository impact |
| --- | --- | --- | --- |
| Frozen install | Yes | Existing `bun install --frozen-lockfile` | No new package. Keep Bun and Node versions pinned. |
| Application build | Yes | Existing root and workspace build scripts | Build all applications and packages from a clean checkout. |
| Desktop package build | Yes | Existing Electron Builder configuration | Produce the declared macOS, Windows, and Linux formats. |
| OCI image build | Yes | Existing Dockerfiles with BuildKit or Buildx | Produce server, worker, and media-worker images for each release. |
| Build provenance | Yes | GitHub artifact attestations from a protected reusable release workflow, or another builder independently assessed for SLSA Build L3 | Add release workflow files and verification documentation. No runtime package. |
| SBOM generation | Yes | Evaluate Syft and CycloneDX tooling against Bun workspaces, Electron packages, and OCI images. Pin the selected tool by version or action commit. | Add CI-only tooling and schema validation. Emit one SBOM per artifact. |
| VEX generation | Yes | CycloneDX VEX or OpenVEX with a documented conversion and validation path | Add a per-release vulnerability disposition file, including an empty statement when no disposition is needed. |
| Signing | Yes | GitHub/Sigstore attestations and keyless Cosign signing for OCI images. Retain native Apple and Windows signing. | Add OIDC-scoped release permissions. No long-lived Cosign signing key. |
| Artifact verification | Yes | `gh attestation verify`, `cosign verify`, checksum verification, and CycloneDX schema validation | Add a single documented verification command or script. |
| Dependency review | Yes | GitHub dependency review plus `bun audit` | Add a pull-request gate. The release must depend on it. |
| Source scanning | Yes | GitHub CodeQL for JavaScript/TypeScript | Add a pinned workflow and required status check. |
| Container and filesystem scanning | Yes | Evaluate Trivy and Grype, select one, and pin it | Scan source and all final OCI images. Store machine-readable results. |
| Workflow validation | Yes | `actionlint` and `zizmor`, both pinned | Reject malformed or insecure GitHub Actions changes. |
| Secret detection | Yes | GitHub secret scanning for the public repository plus a pinned CI scanner where needed | Block verified secrets and document false-positive handling. |
| Open-source posture | Yes | OpenSSF Scorecard and OSPS Baseline checklist | Publish an evidence-backed assessment and disclose accepted solo-maintainer gaps. |

The tooling evaluation is a short implementation spike, not an open-ended selection exercise. A tool is acceptable only if it supports Bun's lockfile and workspace graph, generates deterministic machine-readable output, runs without uploading proprietary source or unpublished vulnerability data, and can be pinned and verified.

## Implementation phases

### Phase 0: Establish governance and truthful claims

Requirements:

1. Add the selected `LICENSE` and include it in all source and binary distributions.
2. Add a root `SECURITY.md` with supported versions, a private reporting channel, response targets, disclosure expectations, safe-harbor language, and the types of reports accepted.
3. Add maintainer, support, end-of-life, contribution, and release policies. Record that AI output is advisory and a human maintainer owns acceptance and release decisions.
4. Add a security-evidence index that links the threat model, control mappings, release evidence, and known gaps.
5. Establish a documented claim policy. A badge or compliance statement must link to evidence, identify the assessed version, and distinguish self-assessment from third-party certification.

Expected result:

- The repository is legally open source, has a usable private vulnerability-reporting process, and does not make unsupported government or certification claims.
- A potential contributor can identify who may approve a change and how automated or AI review is treated.

### Phase 1: Make build inputs and outputs explicit

Requirements:

1. Define the release artifact inventory:
   - macOS DMG and ZIP packages for supported architectures.
   - Windows NSIS package.
   - Linux RPM and AppImage packages.
   - Server, worker, and media-worker OCI images.
   - A signed source archive if GitHub's automatic source archives are not sufficient for the verification policy.
2. Add one release version source and verify that the Git tag, application version, desktop package version, OCI labels, and release notes agree.
3. Keep workspace packages private. Treat them as build inputs, not independently published packages, unless D-03 changes.
4. Define clean-build commands that start from a fresh checkout and use `bun install --frozen-lockfile`.
5. Ensure every expected artifact has an explicit filename. Replace `if-no-files-found: ignore` with failure for official releases.
6. Make the audit and security jobs mandatory dependencies of every release job.
7. Pin base images by digest for release builds and record the digest in provenance and SBOM data.

Expected result:

- A version tag produces the same declared set of artifact names every time.
- A version mismatch, changed lockfile, missing package, failed audit, or unpinned release input stops the release.

### Phase 2: Harden source and CI controls

Requirements:

1. Pin every third-party GitHub Action to a full commit SHA and annotate the intended upstream version.
2. Give each job only the permissions it needs. Grant `id-token: write`, `attestations: write`, or `packages: write` only to the protected release job that uses it.
3. Prevent pull-request workflows from accessing release credentials or untrusted deployment environments.
4. Protect the primary and release branches against direct pushes, force pushes, deletion, and bypass. Require quality, integration, audit, dependency review, CodeQL, secret, workflow, and container checks as applicable.
5. Require MFA for maintainers and minimize repository and registry administrator access.
6. Protect release environments and immutable version tags. Separate ordinary CI package tests from official release publication.
7. Move artifact creation into a protected reusable workflow that generates attestations and meets the selected builder's documented SLSA Build L3 pattern.
8. Record source-control evidence for SLSA Source Level 3. Do not claim Source Level 3 unless an eligible source-control system or verifier issues the required Source Provenance and Source VSA.

Expected result:

- Untrusted code cannot obtain release credentials or publish an official artifact.
- A release maps to one immutable commit and one protected workflow identity.
- The project can truthfully claim SLSA Build Level 3 after the builder configuration is assessed and verified.

### Phase 3: Generate and publish release evidence

Requirements:

1. Generate a CycloneDX SBOM for each desktop package and OCI image. Validate the schema and verify that the CISA 2025 minimum elements are present.
2. Generate a VEX document for the release. Every vulnerability disposition must include justification, status, affected products, and an update timestamp.
3. Generate SHA-256 checksums for downloadable artifacts.
4. Generate build provenance through the Build L3-capable builder. The provenance subject digest must match the published artifact.
5. Sign or attest each downloadable artifact and sign OCI image digests with a verifiable project identity.
6. Attach checksums, SBOMs, VEX, provenance or attestation references, and verification instructions to the GitHub Release. Attach OCI metadata to immutable image digests in the registry.
7. Retain release logs and evidence according to a documented retention policy.
8. Test reproducibility on a second clean runner. Compare unsigned build contents where native code signing, notarization, timestamps, or packaging formats prevent byte-for-byte equality. Document every accepted source of nondeterminism.

Expected release bundle:

| Artifact | Expected accompanying evidence |
| --- | --- |
| Each desktop installer or archive | SHA-256 checksum, native signature where applicable, CycloneDX SBOM, Build L3 provenance or attestation, and verification command |
| Each OCI image digest | CycloneDX SBOM, vulnerability scan result, VEX, keyless signature, and Build L3 provenance or attestation |
| Release as a whole | Release notes, supported upgrade path, known security-impacting changes, VEX index, evidence manifest, and source commit identity |

Expected result:

- A user can download an artifact and independently verify its digest, repository, commit, workflow identity, signature or attestation, and component inventory.
- Modifying one byte, substituting an image digest, or presenting evidence from another repository causes verification to fail.

### Phase 4: Ship a secure self-host deployment

Requirements:

1. Add a production-oriented deployment definition separate from the development Compose file. Start with Docker Compose unless a supported Kubernetes distribution is an actual product requirement.
2. Include the server, worker, media-worker, PostgreSQL, and object-storage relationships needed for a complete supported installation. Do not expose the database or object store publicly by default.
3. Run application containers as non-root with dropped capabilities, bounded resources, health checks, isolated networks, and read-only filesystems where the application permits them.
4. Use secrets files or an external secrets manager. Examples must contain placeholders only. Refuse known default credentials and weak production configuration at startup.
5. Document TLS termination, trusted proxy settings, outbound network requirements, identity-provider configuration, backups, restore testing, upgrades, rollback constraints, database migrations, logging, monitoring, and incident-response data collection.
6. Pin deployed images by digest and document signature and attestation verification before deployment.
7. Provide a deployment security checklist that separates product controls from operator responsibilities.

Expected result:

- A new operator can deploy the full product from verified images by following one documented path.
- Default networking does not publish internal data stores, containers do not run as root, and insecure production secrets or configuration cause a clear failure.
- A backup can be restored and an upgrade can be rehearsed using documented commands.

### Phase 5: Build the assurance evidence set

Requirements:

1. Create an ASVS 5.0.0 Level 3 applicability matrix. Give every requirement one of `Pass`, `Not applicable`, or `Gap`, with a code, test, or document reference and a justification for every `Not applicable` entry.
2. Create an SSDF 1.1 matrix across Prepare the Organization, Protect the Software, Produce Well-Secured Software, and Respond to Vulnerabilities. Link each applicable task to durable evidence.
3. Assess the current OSPS Baseline Level 1 version and publish the completed checklist. Reassess after material workflow or governance changes and at least annually.
4. Create a NIST SP 800-53 Rev. 5 Moderate mapping that identifies `Product`, `Deployment`, `Operator`, `Shared`, and `Not applicable` responsibility. Use the current NIST OSCAL baseline as the source.
5. Keep the threat model current and link high-risk trust boundaries to ASVS tests and architecture controls.
6. Add security-focused tests for tenant isolation, authorization, authentication, session handling, file and archive parsing, media decoding, SSRF, injection, cryptographic failure modes, audit integrity, and data deletion or retention.
7. Arrange an independent human security assessment before a stable 1.0 release or a government production deployment. Track findings to closure or record explicit risk acceptance.

Expected result:

- Auditors and buyers receive a versioned evidence index instead of a generic claim that the software is secure.
- Every applicable ASVS Level 3 and SSDF requirement has traceable evidence or a visible remediation item.
- The 800-53 mapping makes clear which controls still belong to the deploying government agency.

### Phase 6: Add the government procurement profile when needed

Requirements:

1. Prepare evidence for the CISA Secure Software Development Attestation Common Form only when supplying covered software to a United States federal agency.
2. Require the authorized human or legal representative to make the attestation. AI may collect evidence but must not sign, impersonate the attestor, or decide legal applicability.
3. If a required practice cannot be attested, prepare a private Plan of Action and Milestones for the requesting agency instead of publishing sensitive deficiency details.
4. Treat FedRAMP as out of scope for the self-hosted product by default. Reassess only if the project operator offers a reusable cloud service that handles federal information on an agency's behalf.
5. Evaluate FIPS-validated cryptographic modules, FIPS mode, CMMC, export controls, accessibility procurement rules, and agency overlays only against a concrete customer and deployment requirement.
6. Perform a Cyber Resilience Act applicability assessment before monetizing the product, providing paid support tied to distribution, or operating it commercially in the European Union.

Expected result:

- Government-facing statements are signed by an accountable human and are supported by the SSDF evidence set.
- The project does not spend effort claiming FedRAMP, FIPS, CMMC, or CRA conformance when the product or business model is outside that requirement's scope.

## Verification and acceptance tests

Implementation is complete only when all applicable checks below pass on an official release candidate.

| Test | Expected observation |
| --- | --- |
| Clean checkout | The documented build uses the pinned Bun and Node versions and a frozen lockfile without modifying tracked files. |
| Quality gates | Lint, formatting, type checking, unit, integration, end-to-end, audit, security, and package checks pass before publication. |
| Artifact inventory | Every declared desktop package and OCI image exists. An absent artifact fails the release. |
| Version identity | Git tag, commit, package metadata, OCI labels, and release notes agree. |
| SBOM validation | Every SBOM validates against the pinned CycloneDX schema and contains the required supplier, component, version, dependency, hash, and creation data. |
| Provenance verification | The verifier confirms the expected repository, protected workflow, source commit, subject digest, and trusted builder identity. |
| Signature verification | Native desktop signatures and OCI or Sigstore identities verify against the documented trust policy. |
| Tamper test | A one-byte artifact modification and a substituted OCI digest both fail verification. |
| VEX validation | The VEX document is schema-valid and every non-empty disposition has a justification and timestamp. |
| Self-host smoke test | A clean host can start the complete supported stack, pass health checks, authenticate, create an organization, store and retrieve evidence, run a worker job, and complete backup and restore. |
| Secure defaults | Internal stores are not externally published, containers are non-root, default credentials are rejected, and missing production security settings fail clearly. |
| Control evidence | ASVS, SSDF, OSPS, and 800-53 matrices reference the tested release and contain no unexplained blank controls. |
| Solo-maintainer claim test | Documentation does not claim two-person review, SLSA Source L4, OSPS Level 2, independent assessment, or certification unless those facts become true. |

## Proposed implementation artifacts

The implementation should normally add or update these paths:

- `LICENSE`
- `SECURITY.md`
- `CONTRIBUTING.md`
- `SUPPORT.md`
- `docs/security/release-policy.md`
- `docs/security/release-verification.md`
- `docs/security/security-evidence-index.md`
- `docs/compliance/nist-ssdf-1.1.md`
- `docs/compliance/owasp-asvs-5.0.0-l3.md`
- `docs/compliance/openssf-osps-baseline.md`
- `docs/compliance/nist-800-53-moderate.md`
- `.github/workflows/ci.yml`
- `.github/workflows/security.yml`
- `.github/workflows/release.yml`
- `.github/workflows/reusable-release-build.yml`
- `infra/compose.production.yml`
- `docs/operations/self-hosted-production.md`
- A release verification script under `scripts/` with a root package script such as `bun run release:verify`

Exact filenames may change during implementation if the existing documentation structure provides a clearer home. The required evidence and behavior must not be dropped.

## Recommended implementation order

1. Resolve D-01 through D-06 and add governance documents.
2. Define the artifact inventory, version policy, and clean-build contract.
3. Harden CI permissions, pin actions, and make all security checks mandatory.
4. Build and publish the three OCI images in addition to desktop packages.
5. Add SBOM, VEX, checksum, signing, provenance, and verification steps.
6. Add the production self-host deployment and verify backup, restore, and upgrades.
7. Complete ASVS, SSDF, OSPS, and 800-53 evidence mappings against a release candidate.
8. Obtain an independent human assessment before the first stable or government production release.
9. Enable government-specific attestations or certifications only for a concrete buyer and deployment model.

## Standards references

- [SLSA v1.2 specification](https://slsa.dev/spec/v1.2/)
- [SLSA v1.2 Build track](https://slsa.dev/spec/v1.2/build-track-basics)
- [SLSA v1.2 Source requirements](https://slsa.dev/spec/v1.2/source-requirements)
- [NIST SP 800-218 SSDF 1.1](https://csrc.nist.gov/pubs/sp/800/218/final)
- [OWASP ASVS](https://owasp.org/www-project-application-security-verification-standard/)
- [OpenSSF OSPS Baseline](https://baseline.openssf.org/)
- [CISA 2025 Minimum Elements for an SBOM](https://www.cisa.gov/sites/default/files/2025-08/2025_CISA_SBOM_Minimum_Elements.pdf)
- [NIST SP 800-53 Rev. 5](https://csrc.nist.gov/pubs/sp/800/53/r5/upd1/final)
- [NIST SP 800-53B control baselines](https://csrc.nist.gov/pubs/sp/800/53/b/upd1/final)
- [CISA Secure Software Development Attestation Form](https://www.cisa.gov/resources-tools/resources/secure-software-development-attestation-form)
- [FedRAMP scope guidance](https://www.fedramp.gov/docs/authority/scope/)
- [EU Cyber Resilience Act, Regulation (EU) 2024/2847](https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:32024R2847)
