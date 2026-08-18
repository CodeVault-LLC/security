# Vendor seed maintenance

Built-in vendors are conservative starting points, not live intelligence.
CodeVault never crawls or auto-updates a recipient, portal rule, cadence, or
key. A researcher must review the official source and the immutable route
snapshot before each disclosure.

## Current provenance

| Seed | Official source | Reviewed | Reviewer | Expected destination | Cadence | Route SHA-256 | PGP fingerprint |
| --- | --- | --- | --- | --- | --- | --- | --- |
| TP-Link Product Security email | `https://www.tp-link.com/uk/press/security-advisory/` | 2026-08-18 | CodeVault maintainer review | `security@tp-link.com` | 5 business-day acknowledgement; 42-day update | `2fc1253d3ce7317a621e8831fd0becba8f3011fecccec0ec208efe2df23cdc19` | Not seeded; user verification required |
| WordPress HackerOne submission | `https://make.wordpress.org/core/handbook/testing/reporting-security-vulnerabilities/` | 2026-08-18 | CodeVault maintainer review | `https://hackerone.com/wordpress` | 10 business-day reminder; no assumed update cadence | `c89fd996d160da752fd03e8bfd6b4729e49c29dd6daceebfb761287ceecd3c4d` | Not applicable |

The route digest is SHA-256 over the JSON route object in
`apps/server/src/startup/seed.ts`, including field order. It detects an
unreviewed template change; the database revision and per-submission route
snapshot remain the runtime authority.

No public key is shipped. A key copied from the same compromised page as a
recipient does not provide independent identity assurance. Add a key version,
compare its full fingerprint through an independent channel, record the source,
and explicitly verify that exact version before selecting it for a required-PGP
route.

## 180-day review gate

`bun run verify:env` fails when any built-in vendor or built-in route lacks an
official source/review timestamp or is older than 180 days. Runtime does not
rewrite modified records and never refreshes from the internet. To review:

1. Open the official source over independently trusted TLS and check redirects.
2. Confirm organisation ownership, recipient/portal, required fields, limits,
   encryption instructions, and response expectations.
3. Check a key fingerprint through a second channel; never infer or auto-import
   it from a page.
4. Update the route, review date, table above, and computed digest in one commit.
5. Run vendor integration and E2E tests, then have another maintainer review the
   provenance change.

Hummingbird is not automatically assigned to WordPress.org. It is maintained
by WPMU DEV, so the development fixture creates and links an explicit maintainer
vendor. For any real plugin, create/link the actual maintainer and choose its
current route. The WordPress.org seed is only appropriate where the official
WordPress security program actually owns intake.

