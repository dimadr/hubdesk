# Backup and schema operations

## Backup

Run `sh archive.sh VERSION` on the server. A successful invocation prints `COMPLETE` only after checksums, full archive reads, pg_restore validation and an isolated database/uploads/application restore have passed.

The default output is a new private directory under `/root/hubdesk-backups`, outside the project and runtime volumes. Existing files are never overwritten. Failed attempts remain marked FAILED, without COMPLETE; retain their private diagnostics until reviewed.

The kit contains the logical database dump, PostgreSQL globals, project sources including tests/migrations, separate private configuration, uploads, persisted Redis files and exact runtime images. The whole directory is private. Do not publish any component to GitHub. Copy it to a separate admin-protected host and verify SHA256SUMS again.

Verification: `python3 scripts/backup.py --verify /absolute/backup-directory`.
Repeated isolated recovery: `python3 scripts/restore_backup_probe.py /absolute/backup-directory`.

The probe creates only new labelled containers/network/uploads volume, publishes no ports and disables email. It never accepts a production database target. Restore globals/production credentials, DNS, TLS, SMTP, firewall and external integrations require a separately reviewed disaster-recovery procedure; the probe deliberately uses a new DB role and test credentials.

Backups are online: PostgreSQL is internally consistent, while uploads are a separate snapshot. Attachment/size reconciliation is mandatory and performed by the restore probe. Non-empty Redis is rejected until a consistent RDB export policy is reviewed. At least 1 GiB free is required; large installations need additional capacity planning.

## Schema

Application startup no longer creates tables or executes ad hoc SQL. It checks Alembic head and fails with a clear error when the schema is absent or old. `ENABLE_AUTO_MIGRATIONS=true` is deliberately rejected; schema changes must be separately reviewed and executed.

On a reviewed isolated/restored database: `cd backend && python -m alembic upgrade head`.

The reconstructed frozen baseline precedes existing revision IDs, so stamped current databases do not rerun initial DDL. The new alignment preserves legacy ticket contact columns and stops, rather than inventing data, on invalid JSON, fractional quantities, NULL mandatory fields or conflicting equipment identities.

Existing duplicate product names are not renamed, merged or deleted. Their unique index remains an explicit H04 exception on the restored legacy database. After the administrator resolves the groups, the separately tested `backend/scripts/restore_insert_name_uniqueness.sql` can install it; run with psql ON_ERROR_STOP enabled. Never apply it to production without approval.

Deploying these changes requires approval for the alignment migration before the application is rebuilt/restarted. H01 source and tests are not part of these edits.
