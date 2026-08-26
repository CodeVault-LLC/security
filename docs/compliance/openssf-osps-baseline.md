# OpenSSF OSPS Baseline Level 1 assessment

Assessment date: 2026-08-26

Baseline version: [2026.02.19](https://baseline.openssf.org/versions/2026-02-19)  

Target: Level 1

Level 1 supports projects with any number of maintainers, so it is the right target for the current solo-maintainer project. Level 2 is deferred because it assumes at least two maintainers. This project does **not** currently meet Level 1.

| Control | Status | Evidence or blocker |
| --- | --- | --- |
| OSPS-AC-01.01 | External | Require organization MFA in GitHub; record completion outside the repository. |
| OSPS-AC-02.01 | External | Set organization default repository permission to Read and assign collaborators manually. |
| OSPS-AC-03.01 | Implemented | The `Protect master` ruleset requires pull requests, the `Validate` check, the merge queue, conversation resolution, and squash merges. |
| OSPS-AC-03.02 | Implemented | The `Protect master` ruleset blocks branch deletion and non-fast-forward updates. |
| OSPS-BR-01.01 | Implemented | Workflows pass tag and ref values through quoted environment variables and validate release tags. |
| OSPS-BR-01.03 | Implemented | Pull-request jobs receive no release environment or signing credentials; privileged publication runs only for version tags. |
| OSPS-BR-03.01 | Implemented | Documented project and reporting URLs use HTTPS. |
| OSPS-BR-03.02 | Implemented | GitHub Releases and GHCR use authenticated HTTPS; release assets add checksums, attestations, and signatures. |
| OSPS-BR-07.01 | Partial | Trivy secret scanning and GitHub push-protection guidance exist; GitHub secret scanning remains external. |
| OSPS-DO-01.01 | Gap | Complete end-user guides must be verified before the first public release. |
| OSPS-DO-02.01 | Implemented | `SUPPORT.md` explains public defect reporting and separates private vulnerabilities. |
| OSPS-GV-02.01 | External | Public GitHub issues and discussions become available when the repository is public. |
| OSPS-GV-03.01 | Implemented | `CONTRIBUTING.md` defines the contribution process. |
| OSPS-LE-02.01 | Implemented | The project uses the OSI-approved Apache License 2.0. |
| OSPS-LE-02.02 | Implemented | Release source archives, desktop packages, and OCI images carry the license. |
| OSPS-LE-03.01 | Implemented | The root `LICENSE` contains the complete Apache License 2.0 text. |
| OSPS-LE-03.02 | Implemented | Packaged artifacts include `LICENSE` and `NOTICE`; OCI images also declare the SPDX identifier. |
| OSPS-QA-01.01 | Implemented | The authoritative repository is public at `github.com/CodeVault-LLC/security`. |
| OSPS-QA-01.02 | Implemented | The public repository exposes the complete Git history. |
| OSPS-QA-02.01 | Implemented | `package.json` and `bun.lock` record direct and resolved language dependencies. |
| OSPS-QA-04.01 | Not applicable | This assessment covers the only repository currently declared for the product. Reassess if another code repository is added. |
| OSPS-QA-05.01 | Implemented | Official executables are CI outputs, not tracked source files. |
| OSPS-QA-05.02 | Partial | Product source does not require unreviewable binaries; contributor policy prohibits them without justification. Existing image fixtures must remain reviewable test inputs. |
| OSPS-VM-02.01 | Implemented | `SECURITY.md` provides the private security contact route. |

## Required external actions

Follow [`../security/repository-settings.md`](../security/repository-settings.md). Verify organization MFA, access, security features, billing alerts, and user documentation. Then reassess every row and retain links to the settings evidence.
