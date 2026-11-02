import { DateTime } from "luxon";
import { atTime, isBossDueOnDay, ZONE } from "../utils/time.js";
import { errorCode, log } from "../utils/logger.js";
export function stages(s) {
    const reminders = JSON.parse(s.reminder_minutes).filter((n) => (n !== 30 || s.reminder_30_enabled) &&
        (n !== 10 || s.reminder_10_enabled));
    return [...reminders, ...(s.spawn_notification_enabled ? [0] : [])];
}
export function eventKey(guild, boss, at, minutes) {
    return `${guild}:${boss}:${at}:${minutes}`;
}
export function validEvent(e, s, bosses) {
    if (!s.notifications_enabled)
        return false;
    const time = DateTime.fromMillis(e.spawn_at, { zone: ZONE }).toFormat("HH:mm");
    if (e.minutes === -1)
        return Boolean(s.daily_enabled && time === s.daily_time);
    const boss = bosses.find((b) => b.id === e.boss_id);
    if (!boss?.enabled ||
        !boss.times.includes(time) ||
        !stages(s).includes(e.minutes)) {
        return false;
    }
    const eventDay = DateTime.fromMillis(e.spawn_at, { zone: ZONE });
    const intervalEnabled = Boolean(s.interval_respawn_tracking_enabled);
    return isBossDueOnDay(boss, eventDay, intervalEnabled);
}
// Only errors known to precede acceptance may be retried. Network/5xx errors are ambiguous.
export class SafeRetry extends Error {
}
export class Scheduler {
    store;
    delivery;
    guildIds;
    clock;
    lateness;
    historyDays;
    running = null;
    timer;
    stopped = false;
    reconciledAt = 0;
    revision = -1;
    cleanedAt = 0;
    constructor(store, delivery, guildIds, clock = Date.now, lateness = 120_000, historyDays = 30) {
        this.store = store;
        this.delivery = delivery;
        this.guildIds = guildIds;
        this.clock = clock;
        this.lateness = lateness;
        this.historyDays = historyDays;
    }
    recover() {
        this.store.db
            .prepare("UPDATE notification_logs SET status='uncertain',error_message='Process stopped during send; not resent' WHERE status='sending'")
            .run();
    }
    reconcile(now) {
        const db = this.store.db;
        const insert = db.prepare(`INSERT OR IGNORE INTO notification_logs
      (event_key,guild_id,boss_id,spawn_at,minutes,scheduled_at,status) VALUES (?,?,?,?,?,?,?)`);
        const update = db.prepare("UPDATE notification_logs SET status=? WHERE event_key=? AND status IN ('pending','cancelled')");
        for (const guildId of this.guildIds()) {
            const s = this.store.settings(guildId);
            const bosses = this.store.bosses(guildId);
            // Replay a bounded history after long outages. Older gaps are recorded as one summary.
            const floor = now - this.historyDays * 86_400_000;
            const since = Math.max(s.last_reconciled ?? now - this.lateness, floor, s.created_at - this.lateness);
            db.transaction(() => {
                if (s.last_reconciled !== null && s.last_reconciled < floor) {
                    insert.run(`${guildId}:gap:${s.last_reconciled}:${floor}`, guildId, 0, floor, -2, floor, "missed");
                }
                // Cancel obsolete future work when settings or boss schedules change.
                const pending = db
                    .prepare("SELECT * FROM notification_logs WHERE guild_id=? AND status IN ('pending','cancelled') AND scheduled_at>=?")
                    .all(guildId, now - this.lateness);
                for (const e of pending)
                    update.run(validEvent(e, s, bosses) ? "pending" : "cancelled", e.event_key);
                const first = DateTime.fromMillis(since, { zone: ZONE }).startOf("day");
                const end = DateTime.fromMillis(now, { zone: ZONE })
                    .startOf("day")
                    .plus({ days: 2 });
                const add = (boss, at, minutes) => {
                    const due = minutes === -1 ? at : at - minutes * 60_000;
                    if (due < since || due > now + 27 * 3_600_000)
                        return;
                    insert.run(eventKey(guildId, boss, at, minutes), guildId, boss, at, minutes, due, due < now - this.lateness ? "missed" : "pending");
                };
                if (s.notifications_enabled) {
                    const intervalEnabled = Boolean(s.interval_respawn_tracking_enabled);
                    for (let day = first; day <= end; day = day.plus({ days: 1 })) {
                        for (const boss of bosses.filter((b) => b.enabled)) {
                            if (!isBossDueOnDay(boss, day, intervalEnabled))
                                continue;
                            for (const time of boss.times)
                                for (const stage of stages(s))
                                    add(boss.id, atTime(day, time).toMillis(), stage);
                        }
                        if (s.daily_enabled)
                            add(0, atTime(day, s.daily_time).toMillis(), -1);
                    }
                }
                db.prepare("UPDATE guild_settings SET last_reconciled=? WHERE guild_id=?").run(now, guildId);
            })();
        }
        this.reconciledAt = now;
        this.revision = this.store.revision;
    }
    async tick() {
        if (this.running)
            return this.running;
        this.running = this.work().finally(() => {
            this.running = null;
        });
        return this.running;
    }
    async work() {
        let now = this.clock();
        if (this.revision !== this.store.revision ||
            now - this.reconciledAt >= 30_000)
            this.reconcile(now);
        const db = this.store.db;
        db.prepare("UPDATE notification_logs SET status='missed',error_message='Lateness window expired' WHERE status='pending' AND scheduled_at<?").run(now - this.lateness);
        if (now - this.cleanedAt > 3_600_000) {
            this.store.cleanupLogs(now);
            db.pragma("wal_checkpoint(PASSIVE)");
            this.cleanedAt = now;
            log("info", "Scheduler health", {
                rssMB: Math.round(process.memoryUsage().rss / 1048576),
                guilds: this.guildIds().length,
            });
        }
        const connected = new Set(this.guildIds());
        const due = db
            .prepare("SELECT * FROM notification_logs WHERE status='pending' AND scheduled_at<=? AND retry_at<=? ORDER BY scheduled_at,event_key LIMIT 500")
            .all(now, now);
        const groups = new Map();
        for (const e of due) {
            if (!connected.has(e.guild_id))
                continue;
            const s = this.store.settings(e.guild_id);
            if (!validEvent(e, s, this.store.bosses(e.guild_id))) {
                db.prepare("UPDATE notification_logs SET status='cancelled' WHERE event_key=?").run(e.event_key);
                continue;
            }
            const key = s.combine_notifications
                ? `${e.guild_id}:${e.spawn_at}:${e.minutes}`
                : e.event_key;
            const group = groups.get(key) ?? [];
            group.push(e);
            groups.set(key, group);
        }
        for (const group of groups.values()) {
            // Bounded batches keep embed and role mention counts below Discord limits.
            for (let offset = 0; offset < group.length; offset += 10) {
                if (this.stopped)
                    return;
                let events = group.slice(offset, offset + 10);
                let sending = false;
                try {
                    const channel = await this.delivery.prepare(events[0].guild_id);
                    now = this.clock();
                    const s = this.store.settings(events[0].guild_id);
                    const bosses = this.store.bosses(s.guild_id);
                    events = events.filter((e) => {
                        const valid = validEvent(e, s, bosses);
                        if (!valid || now - e.scheduled_at > this.lateness) {
                            db.prepare("UPDATE notification_logs SET status=? WHERE event_key=?").run(valid ? "missed" : "cancelled", e.event_key);
                            return false;
                        }
                        return true;
                    });
                    if (!events.length)
                        continue;
                    if (s.notification_channel_id !== channel)
                        throw new SafeRetry("Notification channel changed during preparation");
                    const claim = db.prepare("UPDATE notification_logs SET status='sending',attempts=attempts+1,channel_id=? WHERE event_key=? AND status='pending'");
                    events = db.transaction(() => events.filter((e) => claim.run(channel, e.event_key).changes === 1))();
                    if (!events.length)
                        continue;
                    sending = true;
                    const message = await this.delivery.send(channel, events);
                    db.transaction(() => {
                        for (const e of events)
                            db.prepare("UPDATE notification_logs SET status='sent',message_id=?,sent_at=?,error_message=NULL WHERE event_key=?").run(message, this.clock(), e.event_key);
                    })();
                }
                catch (error) {
                    const retry = !sending || error instanceof SafeRetry;
                    for (const e of events) {
                        const attempt = e.attempts + 1;
                        const status = retry &&
                            attempt < 4 &&
                            this.clock() - e.scheduled_at <= this.lateness
                            ? "pending"
                            : retry
                                ? "missed"
                                : "uncertain";
                        db.prepare("UPDATE notification_logs SET status=?,attempts=?,retry_at=?,error_message=? WHERE event_key=?").run(status, attempt, this.clock() + Math.min(60_000, 5000 * 2 ** attempt), error instanceof SafeRetry
                            ? error.message.slice(0, 180)
                            : errorCode(error), e.event_key);
                    }
                    log("warn", "Notification delivery failed", {
                        guild: events[0]?.guild_id,
                        code: errorCode(error),
                        retry,
                    });
                }
            }
        }
    }
    start() {
        this.recover();
        this.stopped = false;
        const loop = async () => {
            try {
                await this.tick();
            }
            catch (error) {
                log("error", "Scheduler tick failed", { code: errorCode(error) });
            }
            if (!this.stopped)
                this.timer = setTimeout(loop, Math.max(50, 1000 - (this.clock() % 1000)));
        };
        void loop();
    }
    async stop() {
        this.stopped = true;
        if (this.timer)
            clearTimeout(this.timer);
        await this.running;
    }
}
//# sourceMappingURL=scheduler.js.map