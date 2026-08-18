# AI security

CodeVault uses AI for the repetitive parts of research writing. It does not use
AI to decide anything. This document explains how that separation is built
rather than merely intended.

## The rule

**AI drafts; humans own truth.**

A model may propose text, a classification, CVSS metrics, a prior-art
comparison or a rewrite. It cannot record that a finding is novel, confirmed,
fixed, approved or ready to publish. Those are the claims a researcher puts
their name to, and the system refuses to let anything else write them.

## Four gates

Every AI interaction passes through four checks, in order. Each is independent;
a failure at any one stops the interaction.

### 1. The action must exist

The renderer sends an action identifier and a target. It cannot send a prompt, a
command, a provider argument or a working directory. The full set of actions is
the table in `packages/ai/src/actions.ts`; adding a capability means adding a row
there, in a reviewed commit.

### 2. The context is filtered before it is built

The server assembles the context from the database, tags every item with its
real visibility, and filters it twice:

- **By audience.** Report actions inherit the audience of the report being
  written, so drafting a public advisory sees PUBLIC material only. Finding
  actions build an INTERNAL context, because the researcher already has full
  access to their own case.
- **By provider policy.** A workspace states which visibilities a provider may
  ever receive and whether it may touch restricted cases at all. A provider with
  no policy is disabled: forgetting to configure something must not be the same
  as approving it.

Filtering is a data transformation. The prompt does say the context is untrusted
and must not be treated as instructions — that helps against a payload embedded
in an HTTP capture trying to steer the model — but it is defence in depth, not
the control. The control is that the data is not in the prompt.

The researcher can inspect what would be sent before sending it: every item, its
kind, its visibility, its digest and its size, plus everything the policy
excluded and why.

### 3. The provider runs locally, narrowly

CodeVault has fixed adapters for `claude -p` and `codex exec`. Both are spawned
with `shell: false`, prompt on stdin, an empty environment plus an allow-list, a
fresh temporary working directory, a timeout, and cancellation that terminates
the process group. Output is scanned for credential-shaped strings and redacted
before it is stored.

**The argument vector is part of this gate.** It is not assembled on the
workstation: the server resolves a *run profile* — model, reasoning depth, tool
capability, settings scope, spend ceiling — from the action's declared needs and
the workspace policy, and the desktop client carries it out. Every value is an
enum validated against an allow-list, so there is no path by which a string
chosen in the renderer becomes an argument.

Provider, model and effort are separate policy dimensions. Each provider owns a
reviewed model catalog and its own policy row; enabling or configuring Claude
does not approve Codex, and a model belonging to one provider is rejected for
the other.

Two parts of execution are controls rather than preferences:

- **Tool isolation.** Every action in the registry declares
  `toolPolicy: "NONE"`. Claude Code is spawned with the tool set explicitly
  emptied. The empty
  working directory used to be the whole isolation story, which only ever meant
  "there is nothing interesting nearby" — the model still had a shell, a file
  reader and network access, and `HOME` is on the environment allow-list. A
  drafting action works from a prompt the server already assembled, so a
  filesystem or network call could only reach something it was deliberately not
  given. For Claude there is now no mechanism. Codex CLI has no equivalent
  no-tools flag, so its adapter uses `--sandbox read-only` in a fresh empty root
  and does not grant another writable directory. The difference is explicit:
  Codex is sandbox-contained, not tool-free.
- **Settings scope.** Claude loads only the settings scopes the policy
  names. A workspace may go further and run fully isolated, with no hooks,
  plugins or project-file discovery at all — which closes the case where a hook
  in the researcher's own configuration runs inside every CodeVault run. It is
  off by default because it requires the provider to authenticate with an API
  key, and turning it on for a workspace signed in with a subscription would
  disable AI entirely. Codex instead always uses `--ephemeral`,
  `--ignore-user-config` and `--ignore-rules`; authentication is still resolved
  by the CLI, but user configuration, repository rules and session persistence
  do not become part of a CodeVault run.

The output schema is also handed to the provider so it can constrain its own
output. That is a convenience, not a control: the server validates the output
again under gate 4, and only that verdict counts.

### 4. The output must validate, and a person must accept it

Provider output must parse as JSON and satisfy the action's schema. Invalid
output is recorded as a failed run — never as a proposal a researcher might
accept in a hurry.

