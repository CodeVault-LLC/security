# AI expansion: intake, external agents, and model control

**Date:** 2026-08-16
**Status:** Phase 1, the Codex provider, and manual Phase 2 intake are
implemented. Folder intake in Phase 3 and scoped external-agent intake in Phase
4 are planned for `alpha.7`.

The repository also has an authenticated MCP domain interface. It performs
direct user-authorized operations and is separate from the scoped intake-token
design in Phase 4. See the [generated MCP inventory](../../operations/mcp-tool-inventory.md).

Adds three things CodeVault's AI layer cannot do today: import existing
findings from a folder on disk, receive findings from a Claude Code session
running outside CodeVault, and choose which model and reasoning effort a run
uses. Every one of them still terminates in a proposal a person accepts.

---

## 1. What exists, stated precisely

There is exactly one AI shape today, and it is worth naming before adding
others: **one-shot, context-out**.

The renderer names an action and a target. The server builds the context from
the database, filters it by audience and by provider policy, and returns a
prompt. The desktop client spawns `claude -p` with the prompt on stdin, an
empty environment plus an allow-list, a fresh temporary working directory and a
timeout. The output must parse as JSON and satisfy the action's TypeBox schema.
A valid output becomes a proposal carrying a patch, a rationale and the target
revision; accepting it checks permissions, checks the patch touches only the
action's declared fields, checks it touches nothing on
`AI_FORBIDDEN_PATCH_FIELDS`, asserts the revision, and writes in a transaction
with an audit event.

Fifteen actions. No prompt from the client, no command, no working directory,
no provider arguments. Data flows out of CodeVault and text comes back.

That shape is right for drafting and review, and nothing here weakens it. But
two of the three features below need data to flow *in* — from files the
researcher points at, and from a process CodeVault does not control. Those are
different trust boundaries and they get their own machinery rather than a new
row in `AI_ACTIONS`.

## 2. The rule that makes the new shapes safe

**Everything new lands in an intake queue. Nothing new writes canonical data.**

A folder scan does not create findings. An external scanning agent does not
create findings. Both write `ai_intake_item` rows that a researcher reviews with
Accept, Edit, Reject and Merge — the same posture as `ai_proposals`, applied to
records that do not exist yet rather than records being changed.

This means `AI_FORBIDDEN_PATCH_FIELDS` holds by construction on the new paths:
the only table the new writers can reach has no state column to set. An accepted
intake item creates a finding in its initial state. It cannot arrive
`HUMAN_CONFIRMED_NOVEL`, cannot arrive with a disclosure state, cannot arrive
approved.

## 3. Architecture

| Unit | Path | New? |
|------|------|------|
| Run profiles | `packages/contracts/src/ai.ts`, `packages/ai/src/actions.ts` | extends |
| Provider argv builder | `apps/desktop/src/main/agents/claude-code.ts` | extends |
| Intake tables | `packages/db/src/schema/intake.ts` | new |
| Intake API | `apps/server/src/modules/intake/` | new |
| Intake review UI | `apps/desktop/src/renderer/src/features/intake/` | new |
| Folder scan | `apps/desktop/src/main/agents/folder-scan.ts`, `ipc.ts` | new |
| Intake tokens | `apps/server/src/modules/auth/intake-tokens.ts` | new |
| MCP server | `packages/mcp/` | new |
| Claude skill | `skills/codevault-record-findings/` | new |

Four phases, in this order. Phase 2 before 3 and 4 is the load-bearing
sequencing decision: both new inputs land in the same queue, so the queue and
its review screen must exist before anything writes to them.

### 3.1 Two local providers, two independent configurations

CodeVault supports both Claude Code and Codex CLI through fixed provider
definitions in reviewed source. A provider definition owns its model IDs,
supported effort levels, default model, settings-isolation semantics and CLI
adapter. Model IDs are not one global enum: a Claude model is invalid for the
Codex provider and a Codex model is invalid for Claude Code.

Both providers implement the same narrow lifecycle: detect the executable,
receive a server-resolved run profile and server-built prompt, execute locally
without a shell, return one schema-constrained answer, and report accounting
metadata when their CLI exposes it. Neither provider may choose its context,
action, output schema or tool policy.

