# Organization security model

CodeVault supports exactly one organization per deployment. The organization
is the ownership and read-clearance boundary for identities, policy, cases,
findings, evidence, activity, AI policy, and display avatars. There is no
organization switcher or generic organization landing screen.

## Roles and authority

Every active user has one organization membership. All active members can read
the full research corpus, including restricted cases and their reported
vulnerabilities. The roles differ in what they can change:

- `ADMIN` manages invitations, roles, disabled state, organization identity,
  session policy, and organization AI policy.
- `MEMBER` creates and edits research according to case ownership and explicit
  case grants, but cannot change organization-wide rules or identities.
- `VIEWER` is read-only across research and organization information.

Administrators cannot disable or demote themselves through the API. More
importantly, PostgreSQL checks the enabled-administrator invariant at commit,
so concurrent changes cannot both remove the last administrator.

## Authentication lifecycle

The first organization and administrator are created atomically with
`bun run admin:create`. Everyone else must use a single-use invitation.
Password verification creates only a short-lived MFA challenge. A session is
issued after a valid, previously unused TOTP counter is consumed in the same
transaction that rechecks the user, membership, and policy.

Recovery codes are single-use, keyed digests. Recovery revokes existing
sessions and permits only TOTP re-enrollment; the replacement authenticator
must be confirmed before ordinary access returns. Sensitive organization
changes require MFA within the policy's recent-verification window.

## UI and API boundaries

Organization information is categorized under `/organization/users`,
`/organization/settings`, and `/organization/security`, with user detail under
`/organization/users/$userId`. Personal controls live under
`/settings/profile`, `/settings/appearance`, and `/settings/security`.
Rendering controls is a usability boundary only; every mutation is authorized
again by the API.

## Display media

Avatar uploads are authenticated, bounded, and quarantined. A separate
least-privilege worker accepts only decoded JPEG or PNG and produces a small
metadata-free WebP. The API serves only a `READY` derivative with `nosniff`;
there is no route for raw avatar bytes.
