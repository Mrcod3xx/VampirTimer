# Delivery and recovery model

## Identity and persistence

Each real spawn/reminder has a unique key `(guild ID, boss ID, spawn timestamp, reminder minutes)`. Daily schedule messages use boss ID zero and stage `-1`. Timestamps are integer UTC epoch milliseconds; recurring times are canonical `HH:mm` in Asia/Manila. Names, channel IDs, role settings, and grouping mode are deliberately excluded from event identity, so changing them cannot make an already sent event eligible again.

Migrations run transactionally, SQLite foreign keys are enabled, journaling uses WAL and `synchronous=FULL`. Default initialization is transactional and permanently recorded. Deleted default bosses are not recreated.

## Delivery state machine

`pending → sending → sent`

Alternative terminal states are `missed`, `cancelled`, and `uncertain`.

The scheduler generates approximately the next 27 hours of work. After a restart it also reconciles the retained historical interval. It cancels obsolete pending events after schedule/settings edits. Immediately before dispatch it rechecks the current configuration, boss activity, current channel and lateness. Toggling combine mode does not change per-boss event identities.

A group is claimed in a database transaction before calling Discord. A successful response records the message ID for every event in the group. Each group is limited to ten bosses. Events outside the lateness window become missed instead of being sent as a catch-up flood. Future cancelled events can become pending again when a boss or setting is re-enabled; terminal sent, uncertain and missed events are never automatically replayed.

A deterministic nonce and `enforceNonce` provide Discord's additional recent-message deduplication. Discord's nonce check only covers a recent window; it is not a permanent idempotency key. See [Discord's Create Message API](https://docs.discord.com/developers/resources/message#create-message).

## The unavoidable crash gap

If Discord accepts a message but the process stops before saving `sent`, SQLite contains `sending`. Startup changes all such records to **uncertain**, and does **not** resend them. A timeout or transport failure during a send is also uncertain because acceptance is unknown.

This favors avoiding duplicates over guaranteeing every delivery. A crash after the claim but before the network request can therefore skip an alert. The application does not promise exactly-once delivery. Inspect uncertain records with `/boss status` or `npm run inspect`; administrators may communicate manually if necessary. No automatic replay command is provided.

Failures known to occur before acceptance, including unavailable channels, missing access/permissions and rejected rate-limited requests, receive bounded retries: at most four attempts with delays of 10, 20 and 40 seconds, and never beyond the lateness window. Library-level retries for timeout/5xx sends are disabled. Known Discord rate-limit queues are rejected to the scheduler rather than allowing stale alert requests to wait indefinitely. Interaction failures are reported privately and can be retried by the user.

Gateway reconnection is handled by Discord.js. Login 429 failures use at most 12 attempts, honoring the full reported delay and preserving the cooldown in SQLite across restarts. Waits cancel on shutdown. Other login failures log an error and exit. Stop the hosting server's repeated automatic restarts if the credentials are invalid or its shared IP is restricted. Host process management is outside this application's control.

## Concurrency and configuration

A filesystem process lock prevents two local bot processes from operating the same database. Different machines with copied databases are not coordinated: never run the same bot deployment on two hosts at once. Scheduler ticks do not overlap; claims are conditional updates. Role changes are serialized per guild; public-panel writes are serialized per guild. Administrative operations recheck Discord's interaction permissions on each action, including modal submissions and confirmations.

The public panel's message ID survives restart. Editing schedules edits that message, not a new message. If it is deleted, the saved ID is cleared and an administrator can run `/boss publish`. Changing notification channels retires the old panel when it can be accessed; publish the replacement in the new channel. If the old panel is inaccessible, repair permissions or use Admin Settings → Reset Public Panel, confirm forgetting its saved ID, and delete any old public message before publishing a replacement. Public-panel sends and role changes also cross the Discord/SQLite boundary: an interruption between the external change and its database write can require manual reconciliation. Scheduled-delivery claims protect real spawn alerts; public messages are not covered by that ledger.

## Retention, restoration and limits

Terminal ledger history is deleted hourly after `HISTORY_DAYS` (30 by default). SQLite reuses freed pages; the file does not automatically shrink. Recovery examines at most that many days, plus a summary of any older gap. Logs for old events use the current schedule configuration; the application does not maintain a historical audit of every schedule edit.

Settings changes cancel pending work when reconciled. If a request has already been dispatched to Discord, a later disable/delete cannot recall that in-flight request. The same boundary applies to changing channels.

An old backup also restores an old notification ledger. Restoring it can forget messages sent since the snapshot. Stop the bot, restore safely, wait longer than `LATENESS_SECONDS` before restarting, and verify the current schedule and destination. A newly added or changed schedule may produce an alert whose due time is already within the configured lateness window. Late notifications preserve their stage label and show the scheduled spawn time.

Hourly health logs include process RSS. The V8 heap cap is not a total RAM guarantee. Process health, PM2 status, storage persistence, and sustained memory usage can be monitored live via `pm2 status`, `pm2 logs`, and `pm2 monit`.


