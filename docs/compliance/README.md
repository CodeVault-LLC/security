# Assurance evidence

These documents are versioned self-assessments for CodeVault Security. They map repository evidence to selected standards; they are not certifications, legal attestations, or substitutes for an independent assessment.

## Target profile

| Standard | Target | Current claim |
| --- | --- | --- |
| SLSA v1.2 Build | Level 3 | Target only. Verify a real release and its builder provenance before claiming the level. |
| SLSA v1.2 Source | Level 3 | Controls implemented in part. Required source provenance and VSA are not available. |
| NIST SP 800-218 SSDF | Version 1.1 | Task-level self-assessment with open gaps. |
| OWASP ASVS | Version 5.0.0 Level 3 | Target only. The requirement register currently records every requirement as a gap pending verification. |
| OpenSSF OSPS Baseline | 2026.02.19 Level 1 | Not achieved. Public-source and repository-setting controls remain open; licensing controls are implemented. |
| NIST SP 800-53 | Revision 5 Moderate | Responsibility mapping only. The operator must tailor, implement, and assess the deployment. |

The evidence index is in [`../security/security-evidence-index.md`](../security/security-evidence-index.md). Review these mappings after a material architecture, release, governance, or deployment change and at least annually.

## Status vocabulary

- **Implemented**: durable repository evidence exists, but an external run or assessment may still be needed.
- **Partial**: some evidence exists and a named gap remains.
- **External**: the control is implemented in a hosting, identity, signing, or deployment system outside this repository.
- **Gap**: the requirement is not yet evidenced.
- **Not applicable**: the requirement does not apply and the mapping explains why.

Only an accountable human may approve a legal or government attestation. AI can organize evidence and identify gaps, but it is not an independent reviewer or authorized signatory.
