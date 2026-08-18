# Gmail integration operations

Gmail is an optional delivery and tracked-reply transport, not a general mail
client. CodeVault asks for the least capability selected by the user: identity
and `gmail.send` for delivery, and `gmail.readonly` only when tracked replies
are enabled. Even with the restricted read scope, the worker fetches metadata
first and downloads raw content only after the provider thread ID matches a
CodeVault submission.

## Google Cloud ownership and consent

Use an organisation-owned Google Cloud project with at least two trusted
owners. Never use a researcher's personal project. Configure an OAuth desktop
or web client with the exact callback shown in CodeVault; production callbacks
must be HTTPS. Loopback HTTP is accepted only for the local desktop callback.

Choose internal app mode when every mailbox is in one Workspace organisation.
External mode requires the appropriate Google verification for sensitive or
restricted scopes. Reply tracking uses `gmail.readonly`, a restricted scope;
confirm the current verification and independent security-assessment
requirements before enabling it. Delivery-only deployments can omit tracking.

Primary references: [OAuth installed-app and PKCE guidance](https://developers.google.com/identity/protocols/oauth2/native-app),
[Gmail scopes](https://developers.google.com/workspace/gmail/api/auth/scopes),
[message sending](https://developers.google.com/workspace/gmail/api/guides/sending),
and [push notifications](https://developers.google.com/workspace/gmail/api/guides/push).

## Required configuration

```dotenv
GMAIL_ENABLED=true
GMAIL_CLIENT_ID=...
GMAIL_CLIENT_SECRET=...
GMAIL_REDIRECT_URI=https://codevault.example/v1/mail/gmail/callback
MAIL_TOKEN_KEYRING=1:<base64-32-byte-key>
MAIL_ACTIVE_TOKEN_KEY_VERSION=1
```

For push delivery, set all three or none:

```dotenv
GMAIL_PUBSUB_TOPIC=projects/PROJECT/topics/codevault-gmail
GMAIL_PUBSUB_AUDIENCE=https://codevault.example/v1/mail/gmail/pubsub
GMAIL_PUBSUB_SERVICE_ACCOUNT_EMAIL=gmail-api-push@system.gserviceaccount.com
```

Grant the Gmail publisher identity permission to publish to the topic. The API
verifies Google's OIDC signature, issuer, exact audience, and exact service
account before accepting a notification. It stores only the notification ID, a
keyed email hash, the history cursor, and the outcome. Ten-minute polling is the
fallback and also covers missed push delivery.

`GMAIL_E2E_BASE_URL` is deliberately rejected unless `NODE_ENV=test`, and then
accepts exact loopback HTTP only. Production has no configurable Gmail API
host, preventing a configuration mistake from turning refresh tokens over to
an attacker-controlled endpoint.

## Sender identity and delivery

CodeVault derives `From` from the connected, verified Google identity. A sealed
message with a duplicate, folded, or different `From` header is refused. If
aliases are enabled in a future UI, accept only verified Gmail `sendAs`
identities returned by Google; never accept an address typed into a send form.

The native confirmation displays From, To, CC, subject, body, attachment names,
digests, and cryptographic mode. Confirmation cannot be invoked through generic
renderer IPC. Sending uses a stable RFC `Message-ID` and reconciles before and
after the Gmail call. A timeout becomes `DELIVERY_UNKNOWN` and is never retried
automatically; a human must reconcile it to avoid duplicate disclosure.

Gmail attachment and blocked-file rules still apply after CodeVault's own size
and visibility gates. Watch quota and send quota failures are surfaced as
operational state; they do not weaken validation or switch transport.

## Token custody, rotation, and revocation

Refresh tokens are AES-256-GCM encrypted with associated data binding the
provider, connection, and owner. Keep `MAIL_TOKEN_KEYRING` in a secrets manager,
not a Compose file or repository. To rotate:

1. Add a new 32-byte key under a new integer version and set it active.
2. Restart the API and worker.
3. Run `bun run mail:rewrap-tokens` and confirm every active connection moved.
4. Retain the old key until backups containing old ciphertext have expired.
5. Remove the old key and run `bun run verify:env`.

Disconnect first stops the watch, revokes the Google token, and then removes the
connection. If a token may have leaked, revoke the OAuth grant in Google Admin,
rotate the client secret when appropriate, rotate the CodeVault token key,
invalidate affected sessions, inspect immutable audit and sync events, and
notify the case owners. Treat every tracked, restricted submission as possibly
exposed until investigation proves otherwise.

## Watch and cursor recovery

The worker renews watches daily before expiry. `WATCH_EXPIRED` and
`REAUTH_REQUIRED` appear on the dashboard. When Gmail returns 404 for an old
history cursor, recovery enumerates messages only inside already tracked thread
IDs and then advances to the current profile cursor. It never performs a full
mailbox search. Revoked tokens stop sync and require an explicit reconnect.

## Pre-release checks

Run `bun run verify:env` and the two fake-provider E2E tests. Confirm the fake
endpoint is absent in production, TLS terminates at the configured public
callback, Pub/Sub OIDC reaches the exact audience, and no real address or Google
credential occurs in test configuration.
