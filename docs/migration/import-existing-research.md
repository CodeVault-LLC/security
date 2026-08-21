# Import existing research

Use folder intake when an existing directory contains findings and supporting
files. CodeVault maps the directory into pending drafts. A researcher still
reviews each draft before it becomes a finding.

## Preview a folder

1. Open the destination case.
2. Select **Intake**.
3. Select **Preview folder intake**.
4. Choose the research directory.
5. Review the proposed findings, mapping errors, duplicate warnings, and file
   count.
6. Select the proposals that belong in the case.
7. Select **Create intake drafts**.

CodeVault uploads every original file before it creates the batch. The batch
manifest records each relative path, size, digest, mapping result, and artifact
ID. A failed upload leaves the preview open. Retry the action to upload only
the unfinished files.

Folder intake reads these structured formats:

- Markdown with a `title` front-matter field or level-one heading.
- JSON with one finding, a finding array, or a `findings` array.
- RFC 4180 CSV with a `title` column.

CodeVault preserves other regular files as artifacts. It skips symbolic links.
The preview stops if the directory contains more than 5,000 files. A structured
text file cannot exceed 10 MiB.

## Exchange findings as JSON or CSV

The API routes `GET /v1/findings/exchange` and
`POST /v1/intake/finding-exchange` export and stage generic finding records.
JSON uses the versioned `codevault.findings` document. CSV supports narrative,
CWE IDs, and visibility. Spreadsheet formula characters receive a leading
apostrophe during CSV export.

An imported exchange creates pending intake drafts. It does not validate or
approve findings.

## Capture a file

Set a server URL and an authenticated session token:

```sh
export CODEVAULT_URL=https://codevault.example
export CODEVAULT_TOKEN=replace-with-session-token
```

Capture a file:

```sh
bun run codevault capture \
	--case 00000000-0000-4000-8000-000000000001 \
	--file request.txt \
	--type HTTP_CAPTURE \
	--source-time 2026-08-21T09:30:00.000Z \
	--title "Captured request"
```

Capture standard input:

```sh
curl --silent https://example.test/health | \
	bun run codevault capture \
	--case 00000000-0000-4000-8000-000000000001 \
	--name health-response.txt \
	--mime text/plain
```

The command streams the bytes to object storage. It records the case, optional
finding, evidence title, artifact kind, visibility, source time, original name,
size, and SHA-256 digest.

## Move a case between deployments

Open a case and select **Export case archive**. CodeVault verifies every
downloaded artifact before it writes the `.cvcase` file.

To import the file:

1. Open **Cases**.
2. Select **Import case archive**.
3. Choose the `.cvcase` file.
4. Review the native record and artifact counts.
5. Select **Import case**.

The server stages artifact uploads outside canonical case records. After it
verifies every size and digest, one database transaction creates the case. A
failed transaction creates no case, finding, evidence record, or report.

The Alpha 8 importer moves the case, case notes, case assets and identifiers,
findings and asset links, stored artifacts, evidence links, reports, report
sections, and report revision history. Imported reports return to draft and
their sections require review because approvals do not transfer between
deployments. The compatible deployment must already contain every referenced
report template.

Vendor submissions, correspondence, disclosure events, prior-art result
history, and PoC run history remain outside the Alpha 8 archive and must be
moved separately.
