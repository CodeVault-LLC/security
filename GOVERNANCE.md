# Project governance

CodeVault LLC owns the project. The lead maintainer is [@lukasolsen](https://github.com/lukasolsen).

## Project classification

CodeVault Security is a **Class B** project under the CodeVault Release Certification System (CV-STD-0001, section 3.0). Lukas Olsen (GitHub [@lukasolsen](https://github.com/lukasolsen)) is the owning engineering lead. The classification was approved and recorded on 2026-08-28.

Class B is the highest credible classification because the product is an authorization service and system of record for embargoed vulnerability evidence, disclosure communications, and other sensitive customer data. A security or integrity failure could expose that data, violate coordinated-disclosure obligations, or materially impair customers, and those consequences could be severe or difficult to reverse.

The engineering lead must re-evaluate this classification for every major release and whenever a material change could increase or decrease the product's consequences of failure. Class B requires the alpha, beta, release-candidate, and general-availability lifecycle; full requirements-to-verification traceability; reproducible release builds; recorded independent Software Assurance concurrence before the Release Readiness Review; and no open Severity 1 or Severity 2 anomaly at certification unless each exception has an explicitly approved, documented risk-assessed waiver.

This classification was assigned while the product was already in alpha. The repository does not claim that earlier lifecycle gates, independent review, traceability, or release-readiness evidence occurred retrospectively. Missing Class B evidence remains an open release gap and must be created or resolved before the relevant transition; the [security evidence index](docs/security/security-evidence-index.md) records the current state.

The lead maintainer reviews contributions, manages releases, handles vulnerability reports, and controls access to repository and release resources. GitHub's organization and repository access lists are the authoritative record of accounts with sensitive access.

The project currently has one trusted human maintainer. Automated checks and AI review provide useful evidence, but neither is a second trusted person. The project does not claim two-person review or independent assessment.

The maintainer grants the least access needed for each collaborator and reviews sensitive access at least every six months. A collaborator must use MFA before receiving write, administrative, release, registry, signing, or security-advisory access. The maintainer removes access when a role ends.

Security-sensitive changes include authentication, authorization, cryptography, tenant separation, parsers, exports, audit behavior, deployment defaults, and release workflows. These changes need tests and an explicit security-impact statement in the pull request.

The project records material design and risk decisions in `docs/architecture`, `docs/security`, or a dated specification. A future maintainer change must update this file and the repository access review record.
