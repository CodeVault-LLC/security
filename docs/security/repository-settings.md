# Configure the GitHub repository

Repository files cannot enforce GitHub organization, ruleset, environment, billing, or secret-scanning settings. Apply this checklist in GitHub and review it every six months.

The repository is public and uses `master` as its default branch.

## Protect accounts and access

1. Require MFA for the CodeVault organization. Prefer passkeys or hardware-backed security keys.
2. Set the default repository permission to **Read**.
3. Remove inactive collaborators and unused deploy keys.
4. Limit administrator, security-manager, release-environment, and package-write access to the lead maintainer.
5. Review access every six months and after any role change.

## Protect the default branch

The `Protect master` ruleset applies these controls:

- Block branch deletion and force pushes.
- Require pull requests.
- Require conversation resolution.
- Require the `Validate` check.
- Require the merge queue. The pull-request run provides fast feedback. The merge-group run checks integration, end-to-end behavior, dependencies, containers, CodeQL, Trivy, and workflow security against the latest `master` state.
- Use squash merges to keep `master` linear.
- Allow no ruleset bypass. If an emergency requires a temporary ruleset change, record the change in the repository audit log and a public issue after sensitive details are removed.

A solo maintainer cannot require a non-author approval without blocking all changes. Record this exception. Add a required human approval when a second trusted maintainer joins.

## Protect tags and releases

1. Create a tag ruleset for `v*.*.*`.
2. Block tag updates and deletion.
3. Allow the official release workflow to create version tags or restrict creation to the maintainer.
4. Create a `release` environment and restrict it to version tags.
5. Store Apple and Windows signing credentials as environment secrets.
6. Set the default Actions token permission to **Read repository contents**.
7. Disable pull requests from approving workflows.

The tag ruleset blocks updates and deletion for tags that match `v*.*.*`.

## Control Actions use and storage

1. Run one `Validate` job for each pull-request commit.
2. Run the complete required gate on `merge_group`, not again after the merge.
3. Run the independent Security workflow weekly and on manual dispatch.
4. Delete intermediate release workflow artifacts after the publish job finishes. GitHub Release assets are the retained release copies.
5. Keep `retention-days: 1` as a fallback if artifact cleanup cannot run.
6. Set repository-scoped Actions compute and storage budgets. Stop paid use at the approved limit and notify the repository owner at 75%, 90%, and 100%.
7. Review Actions usage and retained artifacts each month.

## Enable security features

Enable dependency graph, Dependabot alerts, Dependabot security updates, private vulnerability reporting, secret scanning, push protection, and code scanning. Review alerts before each release.

Allow only the external actions named in the workflows. Require every action to use a full commit SHA. `.github/dependabot.yml` opens update pull requests, but each update still needs its upstream tag and commit identity checked.

## Record completion

Update `docs/compliance/openssf-osps-baseline.md` with the date, assessor, and links to the repository ruleset and settings evidence. Do not store screenshots that contain secret names, private vulnerability reports, or organization member details in the public repository.
