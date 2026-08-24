# Use CodeVault from terminal AI clients

The CodeVault MCP server lets Codex CLI and Claude Code read and manage research
records from any terminal session. The desktop app does not need to be open.
The CodeVault server must be running and reachable.

The MCP server uses your CodeVault identity. Server-side role checks, case
permissions, validation, and audit records apply to every tool call.

The [generated tool inventory](mcp-tool-inventory.md) lists every discovered
tool, its effect annotation, and its registered purpose. Run
`bun run mcp:inventory:check` to confirm that the file matches the server.

## Set up installed AI clients once

From the CodeVault Security repository, run:

```bash
bun run mcp:setup
```

The command detects Codex CLI and Claude Code. It asks for your CodeVault email,
password, and TOTP code once. It then creates a user-specific MCP connection and
adds CodeVault to each installed client at user scope.

The command stores the server URL and MCP credential in
`~/.codevault-security/mcp.json` with mode `0600`. It does not store your
password or TOTP code. The MCP credential has no idle timeout. It remains valid
until you revoke it, an administrator disables your account, or an administrator
blocks MCP for the organization. Changing your password also revokes every MCP
credential on your account.

For a remote server, pass its HTTPS URL:

```bash
bun run mcp:setup -- --server https://security.example.com
```

To configure only one installed client, pass either `--client codex` or
`--client claude`.

After setup, start the AI client in any repository and ask it to check your
CodeVault identity. There is no separate login or registration step.

You can run `bun run mcp:setup` again. If the saved connection still works, the
command reuses it without asking you to sign in. This makes it safe to repair or
add an AI client later.

Administrators control MCP under **Organization security**. Turning off
**Allow user-specific MCP connections** blocks all MCP credentials on their
next request. Interactive desktop sessions keep working.

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

## Use another configuration file

To keep the configuration elsewhere, pass its path to setup:

```bash
bun run mcp:setup -- --config /secure/path/codevault-mcp.json
```

The setup command records this path in each AI client's saved configuration.

For an automated installation, you can still provide the values through the
environment:

```bash
CODEVAULT_URL=https://security.example.com \
CODEVAULT_TOKEN=cv_mcp_replace_me \
bun run mcp:start
```

On macOS and Linux, the MCP server refuses a configuration or legacy token file
that other users can read or write. Existing `CODEVAULT_TOKEN_FILE`
installations continue to work during migration.
