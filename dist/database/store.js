import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { z } from "zod";
import { DateTime } from "luxon";
import { migrate } from "./migrations.js";
import { normalizeWeekdays, parseEventDate, parseTimes, ZONE, } from "../utils/time.js";
import { UserError } from "../utils/logger.js";
export const DEFAULT_BOSSES = [
    // 1-Star Bosses (Spawn at 2:00 PM, 6:00 PM, 10:00 PM Philippine Time)
    {
        name: "Lv. 56 Mildis",
        description: "1-Star Boss",
        times: "14:00,18:00,22:00",
        enabled: true,
    },
    {
        name: "Lv. 56 Regan",
        description: "1-Star Boss",
        times: "14:00,18:00,22:00",
        enabled: true,
    },
    {
        name: "Lv. 56 Avok",
        description: "1-Star Boss",
        times: "14:00,18:00,22:00",
        enabled: true,
    },
    {
        name: "Lv. 60 Eligo",
        description: "1-Star Boss",
        times: "14:00,18:00,22:00",
        enabled: true,
    },
    {
        name: "Lv. 60 Lussem",
        description: "1-Star Boss",
        times: "14:00,18:00,22:00",
        enabled: true,
    },
    {
        name: "Lv. 60 Arto",
        description: "1-Star Boss",
        times: "14:00,18:00,22:00",
        enabled: true,
    },
    // 2-Star Bosses (Spawn at 2:00 PM, 10:00 PM Philippine Time)
    {
        name: "Lv. 62 Guardian Beast Gazoth",
        description: "2-Star Boss",
        times: "14:00,22:00",
        enabled: true,
    },
    {
        name: "Lv. 62 Guardian Beast K'Valkan",
        description: "2-Star Boss",
        times: "14:00,22:00",
        enabled: true,
    },
    {
        name: "Lv. 62 Guardian Beast Beherd",
        description: "2-Star Boss",
        times: "14:00,22:00",
        enabled: true,
    },
];
const bossInput = z.object({
    name: z
        .string()
        .trim()
        .min(1)
        .max(80)
        .refine((s) => !/[\r\n\x00-\x1f]/.test(s), "Name must fit on one line"),
    description: z.string().trim().max(800),
    enabled: z.boolean(),
    times: z.string(),
    schedule_type: z
        .enum(["daily", "weekly", "event", "interval"])
        .optional()
        .default("daily"),
    timezone: z.string().optional().default("Asia/Manila"),
    recurrence_days: z.string().nullable().optional(),
    event_date: z.string().nullable().optional(),
    respawn_interval_minutes: z
        .number()
        .int()
        .min(1)
        .max(10080)
        .nullable()
        .optional(),
    respawn_trigger_type: z
        .enum(["defeat", "spawn"])
        .nullable()
        .optional()
        .default("defeat"),
});
export const settingToggles = [
    "notifications_enabled",
    "reminder_30_enabled",
    "reminder_10_enabled",
    "spawn_notification_enabled",
    "combine_notifications",
    "role_mentions_enabled",
    "daily_enabled",
    "interval_respawn_tracking_enabled",
];
const settingsPatch = z
    .object({
    notification_channel_id: z
        .string()
        .regex(/^\d{17,20}$/)
        .nullable()
        .optional(),
    global_alert_role_id: z
        .string()
        .regex(/^\d{17,20}$/)
        .nullable()
        .optional(),
    ...Object.fromEntries(settingToggles.map((k) => [k, z.number().int().min(0).max(1).optional()])),
    reminder_minutes: z
        .string()
        .refine((s) => {
        try {
            const a = JSON.parse(s);
            return (Array.isArray(a) &&
                a.length <= 5 &&
                a.every((n) => Number.isInteger(n) && n >= 1 && n <= 180) &&
                new Set(a).size === a.length);
        }
        catch {
            return false;
        }
    })
        .optional(),
    daily_time: z
        .string()
        .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
        .optional(),
    panel_channel_id: z.string().nullable().optional(),
    panel_message_id: z.string().nullable().optional(),
})
    .strict();
