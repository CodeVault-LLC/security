# YubiKey authentication

## Implemented slice

CodeVault uses the WebAuthn/FIDO2 capability of a YubiKey. It does not use the
vendor-specific Yubico OTP protocol, and it does not copy private key material
into CodeVault. This keeps the authentication boundary standards-based and
also supports equivalent roaming FIDO2 security keys.

The implemented flow is:

1. A recently MFA-verified user registers a named, cross-platform security key
   from **Settings → Security**.
2. The server generates a one-time registration challenge. The desktop opens a
   hardened, ephemeral window at the configured relying-party origin and calls
   `navigator.credentials.create()` there.
3. The server verifies the origin, RP ID, challenge, user presence, signature,
   and credential response. It stores only the credential ID, public key,
   signature counter, transport hints, backup flags, and lifecycle metadata.
4. After password verification, accounts with a registered key can choose the
   key instead of TOTP. Successful assertions create sessions marked
   `WEBAUTHN`, update the signature counter atomically, and consume both
   one-time challenges.
5. Users can list and revoke their registered keys. Registration and
   revocation are audited. TOTP and recovery codes remain fallback factors.
6. An administrator can require phishing-resistant MFA for every active
   administrator. Enabling the rule requires two active keys per administrator,
   no pending administrator invitation, and a fresh WebAuthn assertion from the
   acting administrator. TOTP administrator sessions are revoked and subsequent
   administrator sign-in and protected actions require WebAuthn.
7. Authenticated WebAuthn step-up ceremonies are one-time, source-bound, and
   session-bound. A successful assertion updates only that session and is
   audited without credential material.

`WEBAUTHN_ORIGIN` must be the exact public HTTPS origin used by desktop clients,
and `WEBAUTHN_RP_ID` must be that hostname or a registrable suffix. Changing the
RP ID strands existing credentials, so an origin migration needs an overlap
plan before rollout. Loopback HTTP is accepted only for local development.

Attestation is deliberately `none`. CodeVault proves control of a FIDO2
credential but does not yet claim that it is a particular YubiKey model. A
future policy that promises hardware-only authentication must add attestation
metadata, privacy review, an allowlist lifecycle, and an exception/recovery
procedure first.

## Remaining release work

The next slice should complete the policy and recovery story:

- Extend phishing-resistant policy beyond the organization administrator role
  only when new global privileged roles are introduced. Case approval and
  disclosure remain capabilities rather than organization roles.
- Add administrator-assisted lost-key recovery with dual control, explicit
  notifications, session and MCP-token revocation, and a durable audit trail.
  Recovery codes should not silently satisfy a hardware-only policy.
- Add direct security-key enrollment during invitation and migrated-account
  onboarding, while retaining a well-defined TOTP transition path.
- Add end-to-end tests with Chromium virtual authenticators plus a release
  acceptance matrix for current USB-C, USB-A, and NFC YubiKeys on supported
  operating systems. Exercise cancellation, duplicate registration, counter
  replay, key loss, multiple keys, origin mismatch, and RP migration failure.
- Add WebAuthn support to terminal/MCP setup through a system-browser ceremony;
  never ask a CLI to read raw FIDO HID devices or persist browser session
  tokens.

Using YubiKey PIV or OpenPGP keys to sign reports or releases is a separate
capability from authentication. It may be valuable later, but it needs its own
key-purpose, PIN, rotation, backup, and verification design instead of reusing
the WebAuthn credential record.
