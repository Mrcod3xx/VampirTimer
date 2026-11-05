# November 5 upgrade: reliable respawns and quieter startup

## Completed

- Interval bosses now schedule reminders and the spawn alert from the latest defeat/correction report plus their configured respawn interval. Their legacy daily base times are ignored by the scheduler.
- Next-boss and countdown panels use the same estimate. No report means no fabricated respawn time. Estimated alerts explicitly say they are based on player reports.
- Members can report defeat from the boss detail panel or `/boss defeated`. Reports within 60 seconds of the previous defeat are rejected to prevent accidental timer resets.
- Administrators can use `/boss alive` to stop the current estimate or `/boss undo-report` to restore the previous report. These controls also appear in boss management. Changes cancel obsolete pending alerts; sent alerts are never automatically replayed.
- Public schedule summaries distinguish daily, weekly, dated and interval bosses. Report changes refresh the saved public panel. Large summaries stay within Discord embed limits.
- Command definitions are fingerprinted in SQLite per application and registration scope. Unchanged restarts perform no registration writes. Failed syncs are retried at the next startup; manual `npm run register` remains available.
- Admin status uses a real scheduler heartbeat, shows actual completed delivery outcomes and pending valid alerts, respects disabled notifications, and displays uncertain sends and memory usage.
- Defeat-report history retains 90 days plus the latest report for each boss. Delivery retention now honors `HISTORY_DAYS`.

## Enable and verify

Back up before updating. Preserve `data/` and `.env`, upload the new compiled build or update the checkout, and restart once. New slash commands synchronize when Discord allows requests. Existing shared-IP cooldowns still apply; this update does not clear a host restriction.

In Admin Settings → Notification Settings, enable **Interval Respawn Alerts**. Add an interval boss, configure its duration and role, then report a defeat. Check the next-boss panel and use a test channel to verify the reminder and estimated spawn alert. Confirm Alive and Undo Last Report are administrator-only.

A corrected or undone report can restore an old timer. Already-sent stages remain sent; stages past the lateness window are not replayed. These are estimates of scheduled appearances, not game detection.

## Remaining next steps

- Review the older generic-to-named-boss migration with customized guild fixtures before further migration changes.
- Add optional per-member reminder-stage preferences.
- Verify Discord connectivity, role hierarchy, storage persistence and sustained memory on the actual Wispbyte node once its restriction clears.

This build was tested locally; no live deployment was performed by this update.