export class Store {
    path;
    schedulerHeartbeat = null;
    schedulerError = null;
    db;
    revision = 0;
    constructor(path) {
        this.path = path;
        if (path !== ":memory:")
            mkdirSync(dirname(path), { recursive: true });
        this.db = new Database(path);
        this.db.pragma("foreign_keys = ON");
        this.db.pragma("journal_mode = WAL");
        this.db.pragma("synchronous = FULL");
        this.db.pragma("busy_timeout = 5000");
        this.db.pragma("max_page_count = 32768");
        try {
            migrate(this.db);
        }
        catch (error) {
            this.db.close();
            throw error;
        }
    }
    close() {
        this.db.close();
    }
    initGuild(guildId, now = Date.now()) {
        this.db.transaction(() => {
            this.db
                .prepare("INSERT OR IGNORE INTO guild_settings(guild_id,created_at,updated_at) VALUES (?,?,?)")
                .run(guildId, now, now);
            // Auto-migrate legacy generic boss entries to individual bosses
            const legacyBosses = this.db
                .prepare("SELECT id FROM bosses WHERE guild_id=? AND name IN ('1-Star Gehenna Boss', '2-Star Gehenna Boss')")
                .all(guildId);
            if (legacyBosses.length > 0) {
                for (const lb of legacyBosses) {
                    this.db.prepare("DELETE FROM bosses WHERE id=?").run(lb.id);
                }
                for (const b of DEFAULT_BOSSES) {
                    this.saveBoss(guildId, b);
                }
                this.db
                    .prepare("UPDATE guild_settings SET defaults_initialized=1 WHERE guild_id=?")
                    .run(guildId);
                return;
            }
            const row = this.db
                .prepare("SELECT defaults_initialized FROM guild_settings WHERE guild_id=?")
                .get(guildId);
            if (row.defaults_initialized)
                return;
            for (const b of DEFAULT_BOSSES) {
                this.saveBoss(guildId, b);
            }
            this.db
                .prepare("UPDATE guild_settings SET defaults_initialized=1 WHERE guild_id=?")
                .run(guildId);
        })();
        this.revision++;
    }
    settings(guildId) {
        const row = this.db
            .prepare("SELECT * FROM guild_settings WHERE guild_id=?")
            .get(guildId);
        if (!row)
            throw new UserError("Guild is not initialized. Try /panel again.");
        return row;
    }
    updateSettings(guildId, patch, userId = "system") {
        const result = settingsPatch.safeParse(patch);
        if (!result.success)
            throw new UserError("Invalid settings. Check IDs, times and reminder intervals.");
        const entries = Object.entries(result.data);
        if (!entries.length)
            return;
        this.db
            .prepare(`UPDATE guild_settings SET ${entries.map(([k]) => `${k}=?`).join(",")},updated_at=? WHERE guild_id=?`)
            .run(...entries.map(([, v]) => v), Date.now(), guildId);
        this.addAuditLog(guildId, userId, "settings_update", "settings", undefined, undefined, JSON.stringify(result.data));
        this.revision++;
    }
    bosses(guildId) {
        const rows = this.db
            .prepare(`SELECT b.*, r.role_id FROM bosses b LEFT JOIN boss_alert_roles r ON r.guild_id=b.guild_id AND r.boss_id=b.id WHERE b.guild_id=? ORDER BY b.id`)
            .all(guildId);
        const times = this.db.prepare("SELECT spawn_time FROM boss_spawn_times WHERE boss_id=? ORDER BY spawn_time");
        return rows.map((b) => ({
            ...b,
            estimated_respawn_at: b.schedule_type === "interval"
                ? (() => {
                    const report = this.latestKillReport(guildId, b.id);
                    return report &&
                        report.report_type !== "alive" &&
                        b.respawn_interval_minutes
                        ? report.reported_at + b.respawn_interval_minutes * 60_000
                        : null;
                })()
                : null,
            schedule_type: b.schedule_type || "daily",
            timezone: b.timezone || "Asia/Manila",
            times: times.all(b.id).map((t) => t.spawn_time),
        }));
    }
    boss(guildId, id) {
        const boss = this.bosses(guildId).find((b) => b.id === id);
        if (!boss)
            throw new UserError("This boss no longer exists. Reopen the panel.");
        return boss;
    }
    saveBoss(guildId, input, id, userId = "system") {
        const result = bossInput.safeParse(input);
        if (!result.success)
            throw new UserError(result.error.issues.map((i) => i.message).join("; "));
        const b = result.data;
        const times = parseTimes(b.times);
        const key = b.name.normalize("NFKC").toLowerCase();
        let oldBoss;
        if (id !== undefined)
            oldBoss = this.boss(guildId, id);
        if (id === undefined && this.bosses(guildId).length >= 100)
            throw new UserError("Limit: 100 bosses per guild. Remove an unused boss first.");
        const duplicate = this.db
            .prepare("SELECT id FROM bosses WHERE guild_id=? AND name_key=? AND id!=?")
            .get(guildId, key, id ?? -1);
        if (duplicate)
            throw new UserError("A boss with that name already exists.");
        if (b.schedule_type === "interval" && !b.respawn_interval_minutes)
            throw new UserError("Set a respawn interval between 1 and 10080 minutes.");
        let recurrence_days = null;
        let event_date = null;
        if (b.schedule_type === "weekly") {
            const days = normalizeWeekdays(b.recurrence_days);
            if (!days.length)
                throw new UserError("Weekly schedule requires at least one weekday (e.g. Mon, Wed, Fri).");
            recurrence_days = JSON.stringify(days);
        }
        else if (b.schedule_type === "event") {
            if (!b.event_date)
                throw new UserError("Special Event schedule requires an event date (YYYY-MM-DD).");
            event_date = parseEventDate(b.event_date);
        }
        const savedId = this.db.transaction(() => {
            const now = Date.now();
            let bossId = id;
            if (bossId === undefined) {
                bossId = Number(this.db
                    .prepare(`INSERT INTO bosses(
                guild_id,name,name_key,description,enabled,created_at,updated_at,
                schedule_type,timezone,recurrence_days,event_date,respawn_interval_minutes,respawn_trigger_type
              ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`)
                    .run(guildId, b.name, key, b.description, Number(b.enabled), now, now, b.schedule_type, b.timezone, recurrence_days, event_date, b.respawn_interval_minutes ?? null, b.respawn_trigger_type).lastInsertRowid);
                this.addAuditLog(guildId, userId, "boss_add", "boss", String(bossId), undefined, b.name);
            }
            else {
                this.db
                    .prepare(`UPDATE bosses SET
              name=?,name_key=?,description=?,enabled=?,updated_at=?,
              schedule_type=?,timezone=?,recurrence_days=?,event_date=?,respawn_interval_minutes=?,respawn_trigger_type=?
            WHERE guild_id=? AND id=?`)
                    .run(b.name, key, b.description, Number(b.enabled), now, b.schedule_type, b.timezone, recurrence_days, event_date, b.respawn_interval_minutes ?? null, b.respawn_trigger_type, guildId, bossId);
                this.addAuditLog(guildId, userId, "boss_edit", "boss", String(bossId), oldBoss?.name, b.name);
            }
            this.db
                .prepare("DELETE FROM boss_spawn_times WHERE boss_id=?")
                .run(bossId);
            const insert = this.db.prepare("INSERT INTO boss_spawn_times(boss_id,spawn_time) VALUES (?,?)");
            times.forEach((t) => insert.run(bossId, t));
            return bossId;
        })();
        this.revision++;
        return this.boss(guildId, savedId);
    }
    removeBoss(guildId, id, userId = "system") {
        const boss = this.boss(guildId, id);
        this.db.transaction(() => {
            this.db
                .prepare("DELETE FROM bosses WHERE guild_id=? AND id=?")
                .run(guildId, id);
            this.db
                .prepare("UPDATE notification_logs SET status='cancelled' WHERE guild_id=? AND boss_id=? AND status='pending'")
                .run(guildId, id);
            this.addAuditLog(guildId, userId, "boss_remove", "boss", String(id), boss.name, undefined);
        })();
        this.revision++;
    }
    addAuditLog(guildId, userId, actionType, targetType, targetId, previousValue, newValue, createdAt = Date.now()) {
        this.db
            .prepare(`INSERT INTO audit_logs (
          guild_id, user_id, action_type, target_type, target_id, previous_value, new_value, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
            .run(guildId, userId, actionType, targetType, targetId ?? null, previousValue ?? null, newValue ?? null, createdAt);
    }
    auditLogs(guildId, filter, limit = 20, offset = 0) {
        let sql = "SELECT * FROM audit_logs WHERE guild_id=?";
        const params = [guildId];
        if (filter === "boss") {
            sql += " AND action_type LIKE 'boss_%'";
        }
        else if (filter === "channel") {
            sql += " AND action_type = 'channel_set'";
        }
        else if (filter === "settings") {
            sql +=
                " AND (action_type = 'settings_update' OR action_type = 'role_set' OR action_type LIKE 'panel_%' OR action_type LIKE 'schedule_%')";
        }
        sql += " ORDER BY created_at DESC LIMIT ? OFFSET ?";
        params.push(limit, offset);
        return this.db.prepare(sql).all(...params);
    }
    auditLogCount(guildId, filter) {
        let sql = "SELECT COUNT(*) AS count FROM audit_logs WHERE guild_id=?";
        const params = [guildId];
        if (filter === "boss") {
            sql += " AND action_type LIKE 'boss_%'";
        }
        else if (filter === "channel") {
            sql += " AND action_type = 'channel_set'";
        }
        else if (filter === "settings") {
            sql +=
                " AND (action_type = 'settings_update' OR action_type = 'role_set' OR action_type LIKE 'panel_%' OR action_type LIKE 'schedule_%')";
        }
        return this.db.prepare(sql).get(...params).count;
    }
    recordKillReport(guildId, bossId, userId, reportType, reportedAt, notes) {
        this.boss(guildId, bossId);
        const latest = this.latestKillReport(guildId, bossId);
        if (reportType === "defeat" &&
            latest?.report_type === "defeat" &&
            Math.abs(reportedAt - latest.reported_at) < 60_000)
            throw new UserError("A defeat was already reported in the last minute. Use the existing timer.");
        const now = Date.now();
        const id = Number(this.db
            .prepare(`INSERT INTO boss_kill_reports (
            guild_id, boss_id, user_id, report_type, reported_at, submitted_at, notes
          ) VALUES (?, ?, ?, ?, ?, ?, ?)`)
            .run(guildId, bossId, userId, reportType, reportedAt, now, notes ?? null).lastInsertRowid);
        this.addAuditLog(guildId, userId, `report_${reportType}`, "boss", String(bossId), undefined, `Reported at ${DateTime.fromMillis(reportedAt, { zone: ZONE }).toISO()}`);
        this.revision++;
        return {
            id,
            guild_id: guildId,
            boss_id: bossId,
            user_id: userId,
            report_type: reportType,
            reported_at: reportedAt,
            submitted_at: now,
            notes: notes ?? null,
        };
    }
    undoLatestReport(guildId, bossId, userId) {
        this.boss(guildId, bossId);
        const report = this.latestKillReport(guildId, bossId);
        if (!report)
            throw new UserError("This boss has no report to undo.");
        this.db.transaction(() => {
            this.db
                .prepare("DELETE FROM boss_kill_reports WHERE guild_id=? AND id=?")
                .run(guildId, report.id);
            this.addAuditLog(guildId, userId, "report_undo", "boss", String(bossId), JSON.stringify(report));
        })();
        this.revision++;
        return report;
    }
    latestKillReport(guildId, bossId) {
        return this.db
            .prepare("SELECT * FROM boss_kill_reports WHERE guild_id=? AND boss_id=? ORDER BY reported_at DESC, id DESC LIMIT 1")
            .get(guildId, bossId);
    }
    killReportHistory(guildId, bossId, limit = 20) {
        return this.db
            .prepare("SELECT * FROM boss_kill_reports WHERE guild_id=? AND boss_id=? ORDER BY reported_at DESC, id DESC LIMIT ?")
            .all(guildId, bossId, limit);
    }
    cleanupLogs(now = Date.now(), historyDays = 30) {
        const auditCutoff = now - 90 * 86_400_000;
        // Preserve the latest report for each boss even when it is older than history.
        this.db
            .prepare("DELETE FROM boss_kill_reports WHERE submitted_at < ? AND id NOT IN (SELECT r.id FROM boss_kill_reports r WHERE r.id=(SELECT id FROM boss_kill_reports newest WHERE newest.guild_id=r.guild_id AND newest.boss_id=r.boss_id ORDER BY reported_at DESC,id DESC LIMIT 1))")
            .run(auditCutoff);
        const deliveryCutoff = now - historyDays * 86_400_000;
        const errorCutoff = now - 14 * 86_400_000;
        this.db
            .prepare("DELETE FROM audit_logs WHERE created_at < ?")
            .run(auditCutoff);
        this.db
            .prepare("DELETE FROM notification_logs WHERE scheduled_at < ? AND status NOT IN ('pending', 'sending')")
            .run(deliveryCutoff);
        this.db
            .prepare("DELETE FROM notification_logs WHERE scheduled_at < ? AND error_message IS NOT NULL AND status NOT IN ('pending', 'sending')")
            .run(errorCutoff);
    }
    getMetadata(key) {
        const row = this.db
            .prepare("SELECT value FROM metadata WHERE key=?")
            .get(key);
        return row?.value;
    }
    setMetadata(key, value) {
        this.db
            .prepare("INSERT INTO metadata(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value")
            .run(key, value);
    }
}
//# sourceMappingURL=store.js.map