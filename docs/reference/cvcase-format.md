# `.cvcase` format reference

A `.cvcase` file is a versioned, sequential CodeVault archive. The format is
designed for bounded-memory reads and writes. It does not depend on ZIP path
handling.

## File layout

The file starts with this ASCII line:

```text
CODEVAULT-CVCASE/1
```

Each entry contains one JSON header line, exactly `sizeBytes` bytes, and one
newline byte. The header has this shape:

```json
{
  "path": "manifest.json",
  "sizeBytes": 123,
  "sha256": "64 lowercase hexadecimal characters"
}
```

Entries appear in this order:

1. `manifest.json`
2. `records.json`
3. Each artifact in manifest order

Artifact paths use `artifacts/<source UUID>/blob`. Readers reject absolute
paths, backslashes, empty path segments, `.` segments, `..` segments, NUL
bytes, headers over 16 KiB, and metadata entries over 64 MiB.

## Manifest

The manifest contains:

- `format`: `codevault.cvcase`
- `version`: `1`
- `exportedAt`: the export timestamp
- `sourceVersion`: the CodeVault server version
- `case`: the source UUID, reference, and title
- `recordCounts`: counts by record collection
- `artifacts`: source UUID, archive path, original filename, media type, size,
  SHA-256 digest, visibility, artifact kind, source time, and metadata

Importers reject an unsupported format or version before they upload an
artifact.

## Integrity and commit behavior

The writer hashes bytes while it writes each artifact. The reader hashes bytes
while it extracts each artifact. Both compare the result with the entry header
and the manifest.

The desktop importer extracts into a private temporary directory. The server
uploads artifacts into an import session that expires after 24 hours. It checks
the stored size and streams each object through SHA-256 before it starts the
database transaction. The transaction creates all supported records or none of
them.

Approval attestations are deployment-local. An imported report is a draft and
its sections return to `NEEDS_REVIEW`, while the archived revision content is
preserved.

## Compatibility

Version `1` requires API `v1`. A future incompatible archive layout increments
the integer `version`. Importers do not guess how to read a later version.
