# Database safety net

Tools that keep the dashboard's data safe. All of them run Postgres inside
Docker (`postgres:18`, matching Render), so Docker Desktop is the only requirement.

| What | How |
| --- | --- |
| **Nightly off-site backup** | `.github/workflows/db-backup.yml` dumps the Render database every day, encrypts it (AES-256) and keeps 30 days of artifacts. Needs the `DATABASE_URL` and `BACKUP_PASSPHRASE` repo secrets. |
| **Backup on demand** | `./tools/db/backup.ps1` writes a dump to `./backups` (git-ignored) and keeps the newest 14. |
| **Restore drill** | `./tools/db/restore-drill.ps1 -DumpFile <dump>` restores into a throwaway container and prints row counts. It never touches the live database. |
| **Migration check** | Add `-CheckMigrations` to the drill. It runs the app's real startup migrations on the restored copy and fails if any table lost rows. Run it before deploying any change that adds a migration. |
| **Download my data** | Settings → *Your data*, or `GET /api/export`. A JSON file with every table and its row counts. Stored credentials are left out. |

## Restoring a nightly backup

1. Actions → *Database backup* → pick a run → download the artifact.
2. `gpg --decrypt --output dashboard.dump dashboard-<stamp>.dump.gpg` (it asks for `BACKUP_PASSPHRASE`).
3. `./tools/db/restore-drill.ps1 -DumpFile dashboard.dump` to check it.
4. To restore into a real database: `pg_restore --no-owner --no-privileges --dbname "<target url>" dashboard.dump`.
