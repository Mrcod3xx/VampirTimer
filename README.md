# Gehenna Boss Tracker

A Discord-native boss scheduler for one bot account and multiple guilds. Daily times are always interpreted in **Asia/Manila (UTC+8)** and displayed with AM/PM. No website, paid API, external database, or privileged gateway intent is required.

## Start here

Read [DEPLOYMENT.md](DEPLOYMENT.md) for the complete Wispbyte setup, Discord invitation, backups and troubleshooting. The supplied runtime archive already contains compiled JavaScript. Source code and automated tests are included in the full project archive.

This project has been built and tested locally. **A real Discord connection and Wispbyte deployment have not been verified.** You need your own Discord application token and hosting account. Do not paste the token into chat or commit it.

## Included behavior

- Defaults, initialized once per guild: **1-Star Gehenna Boss** at **2:00 PM, 6:00 PM, 10:00 PM**; **2-Star Gehenna Boss** at **2:00 PM, 10:00 PM**. Deliberately deleted defaults stay deleted after restart.
- Daily schedule summary at **8:00 AM**, reminders **30 and 10 minutes** before each spawn, and an alert at the scheduled time. Change times and switches in the admin panel.
- Combine simultaneous bosses by default. Batches contain at most ten bosses to respect Discord message limits.
- Add, edit, disable and delete bosses without restarting. Each guild has isolated schedules, channels and subscriptions.
- Channel selection with permission validation and confirmation. The existing `#boss` channel is suggested, never created automatically.
- Private dashboards, native modals and select menus, boss autocomplete, paginated lists, a persistent public schedule, and relative countdowns.
- Optional global and boss-specific opt-in roles. No one is automatically subscribed. Test messages never ping.
- SQLite migrations, a durable event ledger, bounded retries, missed-event recording and verified manual backups.

The bot tracks schedules, not actual in-game appearances. Timing is best effort: it checks due work every second while running, but Discord, network and host delays can prevent an alert from arriving at the exact second.

## Local setup

Use **Node.js 24 LTS** (Node 22.12+ is also supported) and npm. From the project directory:

```sh
npm ci
```

Copy `.env.example` to `.env` and enter `DISCORD_TOKEN` and `DISCORD_CLIENT_ID`. Optionally set `DISCORD_GUILD_ID` for fast command registration in one test guild. Then:

```sh
npm run typecheck
npm test
npm run build
npm run register
npm start
```

`npm ci` installs the versions in the lockfile. `build` compiles TypeScript. `register` registers commands once; do not run it on every boot. `start` runs compiled JavaScript with a 256 MB V8 heap cap. That cap does not include native memory; monitor total RSS on the host.

For development only, `npm run dev` watches TypeScript. Never run a watcher on free production hosting. When moving from guild registration to global registration, remove the old test-guild commands in the Discord application tooling or keep using guild-only registration for that guild; otherwise overlapping commands can appear.

## Commands

| Command | Access | Result |
|---|---|---|
| `/panel` | Member | Main private dashboard |
| `/boss next`, `/boss countdown` | Member | Next spawn and relative countdown |
| `/boss schedule`, `/boss list` | Member | Complete, paginated schedule |
| `/boss alerts` | Member | Alert preferences |
| `/boss subscribe [boss]` | Member | One boss, or all bosses when omitted |
| `/boss unsubscribe [boss]` | Member | One boss, or all alerts when omitted |
| `/boss help` | Member | Command guide |
| `/add boss` | Administrator | Add modal |
| `/edit boss boss:` | Administrator | Edit modal, preserving boss ID |
| `/remove boss boss:` | Administrator | Confirmation before deletion |
| `/set channel channel:` | Administrator | Change the destination immediately |
| `/boss setup` | Administrator | Settings, channels, roles and management |
| `/boss test` | Administrator | Clearly labeled test without pings |
| `/boss publish` | Administrator | Publish or update the public schedule |
| `/boss status` | Administrator | Delivery counts, recent failures, memory |

Mixed `/boss` subcommands remain visible to members, but administrator permission is enforced in every protected handler. Controls are signed, guild-bound and user-bound; private controls expire after 15 minutes. Open `/panel` again when one expires. Public buttons provide private responses and cannot change configuration.

## Role subscriptions

