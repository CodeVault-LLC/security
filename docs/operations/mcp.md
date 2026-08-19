# Use CodeVault from terminal AI clients

The CodeVault MCP server lets Codex CLI and Claude Code read and create research
records from any terminal session. The desktop app does not need to be open.
The CodeVault server must be running and reachable.

The MCP server uses your CodeVault identity. Server-side role checks, case
permissions, validation, and audit records apply to every tool call.

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

- find and create cases;
- find and create vendors;
- find and create assets with stable identifiers;
- find and read findings; and
- create complete draft findings with asset links and affected-version ranges.

The MCP server does not expose tools for validation, approval, disclosure,
publication, deletion, or score approval. Complete those decisions in
CodeVault after you review the imported records.

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
