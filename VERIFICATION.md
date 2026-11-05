# Verification — November 5, 2026

- `npm run typecheck`: passed.
- `npm test`: 85 tests passed across 10 files.
- `npm run build`: passed; compiled JavaScript included.
- Tests use real SQLite and mocked Discord APIs. No live credentials are required.

Coverage includes time conversion, daily/weekly/dated scheduling, interval reminders from defeat reports, no duplicate respawn candidates, cancellation after report changes, duplicate-report rejection, administrator report correction, disabled tracking, offline expiration, guild isolation, restart recovery, SQLite backup/restore, role subscriptions, signed controls, channel permissions, login cooldowns, cached command synchronization and scheduler status.

The release package excludes `.env`, databases, backups and `node_modules`. Runtime dependencies must be installed for the host's Node/OS combination.

Not verified by this update: live Discord connection, actual Wispbyte deployment, host filesystem persistence, shared-IP restriction expiry, or sustained production memory use. The 256 MB heap cap is not a total process RAM guarantee. SQLite and retained backups can exceed earlier estimates; inspect real disk usage before updating.

See UPGRADE.md for behavior changes and activation steps.
