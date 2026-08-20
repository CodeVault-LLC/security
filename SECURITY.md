# Security policy

## Report a vulnerability

Do not open a public issue for a suspected vulnerability.

Use [GitHub private vulnerability reporting](https://github.com/CodeVault-LLC/security/security/advisories/new). Include the affected version, deployment conditions, impact, and the smallest reproduction that confirms the problem. Do not include live customer data, credentials, unpublished third-party vulnerability details, or destructive proof of impact.

The maintainer will acknowledge a credible report within three business days, provide an initial assessment within seven business days, and coordinate a disclosure date based on severity and the availability of a fix. These targets are not a promise of resolution within those periods.

## Supported versions

Before the first public release, only the current default branch receives security fixes. After release, the latest stable release and the current default branch receive fixes unless a release notice states a longer support period.

## System and scope

CodeVault Security is a self-hosted security research, evidence, finding-management, and coordinated-disclosure platform. This policy covers the server, desktop client, workers, MCP server, database migrations, release workflows, container images, and production deployment files in this repository.

The highest-value assets are unpublished vulnerability details, proof-of-concept material, evidence files, embargo data, authentication secrets, mail tokens, organization membership, and the audit trail.

## Threat model and trust boundaries

Treat browser, desktop, MCP, mail, imported document, uploaded file, archive, image, AI-provider, webhook, and external API input as attacker controlled. Treat database content and object-store content as untrusted when it crosses a parser or authorization boundary.

Repository administrators, release environments, signing identities, deployment secret stores, and database administrators are trusted roles. Their compromise remains reportable when a product or workflow control makes the compromise materially easier or increases its impact.

Read `docs/architecture/threat-model.md`, `docs/architecture/ai-security.md`, and `docs/architecture/organization-security.md` for the detailed model.

## Security invariants

- Every protected operation authenticates the caller and checks authorization against the active organization.
- A caller cannot read or mutate data outside the caller's organization or granted role.
- The server derives identity and organization context from verified credentials, not request fields.
- Public and vendor exports exclude internal-only content unless an authorized human approves the transition.
- AI output remains untrusted draft content. AI cannot approve, disclose, send, or change authoritative state without an authorized human action.
- Uploaded and imported content is bounded before parsing. Hostile media decoding stays in the isolated media worker.
- URLs, redirects, archive paths, filenames, and rendered markup fail closed when validation is uncertain.
- Secrets do not enter source control, logs, release artifacts, SBOMs, or client-visible error messages.
- Cryptographic verification fails closed. The application does not silently replace invalid keys, signatures, tokens, or ciphertext.
- Audit events for security-relevant state changes remain attributable and append-only through normal application access.
- Official release artifacts originate from the protected release workflow and have matching checksums, provenance, signatures or attestations, and SBOMs.

## Reportable findings and severity

A finding is reportable when a realistic path breaks a security invariant or materially weakens confidentiality, integrity, availability, authentication, authorization, auditability, release integrity, or tenant separation.

Give additional weight to findings that expose unpublished research, cross an organization or role boundary, execute code through imported content, compromise release artifacts, steal persistent credentials, bypass MFA, or enable an untrusted contributor to reach release credentials.

Denial of service is reportable when an unauthenticated or low-privilege actor can exhaust shared resources, corrupt durable state, or cause repeated operator intervention under realistic limits.

## Out of scope

- Findings that require prior control of the host, database administrator, repository administrator, or deployment secret store and do not cross another product-enforced boundary.
- Missing controls in development-only fixtures that cannot reach a production build or deployment.
- Dependency version reports without a reachable vulnerable path or other evidence of product impact. Report the reachability evidence when it exists.
- Social engineering, physical attacks, and attacks against third-party services that do not depend on a CodeVault defect.
- Load testing, destructive testing, or access to data that you do not own or have permission to test.

These exclusions do not make a reachable vulnerability safe. Report uncertainty privately.

## Known limitations

The project currently has one trusted human maintainer. AI review and automated analysis do not count as independent human review. The project must not claim SLSA Source Level 4, OpenSSF OSPS Baseline Level 2, independent assessment, or government certification until the corresponding requirements are met and evidenced.

Repository settings, signing credentials, deployment hardening, backups, identity-provider policy, and monitoring depend on the operator. The product documentation identifies those shared responsibilities.

