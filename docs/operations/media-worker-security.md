# Media worker security boundary

The media worker treats every input byte as hostile. It accepts only JPEG and
PNG buffer loaders, rejects all other libvips loaders, enforces pixel, edge,
channel, page, output-size, and time limits, and publishes a newly encoded WebP
under an avatar-bound opaque key. Raw quarantine objects are never served by
the API.

## Required deployment controls

- Create a dedicated login and grant it only `codevault_media_runtime`. Do not
  grant that login an application role or direct table privileges. Set
  `MEDIA_DATABASE_URL` to that login. Migration 0006 exposes only the claim,
  complete, and fail functions.
- Give `MEDIA_S3_*` credentials read/delete on `quarantine/avatars/*` and
  put/delete on `derivatives/avatars/*`. Deny bucket listing and all other
  prefixes. Never reuse the API's S3 credentials in production.
- Run as UID/GID 10002, with a read-only root filesystem, `cap_drop: ALL`,
  `no-new-privileges`, a 32-process PID limit, 256 MiB memory, one CPU, and a
  size-capped `/tmp` tmpfs. Allow network egress only to PostgreSQL and the
  private object-store endpoint.
- Configure the supervisor to restart exit code 70. A decoder deadline breach
  terminates the process because native libvips work cannot be cancelled safely
  inside a long-lived process.
- Alert on repeated `PROCESSING_LIMIT`, `STORAGE_FAILURE`, and exhausted retry
  events. Keep `sharp` pinned exactly and review its bundled libvips version
  before every dependency update.

## Release checks

Run `bun -e "import sharp from 'sharp'; console.log(sharp.versions.sharp, sharp.versions.vips)"`
inside the built image and require sharp 0.35.3 plus libvips 8.18.3 or newer.
Verify the runtime role cannot select `users`, `cases`, `findings`,
`audit_events`, or `media_jobs`, while it can execute the three media functions.
Verify no `READY` avatar has a quarantine key and both buckets/prefixes remain
private.