1. Open Admin Settings → Role Settings → **Create Opt-in Role** to create `Boss Alerts`, or select an existing dedicated role.
2. Move the bot's highest role above the alert role in Discord's role list. The bot needs **Manage Roles**. Alert roles must have no permissions, be unmanaged and be mentionable, unless the bot has permission to mention all roles.
3. For individual subscriptions: Manage Bosses → select boss → Set Alert Role. Create or select a different role for each boss.
4. Members enable all alerts or choose individual bosses. Selecting an individual boss removes the global all-boss subscription. Enabling all alerts removes individual subscriptions.

The roles in Discord determine who receives a ping. Administrators should not assign these roles to members who have not opted in or reuse them for unrelated purposes. Discord notification settings can still suppress a member's push notification.

Changing a configured role while recorded subscribers remain is rejected to prevent silently abandoning their preferences. Have those members disable alerts before switching roles. A deleted boss's role is not automatically deleted; stored receipts let members remove retired roles with **Disable Alerts**. Partial Discord role failures leave completed changes visible; rerun the preference action to finish. Removing a role from Discord is not transactional with SQLite.

## Resource and storage policy

One Node process, one shared SQLite connection, the `Guilds` gateway intent only, no message-content/member-list intent, zero message cache, and a tightly limited member cache. No HTTP server or external keepalive service is used.

The scheduler uses indexed due-event queries, a 30-second reconciliation interval (immediate on the next tick after a database edit), one non-overlapping polling loop, and hourly retention/checkpoint maintenance. Terminal ledger entries retain 30 days by default. Long downtime produces detailed missed records for the retained period and a summary for earlier gaps.

Limits: 100 bosses per guild, 12 distinct daily times per boss, five reminder intervals of 1–180 minutes, ten bosses per notification message. Full schedules are paginated; summary messages and next-spawn lists show a bounded preview and link back to the full schedule. These bounds protect Discord's message limits and free hosting resources.

The database defaults to `data/boss-tracker.db`, outside `dist/`. Its page limit is 128 MiB at the default 4 KiB page size. Manual backups retain three snapshots; restore also keeps one `*.before-restore.db`. Keep enough free space for an in-progress snapshot and download backups off-host. Exhausting the disk/database limit is an error, not a reason to reset data. Monitor `/boss status` and Wispbyte's resource panel.

## Configuration

| Variable | Purpose | Default |
|---|---|---|
| `DISCORD_TOKEN` | Bot token; required | none |
| `DISCORD_CLIENT_ID` | Application ID; required | none |
| `DISCORD_GUILD_ID` | Optional test-guild command registration | global registration |
| `DATABASE_PATH` | Persistent SQLite path | `./data/boss-tracker.db` |
| `TZ` | Helpful process setting; scheduling always uses Luxon Asia/Manila | `Asia/Manila` in example |
| `LOG_LEVEL` | `debug`, `info`, `warn`, `error` | `info` |
| `LATENESS_SECONDS` | How late an alert may be sent; 10–300 | `120` |
| `HISTORY_DAYS` | Terminal notification ledger retention; 7–90 | `30` |

## Project layout and operations

- `src/bot/`: command registration, client configuration, interaction routing.
- `src/database/`: migrations, SQLite repository and input validation.
- `src/services/`: scheduling, notification delivery, roles, public panel, backups.
- `src/ui/`: signed component IDs and Discord views/modals.
- `src/utils/`: Philippine time, permissions and safe logging.
- `tests/`: deterministic clocks, real SQLite, mocked Discord APIs.
- `scripts/smoke.mjs`: production-module resource smoke check, without credentials.

```sh
npm run backup
npm run inspect
npm run storage-check
npm run restore -- ./data/backups/your-backup.db
npm run package
```

Stop the bot before restoring. Never copy a running WAL database by copying only its main `.db` file. Never upload a database backup to Discord: it contains every guild's configuration and subscription IDs. See [RELIABILITY.md](RELIABILITY.md) for delivery guarantees and [VERIFICATION.md](VERIFICATION.md) for the test record and live acceptance checklist.

## November 5 improvements
See [UPGRADE.md](UPGRADE.md) for completed interval respawn alerts, report corrections, command-sync caching and status improvements. Interval tracking remains opt-in per guild. This update supersedes earlier startup/feature notes where they differ.
