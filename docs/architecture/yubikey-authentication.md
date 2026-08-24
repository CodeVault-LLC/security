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

`WEBAUTHN_ORIGIN` must be the exact public HTTPS origin used by desktop clients,
and `WEBAUTHN_RP_ID` must be that hostname or a registrable suffix. Changing the
RP ID strands existing credentials, so an origin migration needs an overlap
plan before rollout. Loopback HTTP is accepted only for local development.

Attestation is deliberately `none`. CodeVault proves control of a FIDO2
credential but does not yet claim that it is a particular YubiKey model. A
future policy that promises hardware-only authentication must add attestation
metadata, privacy review, an allowlist lifecycle, and an exception/recovery
procedure first.

## What to implement next

The next slice should complete the policy and recovery story:

- Add WebAuthn step-up for sensitive actions, not only initial sign-in. The
  existing TOTP step-up remains available unless organization policy forbids it
  for the specific action.
- Add an organization policy requiring phishing-resistant authentication for
  administrators and, later, roles that can approve or disclose reports. Refuse
  to enable it until every affected active user has at least two usable keys or
  an approved recovery path.
- Require a fresh security-key assertion for credential changes, role and
  security-policy changes, disclosure approval, mail-provider authorization,
  export of especially sensitive material, and creation of persistent MCP
  grants when policy requires it.
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
