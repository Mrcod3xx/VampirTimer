# Next improvements — proposed order

Prepared 5 November 2026. These are planned changes, not completed features.

1. **Complete interval respawns (highest priority).** Use the latest accepted defeat report plus the configured interval to generate durable reminder/spawn events. Make next-boss, countdown, public panels and notifications use the same calculation. Add report correction/undo, duplicate-report protection and permissions. Verify restart recovery, edited reports, and disabled tracking with deterministic tests.
2. **Reduce startup Discord requests.** Sync commands only when their schema or registration scope changes, with a persisted fingerprint. Make global-versus-test-guild transitions explicit and test failure recovery. Stop clearing/re-registering unchanged commands on every boot.
3. **Make status actionable.** Show last successful delivery, last connection, missed/uncertain events and the next retry timestamp. Keep status private to administrators.
4. **Protect existing guild configuration.** Review the migration from generic bosses to named bosses so edited schedules, roles and deliberate deletions are preserved. Add migration fixtures for customized existing guilds before further schema changes.
5. **Improve member preferences.** Add a clear per-boss subscription checklist and optional reminder-stage preferences. Keep all-boss and individual subscriptions understandable; test role changes and opt-out failure handling.
6. **Maintain deployment and documentation.** Ensure repository guides match the Azure Linux VM setup, keep `.env` protected, and monitor production PM2 logs and database backups.

Suggested next development milestone: complete items 1–3 before adding more game features.

## Rate-limit fix delivered locally

Login retries now respect the full reported cooldown, distinguish discord.js millisecond values from Discord JSON second values, persist the next retry across restarts, report remaining time and a Philippine-time retry timestamp, and cancel waits on shutdown. Unknown 429 durations use increasing backoff. Invalid credentials do not retry. This does not clear or control a shared hosting IP restriction or its banner.

Update: interval respawn delivery, command-sync caching and scheduler status improvements are now implemented. See UPGRADE.md for scope, activation and remaining work.