Codex runs through `codex exec` with stdin, a fresh temporary working root,
`--sandbox read-only`, `--ephemeral`, `--ignore-user-config`, `--ignore-rules`,
`--skip-git-repo-check`, a temporary `--output-schema` file and a temporary
`--output-last-message` file. Its reasoning effort is passed as a validated
configuration value. This permits the researcher's existing Codex CLI login
without loading repository instructions, user configuration or persistent
session state into a CodeVault run.

Workspace policy remains per provider. Enabling Claude does not enable Codex;
each gets its own visibility rules, restricted-case permission, model and
effort allow-lists, defaults and retention settings. The toolbar selects a
provider first and then presents only that provider's models and effort levels.

---

## 4. Phase 1 — Model, effort and run profiles

### 4.1 What the CLI actually supports

Verified against the installed `claude` binary rather than assumed:

| Flag | Values | Use here |
|------|--------|----------|
| `--model <m>` | alias (`opus`, `sonnet`, `haiku`, `fable`) or full ID | model selection |
| `--effort <l>` | `low`, `medium`, `high`, `xhigh`, `max` | reasoning depth |
| `--json-schema <s>` | a JSON Schema | constrains output shape |
| `--output-format <f>` | `text`, `json`, `stream-json` | result envelope with usage and cost |
| `--tools <t...>` | tool names, `default`, or `""` for none | capability scoping |
| `--allowedTools` / `--disallowedTools` | tool patterns | finer scoping |
| `--add-dir <d...>` | directories | grants read access outside cwd |
| `--setting-sources <s>` | `user`, `project`, `local` | which settings files load |
| `--bare` | — | skips hooks, plugins, CLAUDE.md discovery, keychain |
| `--max-budget-usd <n>` | dollars | per-run cost ceiling (`--print` only) |
| `--permission-mode <m>` | incl. `plan`, `dontAsk` | tool-permission posture |

Today the adapter passes `["-p"]` and nothing else. Four of these are worth
adopting for the *existing* fifteen actions before any new feature ships.

### 4.2 `--tools ""` closes a real gap

The current adapter's isolation story is "a fresh temporary working directory,
so a provider that reads its surroundings finds nothing of consequence." That
is true of the working directory and false of the workstation: the spawned
Claude Code still has `Bash`, `Read`, `WebFetch` and the rest, and `HOME` is on
the environment allow-list. A drafting action has no legitimate use for any of
them.

Pass `--tools ""` for every context-out action. The prompt is self-contained by
design; the model has no reason to touch the filesystem or the network. This
converts "nothing interesting is nearby" into "there is no mechanism."

### 4.3 `--json-schema` makes invalid output rare instead of routine

`AI_ACTIONS[id].outputSchema` is a TypeBox `TSchema`, which is already JSON
Schema. Pass it straight to `--json-schema` and pair it with
`--output-format json`.

Server-side validation stays exactly as it is and remains the authority. The
CLI's constraint is a convenience that stops a well-formed run from being
recorded as a failure over a missing field; it is not a control, and the server
must never treat a run as valid because the CLI said so.

Adopting `--output-format json` changes the parse path: `stdout` becomes an
envelope rather than the action's JSON directly. The submit route unwraps it,
and gains `costUsd` and token usage for free — both worth storing.

### 4.4 Settings isolation: a decision, not a recommendation

`--bare` skips hooks, plugin sync, CLAUDE.md auto-discovery and keychain reads.
That is a direct match for the threat model — without it, a `PreToolUse` hook in
the researcher's own `~/.claude/settings.json` runs inside every CodeVault AI
run.

But `--bare` forces authentication through `ANTHROPIC_API_KEY` or an
`apiKeyHelper`: OAuth and keychain are never read. A researcher signed in with a
Claude subscription would simply stop being able to run AI actions.

So: **`--bare` is a workspace policy toggle, default off**, documented as
requiring API-key auth. `--setting-sources user` is the narrower default — it
keeps the researcher's own configuration while ignoring project and local
settings files. That distinction becomes critical in Phase 3, where the working
directory may contain files supplied by a research target.

### 4.5 The run profile

A new contract type, all enums and bounded numbers, no free strings:

