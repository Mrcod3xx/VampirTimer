# Wispbyte Free deployment guide

Verified against public documentation on **31 October 2026**. This guide uses one bot process and free, open-source dependencies. No purchase, credit card, paid database or paid API is needed for this application.

## What the provider currently documents

Wispbyte's [home page](https://wispbyte.com/) advertises **512 MB RAM**, **1 GB disk**, Node.js support, no intentional inactivity sleep, and signing into the panel at least once every **14 days**. Its [login page](https://wispbyte.com/client/login) also says every two weeks. The [Getting Started guide](https://wispbyte.com/kb/getting-started) currently says once per month, which conflicts with those pages. Follow the stricter **14-day** interval and check the current account policy in your panel. If you do not maintain account activity, your server may stop or be archived; do not rely on continued operation.

The [knowledge base](https://wispbyte.com/kb) requires **one Discord bot per server** unless a plan explicitly allows more. This application has one client and can serve multiple Discord guilds. It contains no login automation, fake activity, extra accounts, IP rotation or policy bypasses.

The public docs do not provide a guaranteed version inventory for every Node image or a durability guarantee for this particular server's filesystem. Verify the actual image and storage using the steps below. Backup availability depends on the plan; do not assume a free panel backup service exists. [Server Management](https://wispbyte.com/kb/server-management)

## 1. Create a hosting account

Open [Wispbyte's client panel](https://wispbyte.com/client), register, verify your email if asked, and enable two-factor authentication. Use one free account. Do not create extra accounts to bypass limits. Follow the current [Getting Started instructions](https://wispbyte.com/kb/getting-started).

## 2. Create one free Node.js server

Select **Create Server → Free Plan**, choose a Node.js Docker image, and name the server `Gehenna Boss Tracker`. Wait for it to appear in the dashboard.

Choose **Node.js 24 LTS**, if available. Node 22.12 or later in the 22.x line is also supported by this project. Avoid Node 18/20 or an odd-numbered release. Confirm the actual version in startup logs or run a one-time startup command `node --version`. Node's [release page](https://nodejs.org/en/about/previous-releases) lists Node 24 and 22 as supported LTS lines on the verification date. The available Wispbyte image dropdown remains the authority for your server.

## 3. Create the Discord application and bot

1. Open the [Discord Developer Portal](https://discord.com/developers/applications), create an application and open its Bot settings.
2. Obtain/reset the bot token and save it securely. The token is a secret; your application ID is not. Record the application ID from General Information.
3. Leave **Presence Intent**, **Server Members Intent**, and **Message Content Intent** disabled. This bot uses only the nonprivileged Guilds intent and fetches individual members as needed.
4. Use Guild Install with `bot` and `applications.commands` scopes. Invite it to your own guild using the portal's installation link.
5. Grant **View Channels**, **Send Messages**, **Embed Links**, and **Read Message History** in your existing `#boss` channel. Grant **Manage Roles** if you want role subscriptions. The bot does not need Administrator.
6. Make dedicated alert roles mentionable. This avoids granting the bot broad mention permissions. Move its highest role above every alert role it manages.

The person changing tracker settings must have the guild's **Administrator** permission. The bot itself does not need that permission. Reference: [Discord application commands](https://docs.discord.com/developers/interactions/application-commands) and [permissions](https://docs.discord.com/developers/topics/permissions).

## 4. Prepare or select the build

The provided `wispbyte-boss-tracker.tar.gz` runtime package contains `dist/`, the manifests/lockfile and documentation. It intentionally excludes credentials, databases, backups, Windows native modules, test tools and development dependencies.

If building from source on your computer:

```sh
npm ci
npm run typecheck
npm test
npm run build
npm run package
```

The runtime package is written to `release/wispbyte-boss-tracker.tar.gz`. Build outside the free container to avoid the memory/CPU cost of TypeScript and tests. You can use Node 24 on Windows for compilation, but **do not upload Windows `node_modules` to Linux**. Native SQLite modules must be installed for the hosting OS and Node version.

## 5. Upload files and install dependencies

Stop the server before replacing application files. In **Files**, upload the runtime archive and extract it if the file manager offers extraction. Otherwise extract it locally and upload the resulting files/folders. `package.json` and the `dist` directory must be at the server's working-directory root, not inside an extra nested folder. Free users can use the file manager; do not assume SFTP is available on the free plan. [File management documentation](https://wispbyte.com/kb/server-management)

Install production dependencies once for the uploaded lockfile:

```sh
npm ci --omit=dev --no-audit --no-fund
```

Wispbyte's bot console may be application stdin rather than a shell. If you cannot run this directly, temporarily set **Startup Command** to the command above, start the server, wait for successful completion, then stop it and replace the command with the production command in step 7. Check the install exit/output before proceeding. Leaving an install-only command as the permanent startup command will leave the bot offline.

If the selected image automatically installs from `package.json`, inspect that startup command and avoid adding a second install step. Prefer the lockfile-based install shown above. Leave **Additional Node.js Packages** empty for this project; dependencies already come from the manifest and lockfile. Do not install development tools on the production host.

Some newer npm versions ask for install-script approval. Review and permit `better-sqlite3`'s native installation script when needed. For local development, esbuild's script may also be needed. Do not use `--ignore-scripts` as a fix for SQLite installation.

The [Startup Settings guide](https://wispbyte.com/kb/startup-settings) describes editable startup commands, Docker images, package fields and environment settings. Actual field names can vary by image.

## 6. Configure environment variables

In **Startup → Server Configuration**, add/save:

```env
DISCORD_TOKEN=your_bot_token
DISCORD_CLIENT_ID=your_application_id
DATABASE_PATH=./data/boss-tracker.db
TZ=Asia/Manila
LOG_LEVEL=info
LATENESS_SECONDS=120
HISTORY_DAYS=30
```

Set `DISCORD_GUILD_ID` only if you want commands registered to one test guild. Leave it unset for global commands. In Discord, enable Developer Mode to copy a guild ID if needed.

Never include quotes as part of the token, print the token in the startup command, upload it to a public repository, or share screenshots containing it. If the image does not expose custom environment variables, use the provider's documented environment mechanism or ask Wispbyte support. A private `.env` file is supported by the app, but should only be used if file access is controlled; exclude it from archives/backups shared with others.

## 7. Register commands and set the production entry point

Command registration is a one-time operation for each command-schema change:

```sh
node dist/register.js
```

You can run registration locally using your private `.env`; it does not need a running gateway client. Alternatively use it as a one-time host startup command, then restore the production command after it reports success. If the result is a rate-limit error, wait; do not repeatedly rerun it.

Production startup:

```sh
node --max-old-space-size=256 dist/index.js
```

If the image uses a startup-file field such as `JS_FILE`, choose `dist/index.js`. Check that the effective command runs Node once and that it does not run `tsx`, `tsc`, a watcher or another bot. If using `npm start`, the manifest invokes the same compiled entry point. The heap limit helps but does not cap total container memory.

Installation downloads packages. Building produces JavaScript. Starting runs the bot. These are separate operations; do not compile on every boot. The runtime archive does not need TypeScript installed on the host.

## 8. Start and confirm Discord connectivity

Start from **Console**. A successful gateway connection produces `Boss tracker ready` with the guild count, timezone and RSS memory. No token should appear in logs. Confirm the bot is online in your guild.

If configuration is invalid, correct it before restarting. Rate-limited login attempts wait for the full reported cooldown, preserved in SQLite across restarts. Console logs show remaining seconds and a Philippine-time next-attempt timestamp; that timestamp is not a promise that the IP restriction will clear. Unknown 429 durations use increasing backoff, with at most 12 attempts per run. Invalid credentials do not retry. If the host automatically restarts a failing process, stop it from the panel while fixing the underlying problem.

## 9. Configure your guild inside Discord

1. Run `/panel` and check the default bosses.
2. Run `/set channel channel:#boss` to select the existing channel.
3. Run `/boss schedule`: verify the 1-Star boss at **2:00 PM, 6:00 PM, 10:00 PM** and the 2-Star boss at **2:00 PM, 10:00 PM**.
4. Run `/boss test`. A clearly labeled test should appear without pinging anyone.
5. Open `/boss setup` → Role Settings to create/select `Boss Alerts`. Set boss-specific roles under Manage Bosses if desired.
6. Ask a willing member to use `/boss alerts` and verify subscribe/unsubscribe. Never subscribe everyone automatically.
7. Run `/boss publish` if you want a persistent public schedule message.

Daily schedule summaries default to **8:00 AM Philippine Time**. Admin Settings → Notification Settings controls that summary, reminder intervals, individual 30/10-minute switches, exact-spawn notices, grouping and role mentions.

## 10. Verify persistence and real notifications

Do not assume uploaded disk storage survives the operations you intend to use. Perform this check on your actual free server:

1. Add a temporary boss with a recognizable name through `/add boss`, and note its schedule, selected channel and a volunteer's subscription.
2. Stop the bot. Run `node dist/maintenance.js check` as a one-time startup command. Save the printed persistence probe ID privately.
3. Restore the normal startup command, restart the server and verify the boss/settings/subscription still exist.
4. Stop, rerun the same `check` command, and confirm the same probe ID is printed. Restore normal startup again.
5. Repeat the data check after your first application update. Do not test destructive reinstall/reset actions on the only copy of your data.

For a real alert test, add a temporary boss a few minutes ahead in **Philippine Time** and temporarily configure a 1-minute warning. Observe the reminder and spawn message, including one restart before a due event. Restore the usual intervals after testing and remove the temporary boss. This posts actual scheduled test-boss messages; use a suitable guild channel and volunteer roles.

Inspect `/boss status` for `sent`, `missed`, `cancelled`, and `uncertain` records. A scheduled time is a target, not a network delivery guarantee. Old alerts beyond the lateness window are skipped. Do not mark live deployment complete until these checks pass.

## 11. Maintain the free account

Set your own recurring calendar reminder to sign in **at least once every 14 days**; a weekly reminder gives margin. Log in normally. No bypass or automated fake activity is included. If inactivity stops the server, sign back in and follow the provider's reactivation process, then inspect the bot's status. The scheduler resumes future work without flooding old announcements.

## 12. Back up and update safely

A manual backup uses SQLite's supported online backup API and then checks database integrity and foreign keys. It is safe to run the backup utility while the bot runs if you have an actual shell. If the panel provides only the bot console, use this temporary startup-command procedure:

1. Stop the bot.
2. Temporarily set Startup Command to `node dist/maintenance.js backup`.
3. Start once. Wait for `Verified backup: ...` and successful completion.
4. Download that file from **Files → data → backups** to your computer. Keep it private; it contains all guilds' settings and user IDs.
5. Restore the normal production startup command before starting the bot again.

Only the three newest generated snapshots are retained locally. Download backups regularly; a file on the same server does not protect against loss of that server. Backups are never posted in Discord. Do not simply download the live `.db` file while its WAL is active. [better-sqlite3 backup API](https://github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md#backupdestination-options---promise)

For an application update: **stop → create/verify/download a backup → upload the new `dist/` and manifests → install with the updated lockfile → restore production startup → start → verify settings and notifications**. Keep `data/`, backups, private environment variables and your `.env` intact. The supplied runtime archive has no `data/` directory to overwrite. Register commands again only if their schema changed. Migrations run automatically without reseeding deleted bosses. A code downgrade may require restoring a matching backup; never manually edit migration version numbers.

## 13. Restore a backup

1. Stop the bot and ensure no other copy is running against this database.
2. Upload the chosen verified `.db` snapshot to a distinct path, for example `data/backups/restore-source.db`.
3. Temporarily run:

```sh
node dist/maintenance.js restore data/backups/restore-source.db
```

The utility checks the source, acquires the same process lock as the bot, preserves the current database as `data/boss-tracker.db.before-restore.db`, checkpoints old WAL state, creates a verified staged snapshot, replaces the target and verifies it again. It refuses to restore over an active bot process.

4. Read the result. Restore the production startup command.
5. **Wait longer than `LATENESS_SECONDS` before restarting.** An older backup may not know about announcements delivered since it was made; waiting prevents replay within the lateness window.
6. Verify bosses, channels, role bindings and subscriptions. Discord role memberships themselves are external state and are not rewound by a SQLite restore; members can disable/re-enable alerts to reconcile them.
7. Download the rollback snapshot if needed and remove unused large backup files through the file manager after checking you have a safe off-host copy.

## 14. Troubleshooting

| Symptom | Check and action |
|---|---|
| Invalid token or missing environment | Save the Bot token and application ID correctly; stop repeated restarts. Startup errors name the invalid fields without printing values. |
| `Cannot find ... dist/index.js` | Check extraction level and startup-file path. Build locally or upload the supplied runtime archive. |
| Missing dependency | Run `npm ci --omit=dev` using the uploaded lockfile in the server root; inspect installation errors. |
| TypeScript errors | Run `npm ci`, typecheck, tests and build locally on supported Node. Do not install a compiler to conceal a missing runtime build. |
| SQLite native module / `NODE_MODULE_VERSION` error | Confirm Node 24 or 22.12+, remove only the incompatible `node_modules`, and reinstall on the host. Never upload Windows binaries. If no compatible prebuilt binary exists, installation needs a supported Linux C++ toolchain; select a supported image or ask the host. This project has not silently switched databases. |
| `EACCES`, read-only database | Confirm the database directory is writable by the container user. If ownership is controlled by the host, ask support to fix it; do not run as root or delete the database. |
| Disk full / `SQLITE_FULL` | Download backups, remove obsolete generated archives/cache files, and check the 1 GB quota and database cap. Do not delete the only live database. Reduce retention only after preserving needed records. |
| Memory exhaustion | Use production dependencies and compiled JS, run one bot process, inspect `/boss status` and panel RSS, and keep guild/schedule counts reasonable. A local smoke measurement is not a guarantee under live load. |
| HTTP 429 / Cloudflare 1015 | A shared outbound IP can be restricted. Wait for the indicated limit to clear, stop repeated restarts and registration attempts, and consult Wispbyte support if needed. Do not rotate proxies or create extra accounts. |
| Bot offline | Check console startup errors, hosting account activity, token, effective Node version and Discord/host connectivity. |
| Commands missing | Run `dist/register.js` with matching application ID and correct guild/global target, verify installation scopes, allow global-command propagation and reload Discord. |
| Forbidden channel or missing embeds | Grant View Channel, Send Messages and Embed Links in that specific channel. Check category overrides. Read Message History is also needed for the public panel. |
| Cannot subscribe | Configure the relevant opt-in role, give the bot Manage Roles and move it above that role. Do not use privileged/managed roles. |
| Wrong displayed time | Enter Philippine times directly. Schedule parsing explicitly uses Asia/Manila; do not convert the defaults from the host's timezone. |
| Notifications missing | Check global/stage switches, active boss, channel, lateness, connectivity and `/boss status`. `uncertain` events intentionally are not resent. See RELIABILITY.md. |
| Unexpected restart | Check memory/disk limits and host logs. Ledger recovery skips old events. Check public-panel and role state after interrupted management operations. |
| Process lock error | Stop the other bot process. A crashed process's stale PID lock is recovered automatically. If a PID was reused by an unrelated process, stop and verify the bot is off before removing only the `.lock` file. Never delete `.db`, WAL or SHM as a lock fix. |
| Free server stopped after inactivity | Sign in normally and reactivate per provider instructions. Maintain a 14-day or shorter sign-in reminder. |

See [Wispbyte's Discord Rate Limits guide](https://wispbyte.com/kb/discord-rate-limits). An IP-level restriction on a shared hosting node may be outside the developer's control. The application does not promise uninterrupted free hosting or perfect exactly-once network delivery.

