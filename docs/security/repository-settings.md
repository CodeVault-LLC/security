# Configure the GitHub repository

Repository files cannot enforce GitHub organization, ruleset, environment, or secret-scanning settings. Apply this checklist in GitHub before the first official release.

The repository is private and uses `master` as its default branch at the time of writing. GitHub reported that branch protection needs either a public repository or a paid plan. Make the repository public or upgrade the plan before claiming OpenSSF OSPS Baseline Level 1.

## Protect accounts and access

1. Require MFA for the CodeVault organization. Prefer passkeys or hardware-backed security keys.
2. Set the default repository permission to **Read**.
3. Remove inactive collaborators and unused deploy keys.
4. Limit administrator, security-manager, release-environment, and package-write access to the lead maintainer.
5. Review access every six months and after any role change.

## Protect the default branch

Create a ruleset for the actual default branch. Require these controls:

- Block branch deletion and force pushes.
- Require pull requests.
- Require conversation resolution.
- Require signed commits when the contributor workflow can support them.
- Require the CI quality, integration, audit, CodeQL, dependency review, repository scan, and workflow security checks after each workflow has run once.
- Block bypass except for a documented emergency. Record every emergency bypass in a public issue after sensitive details are removed.

A solo maintainer cannot require a non-author approval without blocking all changes. Record this exception. Add a required human approval when a second trusted maintainer joins.

## Protect tags and releases

1. Create a tag ruleset for `v*.*.*`.
2. Block tag updates and deletion.
3. Allow the official release workflow to create version tags or restrict creation to the maintainer.
4. Create a `release` environment and restrict it to version tags.
5. Store Apple and Windows signing credentials as environment secrets.
6. Set the default Actions token permission to **Read repository contents**.
7. Disable pull requests from approving workflows.

## Enable security features

Enable dependency graph, Dependabot alerts, Dependabot security updates, private vulnerability reporting, secret scanning, push protection, and code scanning. Review alerts before each release.

Allow only required actions. Require actions to use a full commit SHA where GitHub provides that policy. `.github/dependabot.yml` opens update pull requests, but each update still needs its upstream tag and commit identity checked.

## Record completion

Update `docs/compliance/openssf-osps-baseline.md` with the date, assessor, and links to the repository ruleset and settings evidence. Do not store screenshots that contain secret names, private vulnerability reports, or organization member details in the public repository.