```ts
export const AiRunProfile = Type.Object({
  model: AiModelSchema,          // enum of allow-listed aliases and IDs
  effort: AiEffortSchema,        // low | medium | high | xhigh | max
  toolPolicy: AiToolPolicySchema,// NONE | READ_ONLY
  settingSources: Type.Array(...),
  maxBudgetUsd: Type.Optional(Type.Number({ minimum: 0, maximum: 50 })),
  timeoutMs: Type.Integer({ minimum: 10_000, maximum: 1_800_000 }),
});
```

It is resolved in three layers, narrowest last:

1. **Action default.** `AiActionDefinition` gains `defaultProfile`. This is the
   highest-leverage change in the phase and it belongs in the reviewed registry,
   not a settings screen: `FINDING_DRAFT_TITLE` is fine at `low`;
   `FINDING_SUGGEST_CVSS40`, `REPORT_LEAK_REVIEW` and `FINDING_FACT_CHECK` are
   the actions where a wrong answer costs the most and deserve `xhigh`.
2. **Workspace policy.** `ai_provider_policies` gains `allowedModels`,
   `allowedEfforts`, `defaultModel`, `defaultEffort`, `maxBudgetUsd`. A model
   outside the allow-list is refused server-side with the same shape as
   `ProviderPolicyError` — a policy that forgets to list a model disables it,
   consistent with the existing rule that a provider with no policy is disabled.
3. **Per-run override.** The toolbar offers model and effort, bounded by the
   policy allow-list, defaulting to the action's profile.

### 4.6 Audit: which model wrote this?

`ai_runs` records `providerVersion`, which is the *CLI* version. There is
currently no way to answer "which model produced this proposal" — a real gap
once a workspace runs more than one.

Add `model`, `effort`, `costUsd`, `inputTokens`, `outputTokens` to `ai_runs`.
Show the model on each proposal in the review UI and in the run history. A
disputed acceptance six months from now should be able to name the model.

### 4.7 Surfaces

- `ai-toolbar.tsx`: a compact model/effort control beside the AI label, matching
  the existing density. Not per-button — one selector for the toolbar, remembered
  per session.
- `SettingsRoute` in `routes/misc.tsx`: allow-listed models, allowed efforts,
  defaults, budget ceiling, and the `--bare` toggle with its auth caveat spelled
  out inline.
- Proposal cards and the run list: model badge.

### 4.8 Migration

Hand-written SQL per repo convention: five columns on `ai_runs`, five on
`ai_provider_policies`. Backfill `model` as `NULL` — an unknown model on a
historical run is the honest value.

---

## 5. Phase 2 — The intake queue

Build this before anything writes to it, with a manual "record a finding I
already have" entry point so the review screen exists and is exercised before
Phase 3 or 4 land.

### 5.1 Tables

```
ai_intake_batches
  id, caseId, source (FOLDER_SCAN | EXTERNAL_AGENT | MANUAL),
  sourceLabel, runId (nullable → ai_runs), manifest (jsonb),
  status, createdBy, createdAt

ai_intake_items
  id, batchId, status (PENDING | ACCEPTED | REJECTED | MERGED),
  draft (jsonb), citations (jsonb), confidence,
  createdFindingId (nullable), mergedIntoFindingId (nullable),
  reviewedBy, reviewedAt, rejectionReason, createdAt
```

`draft` holds the proposed finding fields — title, the four markdown sections,
suggested CWEs, affected-version claims. `citations` holds
`{path, sha256, lines}` per supporting file or artifact.

### 5.2 Review screen

A new destination, or a tab on the case detail — the sidebar's "nine
destinations, not one per database table" rule argues for the latter, and intake
is genuinely case-scoped. Per item:

- the drafted finding, editable in place, using the existing markdown field
- the cited sources beside it, so a claim and its evidence are on one screen
- **Accept** — creates the finding, uploads and attaches the cited files as
  evidence through the existing artifact path, records an audit event naming the
  reviewer, the batch and the run
- **Edit** — the same, after the researcher's changes
- **Reject** — with a reason
- **Merge into existing finding** — for the common case where a scan
  rediscovers something already recorded; opens a finding picker and appends the
  new evidence rather than creating a duplicate

### 5.3 Accepting must not shortcut evidence

An accepted item runs the real upload path in `file-uploads.ts`: S3, SHA-256,
visibility, audit event. The hash recorded at scan time is re-verified at upload
and a mismatch fails the acceptance loudly. Provenance is the product's third
principle and an import path is exactly where it would quietly erode.

---

## 6. Phase 3 — Importing a folder

