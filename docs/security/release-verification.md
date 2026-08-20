# Verify a CodeVault release

Use these checks before you install a desktop package or deploy an OCI image. Replace `v0.1.0-alpha.4` with the release you want to verify.

## Verify downloadable files

Download the complete evidence set into an empty directory:

```sh
mkdir codevault-v0.1.0-alpha.4
cd codevault-v0.1.0-alpha.4
gh release download v0.1.0-alpha.4 --repo CodeVault-LLC/security
```

Check every local file listed by the release:

```sh
sha256sum --check SHA256SUMS
```

Verify a package's GitHub attestation against this repository:

```sh
gh attestation verify ./CodeVault-Security-0.1.0-alpha.4.AppImage \
  --repo CodeVault-LLC/security
```

Run the repository's structural verification after you obtain the matching source:

```sh
bun run release:verify -- /absolute/path/to/codevault-v0.1.0-alpha.4
```

The command requires all declared desktop formats, all three image SBOMs, the source archive, VEX, evidence manifest, and valid checksums. It also requires every CycloneDX document to use specification version 1.7.
Each desktop package must have a matching `.cdx.json` SBOM. Each OCI component must have an immutable identity file, a CycloneDX SBOM, and a `trivy-<component>.sarif` scan result. The checksum file must account for every other file in the bundle.

On macOS, verify the native signature and Gatekeeper assessment for a stable
release:

```sh
codesign --verify --deep --strict --verbose=2 /Applications/CodeVault\ Security.app
spctl --assess --type execute --verbose=2 /Applications/CodeVault\ Security.app
```

On Windows, inspect the Authenticode result for a stable release in PowerShell:

```powershell
Get-AuthenticodeSignature .\CodeVault-Security-Setup-0.1.0-alpha.4.exe | Format-List
```

Require a `Valid` status and the expected CodeVault publisher identity.

For an alpha prerelease, expect the macOS and Windows signature checks to
report an unsigned package. Confirm that the GitHub release labels the package
as unsigned before you install it. On macOS, use Finder's **Open** confirmation
for the verified app. On Windows, use **More info**, then **Run anyway**, for
the verified installer. Do not disable Gatekeeper or SmartScreen.

## Verify an OCI image

Read the immutable image and digest from the matching `container-<component>.json` release asset. Do not deploy a mutable version tag.

Verify the GitHub attestation:

```sh
gh attestation verify \
  oci://ghcr.io/codevault-llc/security/server@sha256:<digest> \
  --repo CodeVault-LLC/security
```

Verify the keyless Cosign signature. The certificate must identify this repository's release workflow and GitHub's OIDC issuer:

```sh
cosign verify \
  --certificate-identity-regexp '^https://github.com/CodeVault-LLC/security/.github/workflows/(release|reusable-release-build)\.yml@refs/tags/v[0-9]' \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com \
  ghcr.io/codevault-llc/security/server@sha256:<digest>
```

Repeat both commands for `worker` and `media-worker`.

## Treat a failure as a security event

Do not install an artifact when a digest, signature, certificate identity, attestation subject, repository, workflow, or source commit differs from the release evidence. Preserve the files and command output, then report the mismatch through the private security channel.