A valid output becomes a **proposal**: a patch, a rationale, and the target
revision it was computed against. Accepting it:

- checks the caller may write to the case;
- checks the patch touches only the action's declared fields;
- checks the patch touches no field on the global forbidden list;
- asserts the target has not changed since the proposal was made;
- applies the change in a transaction with an audit event naming the reviewer
  and the run.

## What AI can never write

Enforced by `AI_FORBIDDEN_PATCH_FIELDS`, under every action:

`priorArtState`, `validationState`, `disclosureState`, `externalIdState`,
`remediationState`, `visibility`, `reviewState`, `approvedBy`, `approvedAt`,
`status`, `revision`, `ownerId`, `caseId`.

For disclosure work, AI may propose a first draft, a follow-up draft, or a
message classification. It never chooses or edits recipients, sender identity,
route, public-key version, attachment set, approval, delivery state,
correspondence facts, deadlines, or lifecycle state. A follow-up remains a
normal editable draft and the external-send confirmation is still mandatory.
Inbound MIME is treated as hostile context: HTML is reduced to inert bounded
text before any proposal can see it, and encrypted content is unavailable until
a researcher decrypts it locally and explicitly saves reviewed plaintext.

Two consequences worth stating plainly:

- **A model cannot mark a finding novel.** `HUMAN_CONFIRMED_NOVEL` is recorded
  by a person against a specific prior-art check, and the audit event for it has
  its own action name.
- **A model cannot produce a CVSS score.** The suggestion schema has no field
  for one. It returns metrics and the reasoning for each; the vector is
  assembled from the metrics a researcher approves and the number is computed by
  the deterministic implementation. An AI-proposed score record enters as
  `PROPOSED` and still needs approval.

## What is stored about a run

Always:

- the action, target, provider and provider version;
- the model and the reasoning depth it ran at;
- the context manifest: kind, identifier, label, visibility, SHA-256 and length
  of each item sent;
- the SHA-256 of the full prompt;
- the outcome, duration and any failure reason;
- what it cost and how many tokens it used, on every outcome including failures;
- an audit event for preparation, completion, and each acceptance or rejection.

The model is recorded separately from the provider version because they answer
different questions: the version identifies the command-line tool, and a
researcher weighing whether to accept a CVSS vector needs to know what produced
it. Runs recorded before this existed have no model, which is the honest value —
they are not backfilled with a guess.

Each run also records how many tool calls the provider attempted and was
refused when the provider reports that information. Claude reports permission
denials directly. Codex's current JSONL result does not expose an equivalent
counter, so zero there means "not reported," not proof that no tool was
considered.

## Finding intake is not canonical data

Manual imports and future AI sources write only `ai_intake_batches` and
`ai_intake_items`. A pending item may contain a proposed title, Markdown,
weakness identifiers, affected-version notes and citations, but it cannot carry
finding lifecycle states. Creating it does not create or modify a finding.

A case writer must explicitly accept, reject or merge each pending item.
Acceptance runs in a transaction and creates a finding using database defaults:
draft validation, private disclosure, unchecked prior art and internal
visibility. The reviewer, intake item and resulting finding are named in the
audit trail. A terminal item is locked against a second decision. Merge records
the selected finding but does not overwrite its canonical text.

The full prompt text is stored only when the workspace policy says to. A prompt
about a restricted case is restricted material, and retaining it by default
would quietly widen the blast radius of a database compromise.

## When the provider is unavailable

Everything except the AI actions continues to work. Findings, evidence, scoring,
prior-art checks against internal and external sources, reports and exports are
all fully usable with no provider installed. The interface says so, in those
words, rather than presenting a broken button.

## Adding a provider

1. Add its ID, models and supported efforts to the reviewed provider catalog.
2. Implement `LocalAiProvider` in `apps/desktop/src/main/agents/`.
3. Register it in `registry.ts`.
4. Give it a workspace policy; it is disabled until an administrator enables it,
   and it stays unusable until they also allow-list at least one model and one
   effort level. Every allow-list defaults to empty, and empty disables rather
   than permits — forgetting to configure something must not be the same as
   approving it.

There is no configuration path that turns an arbitrary executable into a
provider. That would be a general-purpose command runner wearing a different
name.