The ask: point CodeVault at a directory of existing findings — old markdown
notes, scanner JSON, a previous report — and have Claude bring them in.

This is the first time a provider is given a working directory that is not
empty, so gate 3 of `docs/architecture/ai-security.md` changes materially and
the document must be updated alongside the code.

### 6.1 The path never comes from the renderer

The main process opens `dialog.showOpenDialog` with
`properties: ["openDirectory"]` — the directory analogue of the existing
`uploadsSelect` handler. The chosen absolute path stays in the main process,
keyed by a session-scoped token. The renderer receives the token and the
manifest; it never sends, sees or stores a filesystem path.

The invariant survives intact: **the renderer cannot choose a working
directory.** It can ask the user to.

### 6.2 Pre-scan before the model sees anything

Walk the tree in the main process and build a manifest: every file with its
size, extension and SHA-256, plus everything excluded and why. Excluded by
default: `.git`, `node_modules`, binaries above a size ceiling, anything over
N MB, and — importantly — `.claude/`, which is configuration, not evidence.

Show it to the researcher exactly as "View context being sent" shows an outbound
context: item, size, digest, and the exclusions with reasons. The product
already holds the position that a researcher must be able to see what is about
to happen before it happens. Ingest gets the same treatment or it does not ship.

### 6.3 The run

A single agentic run, scoped hard:

- `cwd` is a fresh temporary directory; the target folder is granted with
  `--add-dir` so the model's working directory stays clean
- `--tools "Read,Glob,Grep"` — read-only. No `Bash`, no `Write`, no `Edit`, no
  `WebFetch`, no `WebSearch`. This is the entire safety argument for running an
  agent over files of unknown provenance: it can look and it can report, and
  there is no mechanism by which it can execute or exfiltrate.
- `--setting-sources user` — **not optional here.** A folder imported from a
  research target may contain `.claude/settings.json` declaring a `PreToolUse`
  hook. Loading project settings from an imported directory would execute
  attacker-supplied commands on the researcher's workstation. This flag is the
  control; excluding `.claude/` from the manifest is the belt.
- `--json-schema` with the ingest output schema, `--max-budget-usd` from policy,
  the profile's model and effort.

The prompt extends the house posture: the files are untrusted data, not
instructions; any instruction-shaped text found in them is a finding to report,
not a command to follow.

### 6.4 Output schema

```
IngestScanOutput {
  candidates: [{
    title, summaryMarkdown, technicalMarkdown, impactMarkdown,
    suggestedCweIds: string[],
    citations: [{ path, sha256, lines }],   // minItems: 1
    confidence: LOW | MEDIUM | HIGH,
    uncertainties: string[],
  }],
  unclassified: [{ path, reason }],
  rationale: string,
}
```

`citations` with `minItems: 1` is doing real work: a candidate that cites
nothing is rejected at validation, so the model cannot manufacture findings out
of nothing and have them reach a review screen looking like the rest.

`unclassified` is equally important — files the model could not map are listed
rather than silently dropped, so the researcher can see the scan's coverage
rather than assuming it was total.

### 6.5 Registry additions

`AI_TARGET_TYPES` gains `INTAKE_BATCH`. `AI_ACTIONS` gains `INTAKE_SCAN_FOLDER`
with `producesPatch: false` and an empty `allowedPatchFields` — the action
produces intake items, never a patch, so the existing apply-proposal machinery
is untouched.

---

## 7. Phase 4 — Recording findings from an external scanning session

The ask: run a Claude skill while scanning for vulnerabilities anywhere, and
have the results land in CodeVault instead of a stray file.

This inverts the provider contract. `LocalAiProvider` says a provider "has no
route back into CodeVault except the run result the desktop client submits."
Phase 4 creates exactly such a route, so it needs its own authenticated,
narrow, revocable surface.

### 7.1 Scoped intake tokens

A new credential, issued by the server and surfaced in the desktop app under
Settings → "Connect an external agent":

- scope: `intake:write` and `case:read` for one named case
- an expiry, default short
- listed, revocable, and every use audited with the token's identity

Not the researcher's session token. A process CodeVault does not control gets a
credential that can propose and read, and can do nothing else.

### 7.2 The MCP server

`packages/mcp` — a local stdio (or loopback-only HTTP) MCP server the external
Claude Code session connects to. Four tools, chosen for what they *cannot* do:

