# Release policy

This reference defines an official CodeVault Security release. It does not describe local development packages.

## Release identity

The root `package.json` is the version source. An official tag has the exact form `v<version>` and must match `package.json`. The release workflow rejects any mismatch.

Workspace packages remain private build inputs. The project does not publish them to npm. Official distributions are:

- macOS DMG and ZIP packages for arm64 and x64.
- A Windows NSIS package for x64.
- Linux RPM and AppImage packages for x64.
- Multi-architecture server, worker, and media-worker OCI images.
- A deterministic source archive.

## Release gates

`.github/workflows/release.yml` calls `.github/workflows/reusable-release-build.yml` for version tags. The reusable workflow runs the following gates before publication:

- Frozen dependency installation with Bun 1.3.14.
- Lint, formatting, type checking, generated-inventory checks, unit tests, DOM
  tests, database integration tests, the existing end-to-end suites, and builds.
- Dependency audit and media-decoder runtime checks.
- Native desktop builds on Linux, macOS, and Windows.
- Final OCI image scanning for fixable high and critical vulnerabilities.
- CycloneDX 1.7 SBOM generation and validation.
- VEX, checksum, and release-evidence generation.
- GitHub build attestations and keyless OCI signatures.

The workflow checks the exact desktop package name and architecture inventory
for each native runner. A missing or unexpected package fails its build job. An
existing GitHub Release for the tag also fails publication. The workflow does
not replace published release assets.

## Alpha prereleases

A SemVer prerelease tag, such as `v0.1.0-alpha.6`, creates a GitHub prerelease.
Alpha releases include the complete source, container, evidence, and desktop
artifact inventory. The macOS and Windows packages may be unsigned. Release
notes must identify them as test builds and warn about Gatekeeper and
SmartScreen prompts.

Unsigned alpha packages are for evaluation on systems controlled by the
tester. They are not official signed distributions. Verify their checksums and
GitHub artifact attestations before installation. Stable release tags do not
receive this exception.

## Signing credentials

Stable macOS releases require Apple notarization credentials and an Apple signing certificate. Stable Windows releases require a code-signing certificate. Store these values as secrets in the protected GitHub `release` environment. Desktop and container publication jobs enter that environment; pull-request and ordinary CI jobs do not.

The OCI workflow uses GitHub OIDC and Cosign keyless signing. It has no long-lived Cosign private key. Restrict the `release` environment to version tags and repository administrators.

## Release evidence

Each release contains:

- `SHA256SUMS` for every file in the evidence set.
- `release-evidence.json` with the source commit and individual file digests.
- A CycloneDX 1.7 SBOM for each desktop artifact and OCI image.
- A machine-readable Trivy SARIF result for each OCI image.
- A release VEX document, including an empty vulnerability list when no disposition applies.
- GitHub artifact attestations for desktop packages, the source archive, and the complete evidence set.
- Registry attestations and a Cosign signature for each OCI image digest.

The current workflow is designed for SLSA Build Level 3 through GitHub's protected reusable-workflow pattern. Do not claim the level until the public repository, release environment, and generated attestations have been checked against the current SLSA requirements.

## Reproducibility

The source archive uses `git archive` and `gzip -n`. Release metadata uses the source commit timestamp through `SOURCE_DATE_EPOCH`.

Native desktop signatures, notarization records, package timestamps, and some Electron packaging data prevent a useful byte-for-byte comparison of final signed packages. Compare unsigned application contents and document every remaining difference before describing a desktop build as reproducible.

## Support and withdrawal

The latest stable release receives security fixes. A release notice may name an additional supported line. Release assets are immutable. If a release is unsafe, publish a new fixed version and mark the affected release as withdrawn. Do not replace files under an existing version.
