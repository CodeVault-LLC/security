# OWASP ASVS 5.0.0 Level 3 target

Assessment date: 2026-08-20  
Authority: [OWASP Application Security Verification Standard 5.0.0](https://github.com/OWASP/ASVS/tree/v5.0.0_release/5.0)

ASVS Level 3 is the target because the product stores unpublished vulnerability details, credentials, evidence, and cross-organization data. The project does **not** currently claim ASVS conformance.

[`asvs-5.0.0-l3.csv`](asvs-5.0.0-l3.csv) is the normative requirement register for this repository. It contains all 345 requirements from the official v5.0.0 flat JSON, pinned to the `v5.0.0_release` tag. Every record begins as **Gap**. Change a record to **Pass** or **Not applicable** only after a human verifier adds a durable code, test, or document reference; every **Not applicable** decision needs a product-specific reason.

## Chapter readiness

| Chapter | Current evidence | Assessment state |
| --- | --- | --- |
| V1 Encoding and Sanitization | Parameterized database access, Markdown sanitization, filename/path checks, and export controls exist. | Requirement verification pending. |
| V2 Validation and Business Logic | TypeBox contracts, domain-state rules, authorization checks, and bounded input are tested. | Requirement verification pending. |
| V3 Web Frontend Security | Hardened Electron boundaries, browser response headers, and renderer isolation exist. | Requirement verification pending. |
| V4 API and Web Service | Authenticated APIs, organization context, request schemas, and rate limits exist. | Requirement verification pending. |
| V5 File Handling | Multipart limits, archive checks, storage indirection, and isolated image decoding exist. | High-priority verification area. |
| V6 Authentication | Password hashing, mandatory MFA, recovery codes, throttling, and invite controls exist. | High-priority verification area. |
| V7 Session Management | Server-derived identity, cookie/session lifetimes, invalidation, and organization context exist. | High-priority verification area. |
| V8 Authorization | Role and organization isolation tests exist across services and SQL paths. | High-priority verification area. |
| V9 Self-contained Tokens | Mail token keyrings and scoped application tokens exist. | Requirement verification pending. |
| V10 OAuth and OIDC | Gmail OAuth is optional and validates redirects and provider boundaries. | Requirement applicability and verification pending. |
| V11 Cryptography | Authenticated encryption, versioned keyrings, fail-closed parsing, and rotation tools exist. | Independent cryptographic review pending. |
| V12 Secure Communication | Production guidance requires TLS at the reverse proxy; internal Compose networks are isolated. | Shared product/operator control. |
| V13 Configuration | Startup validation, file-backed secrets, read-only containers, dropped capabilities, and resource limits exist. | Production smoke test pending. |
| V14 Data Protection | Visibility rules, export gates, tenant checks, audit events, and private storage exist. | Requirement verification pending. |
| V15 Secure Coding and Architecture | Threat models and explicit AI, media, organization, and release boundaries exist. | Independent review pending. |
| V16 Security Logging and Error Handling | Structured logging and attributable audit events exist. | Retention, alerting, and operational verification pending. |
| V17 WebRTC | The product does not intentionally provide WebRTC functionality. | Mark individual requirements N/A only after confirming no transitive use. |

## Completion criteria

Level 3 can be claimed only when every applicable Level 1, 2, and 3 requirement is **Pass**, all exclusions are justified, tests identify the assessed release, and an independent human assessment has reviewed the result. AI review can assist but cannot supply assessment independence.