| Tool | Effect |
|------|--------|
| `codevault_list_cases` | read; lets the agent target the right case |
| `codevault_search_prior_art` | read; lets it check the corpus before proposing a duplicate |
| `codevault_propose_finding` | writes one `ai_intake_item`; returns its ID |
| `codevault_attach_evidence` | uploads an artifact against an intake item |

There is no `codevault_create_finding`, no state transition, no scoring, no
approval, no publish. The two product rules are expressed here as the shape of
the tool surface rather than as a check inside it.

`codevault_search_prior_art` is not a convenience: without it a scanning agent
proposes the same three findings on every run, and the intake queue becomes
noise the researcher stops reading.

### 7.3 The skill

`skills/codevault-record-findings/SKILL.md`, shipped in the repository and
installable into the researcher's `~/.claude/skills/`. It carries:

- when to trigger — on finding a vulnerability during a scan, review or audit
- record it in CodeVault via the MCP tools rather than writing a local report
- how to structure a finding: the title convention from
  `FINDING_DRAFT_TITLE`'s prompt, evidence expectations, one finding per root
  cause
- the posture rules, verbatim from `SYSTEM_INSTRUCTION`: do not assert that
  something is novel, previously unknown, fixed or safe to publish; those are
  conclusions a person records
- check prior art before proposing

The skill is the part that answers the actual request — the MCP server makes it
*possible*, the skill makes it *automatic*.

The posture rules now live in two places. Generate `SKILL.md`'s rules section
from `packages/ai/src/prompts/index.ts` at build time, or the two drift and the
external path quietly becomes the lenient one.

### 7.4 Notification

The desktop app badges the case when intake items arrive from an external agent
— "3 findings proposed from a scan, 10 minutes ago" — landing the researcher in
the same review screen built in Phase 2.

### 7.5 Does this work with the desktop app closed?

It should. That argues for the MCP server authenticating directly against the
API with a server-issued token rather than proxying through the Electron main
process. A scan running overnight on a build box should be able to file its
findings.

---

## 8. What this changes in the documented rules

`docs/architecture/ai-security.md` needs revision, not a footnote:

- **Gate 1** ("the action must exist") now has a second form: the MCP tool
  registry. The document should present both as instances of the same rule —
  a fixed table of capabilities added in reviewed commits, never a
  general-purpose command runner.
- **Gate 3** ("the provider runs locally, narrowly") gains the ingest case: a
  researcher-chosen directory, read-only tools, no project settings. The
  sentence "a fresh temporary working directory" stops being universally true
  and must say when and why.
- **"What AI can never write"** gains a paragraph: the intake queue is not
  canonical data, and an accepted intake item creates a finding in its initial
  state.
- **"Adding a provider"** gains "Adding an intake source," with the same
  posture.

`README.md`'s two rules survive unchanged, which is the point of §2. Its layout
section gains `packages/mcp` and `skills/`.

## 9. Open decisions

1. **Auth mode.** Does the workstation's Claude Code authenticate by OAuth
   (subscription) or API key? This determines whether `--bare` is usable at all,
   and it is the only Phase 1 item that can block.
2. **Per-run override or admin-fixed?** Recommendation: action default, policy
   allow-list, optional per-run override. A researcher who cannot raise effort
   on a hard CVSS call will work around the tool.
3. **Where does intake live in the UI?** Recommendation: a tab on case detail,
   not a tenth sidebar destination. Intake is case-scoped and the sidebar rule
   was already spent once on Metrics.
4. **A second provider — the Anthropic API directly?** Recommendation: no. The
   CLI already gives model, effort, schema-constrained output and tool scoping,
   and it uniquely gives the agentic file-reading Phases 3 and 4 depend on. A
   direct-API provider would add a second auth story for no capability gain.

## 10. Sequencing summary

| Phase | Delivers | Blocked by |
|-------|----------|------------|
| 1 | Model/effort control, tool scoping, schema-constrained output, cost and model in the audit trail | decision 1 |
| 2 | Intake tables, review screen, accept → create finding + evidence | — |
| 3 | Folder import | 2 |
| 4 | Intake tokens, MCP server, Claude skill | 2 |

Phase 1 stands alone and improves the fifteen existing actions immediately.
Phases 3 and 4 are independent of each other and both depend on 2.
