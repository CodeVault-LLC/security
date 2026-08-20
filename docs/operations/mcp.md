# Use CodeVault from terminal AI clients

The CodeVault MCP server lets Codex CLI and Claude Code read and manage research
records from any terminal session. The desktop app does not need to be open.
The CodeVault server must be running and reachable.

The MCP server uses your CodeVault identity. Server-side role checks, case
permissions, validation, and audit records apply to every tool call.

The [generated tool inventory](mcp-tool-inventory.md) lists every discovered
tool, its effect annotation, and its registered purpose. Run
`bun run mcp:inventory:check` to confirm that the file matches the server.

## Sign in from the terminal

From the CodeVault Security repository, run:

```bash
bun run mcp:login
```

Enter your email, password, and TOTP code. The command stores the session token
in `~/.codevault-security/mcp-token` with mode `0600`. It does not store your
password or TOTP code.

For a remote server, pass its HTTPS URL:

```bash
bun run mcp:login -- --server https://security.example.com
```

The session follows the organization's normal idle and absolute expiry rules.
Run `bun run mcp:login` again after the session expires.

## Add CodeVault to Codex CLI

Run this command from the CodeVault Security repository:

```bash
codex mcp add codevault \
  --env CODEVAULT_URL=http://127.0.0.1:4310 \
  --env CODEVAULT_TOKEN_FILE="$HOME/.codevault-security/mcp-token" \
  -- bun run --cwd "$PWD/packages/mcp" start
```

Replace `CODEVAULT_URL` with the HTTPS URL that you used for terminal login
when CodeVault runs on another machine.

Run `codex mcp get codevault` to inspect the saved configuration. Start Codex
in any repository and ask it to check your CodeVault identity.

## Add CodeVault to Claude Code

Run this command from the CodeVault Security repository:

```bash
claude mcp add codevault --scope user \
  --env CODEVAULT_URL=http://127.0.0.1:4310 \
  --env CODEVAULT_TOKEN_FILE="$HOME/.codevault-security/mcp-token" \
  -- bun run --cwd "$PWD/packages/mcp" start
```

Replace `CODEVAULT_URL` with the same HTTPS URL that you used for terminal
login when CodeVault runs on another machine.

Start Claude Code in any repository. Run `/mcp` and confirm that `codevault`
is connected.

## Import repository findings

Ask Codex or Claude Code to inspect the repository and record the results. For
example:

```text
Inspect this repository for existing security findings in reports, Markdown,
JSON, and scanner output. Use the CodeVault tools.

Check my CodeVault identity first. Search for matching cases, vendors, assets,
and findings before creating records. Use stable identifiers when an asset has
one. Record each distinct root cause as a complete draft finding with its
primary asset, affected versions, CWE values, reproduction details, impact,
remediation, and uncertainties. Do not mark a finding validated, novel, fixed,
approved, disclosed, or published. At the end, list every record you created
and every file you could not classify.
```

The AI client can use the MCP tools to:

- find, create, and update cases, notes, readiness, stakeholders, embargoes,
  and disclosure events;
- find, create, and update vendors, contact routes, and verified public keys;
- find, create, and update assets, identifiers, versions, and relationships;
- find, create, and update findings, scores, real vulnerability identifiers,
  claims, and external references;
- create and update evidence records, upload local files, attach artifacts, and
  request short-lived artifact download URLs; and
- create, edit, lint, preview, approve, and export reports.

MCP write tools perform the requested operation immediately as the authenticated
CodeVault user. For example, `codevault_add_finding_score` creates a proposed
score unless `approve: true` is supplied, while
`codevault_approve_finding_score` approves an existing score immediately.
CodeVault still applies the same role checks, case permissions, optimistic
revision checks, validation, lifecycle rules, lint gates, and audit logging as
the desktop application.

`codevault_upload_evidence_file` reads the path on the machine running the MCP
process. It computes the SHA-256 digest locally, uploads the bytes directly to
the presigned object-storage URL without sending the CodeVault bearer token to
storage, completes the upload, and creates or updates the evidence attachment.

## Use another token file

To keep the token elsewhere, pass the same path to the login command and the
MCP registration command:

```bash
bun run mcp:login -- --token-file /secure/path/codevault-token

codex mcp add codevault \
  --env CODEVAULT_URL=http://127.0.0.1:4310 \
  --env CODEVAULT_TOKEN_FILE=/secure/path/codevault-token \
  -- bun run --cwd "$PWD/packages/mcp" start
```

For Claude Code, use:

```bash
claude mcp add codevault --scope user \
  --env CODEVAULT_URL=http://127.0.0.1:4310 \
  --env CODEVAULT_TOKEN_FILE=/secure/path/codevault-token \
  -- bun run --cwd "$PWD/packages/mcp" start
```

On macOS and Linux, the MCP server refuses a token file that group members or
other users can read or write.
