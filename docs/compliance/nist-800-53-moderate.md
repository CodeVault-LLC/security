# NIST SP 800-53 Rev. 5 Moderate responsibility mapping

Assessment date: 2026-08-20  
Sources: [NIST SP 800-53 Rev. 5](https://csrc.nist.gov/pubs/sp/800/53/r5/upd1/final) and [SP 800-53B Moderate baseline](https://csrc.nist.gov/pubs/sp/800/53/b/upd1/final)

This family-level map helps a deploying organization start control tailoring. It is not an authorization package, OSCAL system security plan, FedRAMP package, or certification. The operator remains responsible for selecting parameters, documenting inheritance, implementing the deployment, collecting evidence, and arranging assessment.

| Family | Primary responsibility | Product evidence and deployment work |
| --- | --- | --- |
| AC Access Control | Shared | Product roles, organization isolation, session checks, and least-privilege service identities; operator manages host, proxy, repository, and administrator access. |
| AT Awareness and Training | Operator | Train administrators, researchers, incident responders, and release staff. |
| AU Audit and Accountability | Shared | Product emits attributable audit events; operator centralizes, protects, retains, reviews, and alerts on logs. |
| CA Assessment, Authorization, and Monitoring | Operator | Use this evidence set as input to an organization-selected assessment and continuous-monitoring plan. |
| CM Configuration Management | Shared | Version-controlled configuration, digest-pinned images, immutable releases, and startup validation; operator controls approved baselines and exceptions. |
| CP Contingency Planning | Operator | Back up PostgreSQL, object storage, secrets, and proxy configuration; rehearse restoration and continuity. |
| IA Identification and Authentication | Shared | Passwords, MFA, recovery, invitations, and service credentials are product controls; operator enforces workforce identity and repository MFA. |
| IR Incident Response | Shared | Private reporting and evidence sources exist; operator defines contacts, escalation, communications, forensics, and exercises. |
| MA Maintenance | Operator | Control host, database, proxy, storage, and administrator maintenance sessions and tools. |
| MP Media Protection | Operator | Protect backups, exports, evidence files, removable media, and disposal. |
| PE Physical and Environmental Protection | Operator | Protect the facilities and hardware that run the deployment. |
| PL Planning | Shared | Threat model, security policy, governance, deployment guide, and mappings support the operator's system security plan. |
| PM Program Management | Operator | Establish organization-wide risk, supply-chain, privacy, and security programs. |
| PS Personnel Security | Operator | Screen, authorize, transfer, and terminate personnel with sensitive access. |
| PT PII Processing and Transparency | Shared | Product provides authorization and data handling controls; operator determines whether PII is processed and completes privacy analysis. |
| RA Risk Assessment | Shared | Product threat model, CodeQL, dependency review, Trivy, and audit evidence; operator performs system, environment, and privacy risk assessments. |
| SA System and Services Acquisition | Shared | SSDF, SBOM, provenance, release policy, and supplier inventory support acquisition; operator sets contractual and acceptance requirements. |
| SC System and Communications Protection | Shared | Network separation, cryptography, tenant controls, parser isolation, and TLS guidance; operator supplies validated boundary protection and key management. |
| SI System and Information Integrity | Shared | Security tests, scanning, VEX, vulnerability intake, and immutable updates; operator patches hosts and monitors the deployed system. |
| SR Supply Chain Risk Management | Shared | Pinned build inputs, SBOMs, attestations, signatures, and dependency updates; operator assesses suppliers and preserves provenance evidence. |

## Government profile decisions

- Treat FedRAMP as out of scope for the self-hosted product unless CodeVault operates a reusable cloud service for federal information.
- Determine FIPS-validated cryptography, CMMC, agency overlays, accessibility, records retention, export controls, and data residency from a concrete procurement and deployment.
- Only an authorized human or legal representative may sign the CISA secure-software attestation. Unmet practices require remediation or an agency-accepted private plan of action and milestones.
