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

`claude -p`, spawned with `shell: false`, prompt on stdin, an empty environment
plus an allow-list, a fresh temporary working directory, a timeout, and
cancellation that terminates the process group. Output is scanned for
credential-shaped strings and redacted before it is stored.

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
- the context manifest: kind, identifier, label, visibility, SHA-256 and length
  of each item sent;
- the SHA-256 of the full prompt;
- the outcome, duration and any failure reason;
- an audit event for preparation, completion, and each acceptance or rejection.

The full prompt text is stored only when the workspace policy says to. A prompt
about a restricted case is restricted material, and retaining it by default
would quietly widen the blast radius of a database compromise.

## When the provider is unavailable

Everything except the AI actions continues to work. Findings, evidence, scoring,
prior-art checks against internal and external sources, reports and exports are
all fully usable with no provider installed. The interface says so, in those
words, rather than presenting a broken button.

## Adding a provider

1. Implement `LocalAiProvider` in `apps/desktop/src/main/agents/`.
2. Register it in `registry.ts`.
3. Give it a workspace policy; it is disabled until an administrator enables it.

There is no configuration path that turns an arbitrary executable into a
provider. That would be a general-purpose command runner wearing a different
name.
