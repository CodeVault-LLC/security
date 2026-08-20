# Project governance

CodeVault LLC owns the project. The lead maintainer is [@lukasolsen](https://github.com/lukasolsen).

The lead maintainer reviews contributions, manages releases, handles vulnerability reports, and controls access to repository and release resources. GitHub's organization and repository access lists are the authoritative record of accounts with sensitive access.

The project currently has one trusted human maintainer. Automated checks and AI review provide useful evidence, but neither is a second trusted person. The project does not claim two-person review or independent assessment.

The maintainer grants the least access needed for each collaborator and reviews sensitive access at least every six months. A collaborator must use MFA before receiving write, administrative, release, registry, signing, or security-advisory access. The maintainer removes access when a role ends.

Security-sensitive changes include authentication, authorization, cryptography, tenant separation, parsers, exports, audit behavior, deployment defaults, and release workflows. These changes need tests and an explicit security-impact statement in the pull request.

The project records material design and risk decisions in `docs/architecture`, `docs/security`, or a dated specification. A future maintainer change must update this file and the repository access review record.

