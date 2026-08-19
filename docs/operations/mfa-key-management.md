# MFA key management

`MFA_ENCRYPTION_KEYS` is a newest-first comma-separated keyring. Each entry is
`key-id:base64`, where the decoded value is exactly 32 random bytes. Generate a
key with `openssl rand -base64 32`; store it in the deployment secret manager,
never in source control, logs, shell history, tickets, or database backups.

The value is deliberately strict: each Base64 value must be the unmodified
44-character output of `openssl rand -base64 32`, including its trailing `=`.
Do not use URL-safe Base64, remove the padding, add whitespace, or include more
than one `:` in an entry. A valid single-key value has this shape:

```sh
MFA_ENCRYPTION_KEYS=v1:<output-of-openssl-rand--base64-32>
```

For multiple keys, put the new active key first and separate entries with a
comma, with no spaces:

```sh
MFA_ENCRYPTION_KEYS=v2:<new-key>,v1:<previous-key>
```

The repository's `.env.example` intentionally leaves this required secret
unset. Generate and store a distinct key rather than copying a shared example
value.

## Rotation

1. Back up PostgreSQL and confirm restore procedures.
2. Add a new unique key ID and random key at the beginning of the keyring while
   retaining every key still referenced by `totp_credentials`.
3. Restart the API and run `bun run verify:env`.
4. Run `bun run mfa:rotate-key -- --dry-run`, review counts, then run the same
   command without `--dry-run`.
5. Confirm no credential references the retired key before removing it, then
   restart and run the environment check again.

The rotation command reports identifiers and counts only. It must never print
plaintext TOTP secrets, provisioning URIs, OTPs, or recovery codes.

## Loss and compromise

Losing every referenced key makes affected TOTP credentials unrecoverable; use
the controlled recovery/re-enrollment process rather than attempting to expose
secrets. Suspected key compromise requires rotating the installation key,
revoking sessions, notifying users, and requiring authenticator re-enrollment.
TOTP is not phishing-resistant, so the long-term migration target is
WebAuthn/passkeys.

## Existing-account enrollment

Migration 0004 revokes legacy password-only sessions. On the next successful
password check, an account without a TOTP credential receives a short-lived,
source-bound `MIGRATED_ENROLLMENT` challenge. The desktop completes a one-time
TOTP setup, displays ten recovery codes once, and then requires a normal
password-plus-TOTP sign-in. The enrollment challenge never creates a session
and is consumed before the secret is issued.

The bootstrap CLI refuses to print its TOTP seed, provisioning URI, or recovery
codes to a captured stderr unless the operator explicitly supplies
`--allow-noninteractive-secret-output`. On an interactive terminal it renders
the provisioning URI as a QR code and prints the manual secret as a fallback.
