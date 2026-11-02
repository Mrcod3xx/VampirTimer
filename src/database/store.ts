import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { z } from "zod";
import { DateTime } from "luxon";
import { migrate } from "./migrations.js";
import {
  normalizeWeekdays,
  parseEventDate,
  parseTimes,
  ZONE,
} from "../utils/time.js";
import { UserError } from "../utils/logger.js";

export const DEFAULT_BOSSES: Array<{
  name: string;
  description: string;
  times: string;
  enabled: boolean;
}> = [
  // 1-Star Bosses (Spawn at 2:00 PM, 6:00 PM, 10:00 PM Philippine Time)
  { name: "Lv. 56 Mildis", description: "1-Star Boss", times: "14:00,18:00,22:00", enabled: true },
  { name: "Lv. 56 Regan", description: "1-Star Boss", times: "14:00,18:00,22:00", enabled: true },
  { name: "Lv. 56 Avok", description: "1-Star Boss", times: "14:00,18:00,22:00", enabled: true },
  { name: "Lv. 60 Eligo", description: "1-Star Boss", times: "14:00,18:00,22:00", enabled: true },
  { name: "Lv. 60 Lussem", description: "1-Star Boss", times: "14:00,18:00,22:00", enabled: true },
  { name: "Lv. 60 Arto", description: "1-Star Boss", times: "14:00,18:00,22:00", enabled: true },

  // 2-Star Bosses (Spawn at 2:00 PM, 10:00 PM Philippine Time)
  { name: "Lv. 62 Guardian Beast Gazoth", description: "2-Star Boss", times: "14:00,22:00", enabled: true },
  { name: "Lv. 62 Guardian Beast K'Valkan", description: "2-Star Boss", times: "14:00,22:00", enabled: true },
  { name: "Lv. 62 Guardian Beast Beherd", description: "2-Star Boss", times: "14:00,22:00", enabled: true },
];

export interface Settings {
  guild_id: string;
  notification_channel_id: string | null;
  global_alert_role_id: string | null;
  notifications_enabled: number;
  reminder_30_enabled: number;
  reminder_10_enabled: number;
  spawn_notification_enabled: number;
  combine_notifications: number;
  role_mentions_enabled: number;
  reminder_minutes: string;
  daily_enabled: number;
  daily_time: string;
  panel_channel_id: string | null;
  panel_message_id: string | null;
  last_reconciled: number | null;
  interval_respawn_tracking_enabled: number;
  created_at: number;
  updated_at: number;
}

export type ScheduleType = "daily" | "weekly" | "event" | "interval";

export interface Boss {
  id: number;
  guild_id: string;
  name: string;
  description: string;
  enabled: number;
  times: string[];
  role_id: string | null;
  schedule_type: ScheduleType;
  timezone: string;
  recurrence_days: string | null;
  event_date: string | null;
  respawn_interval_minutes: number | null;
  respawn_trigger_type: "defeat" | "spawn" | null;
}

export interface AuditLog {
  id: number;
  guild_id: string;
  user_id: string;
  action_type: string;
  target_type: string;
  target_id: string | null;
  previous_value: string | null;
  new_value: string | null;
  created_at: number;
}

export interface BossKillReport {
  id: number;
  guild_id: string;
  boss_id: number;
  user_id: string;
  report_type: "defeat" | "alive" | "correction";
  reported_at: number;
  submitted_at: number;
  notes: string | null;
}

export interface Event {
  event_key: string;
  guild_id: string;
  boss_id: number;
  spawn_at: number;
  minutes: number;
  scheduled_at: number;
  status: string;
  attempts: number;
  retry_at: number;
}

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
] as const;

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
    ...Object.fromEntries(
      settingToggles.map((k) => [k, z.number().int().min(0).max(1).optional()]),
    ),
    reminder_minutes: z
      .string()
      .refine((s) => {
        try {
          const a: unknown = JSON.parse(s);
          return (
            Array.isArray(a) &&
            a.length <= 5 &&
            a.every((n) => Number.isInteger(n) && n >= 1 && n <= 180) &&
            new Set(a).size === a.length
          );
        } catch {
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
  readonly db: Database.Database;
  revision = 0;
  constructor(readonly path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new Database(path);
    this.db.pragma("foreign_keys = ON");
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("synchronous = FULL");
    this.db.pragma("busy_timeout = 5000");
    this.db.pragma("max_page_count = 32768");
    try {
      migrate(this.db);
    } catch (error) {
      this.db.close();
      throw error;
    }
  }
  close() {
    this.db.close();
  }
  initGuild(guildId: string, now = Date.now()) {
    this.db.transaction(() => {
      this.db
        .prepare(
          "INSERT OR IGNORE INTO guild_settings(guild_id,created_at,updated_at) VALUES (?,?,?)",
        )
        .run(guildId, now, now);

      // Auto-migrate legacy generic boss entries to individual bosses
      const legacyBosses = this.db
        .prepare(
          "SELECT id FROM bosses WHERE guild_id=? AND name IN ('1-Star Gehenna Boss', '2-Star Gehenna Boss')",
        )
        .all(guildId) as { id: number }[];

      if (legacyBosses.length > 0) {
        for (const lb of legacyBosses) {
          this.db.prepare("DELETE FROM bosses WHERE id=?").run(lb.id);
        }
        for (const b of DEFAULT_BOSSES) {
          this.saveBoss(guildId, b);
        }
        this.db
          .prepare(
            "UPDATE guild_settings SET defaults_initialized=1 WHERE guild_id=?",
          )
          .run(guildId);
        return;
      }

      const row = this.db
        .prepare(
          "SELECT defaults_initialized FROM guild_settings WHERE guild_id=?",
        )
        .get(guildId) as { defaults_initialized: number };
      if (row.defaults_initialized) return;

      for (const b of DEFAULT_BOSSES) {
        this.saveBoss(guildId, b);
      }
      this.db
        .prepare(
          "UPDATE guild_settings SET defaults_initialized=1 WHERE guild_id=?",
        )
        .run(guildId);
    })();
    this.revision++;
  }
  settings(guildId: string): Settings {
    const row = this.db
      .prepare("SELECT * FROM guild_settings WHERE guild_id=?")
      .get(guildId) as Settings | undefined;
    if (!row)
      throw new UserError("Guild is not initialized. Try /panel again.");
    return row;
  }
  updateSettings(
    guildId: string,
    patch: Partial<Settings>,
    userId = "system",
  ) {
    const result = settingsPatch.safeParse(patch);
    if (!result.success)
      throw new UserError(
        "Invalid settings. Check IDs, times and reminder intervals.",
      );
    const entries = Object.entries(result.data);
    if (!entries.length) return;
    this.db
      .prepare(
        `UPDATE guild_settings SET ${entries.map(([k]) => `${k}=?`).join(",")},updated_at=? WHERE guild_id=?`,
      )
      .run(...entries.map(([, v]) => v), Date.now(), guildId);
    this.addAuditLog(
      guildId,
      userId,
      "settings_update",
      "settings",
      undefined,
      undefined,
      JSON.stringify(result.data),
    );
    this.revision++;
  }
  bosses(guildId: string): Boss[] {
    const rows = this.db
      .prepare(
        `SELECT b.*, r.role_id FROM bosses b LEFT JOIN boss_alert_roles r ON r.guild_id=b.guild_id AND r.boss_id=b.id WHERE b.guild_id=? ORDER BY b.id`,
      )
      .all(guildId) as Omit<Boss, "times">[];
    const times = this.db.prepare(
      "SELECT spawn_time FROM boss_spawn_times WHERE boss_id=? ORDER BY spawn_time",
    );
    return rows.map((b) => ({
      ...b,
      schedule_type: b.schedule_type || "daily",
      timezone: b.timezone || "Asia/Manila",
      times: (times.all(b.id) as { spawn_time: string }[]).map(
        (t) => t.spawn_time,
      ),
    }));
  }
  boss(guildId: string, id: number): Boss {
    const boss = this.bosses(guildId).find((b) => b.id === id);
    if (!boss)
      throw new UserError("This boss no longer exists. Reopen the panel.");
    return boss;
  }
  saveBoss(
    guildId: string,
    input: z.input<typeof bossInput>,
    id?: number,
    userId = "system",
  ): Boss {
    const result = bossInput.safeParse(input);
    if (!result.success)
      throw new UserError(result.error.issues.map((i) => i.message).join("; "));
    const b = result.data;
    const times = parseTimes(b.times);
    const key = b.name.normalize("NFKC").toLowerCase();
    let oldBoss: Boss | undefined;
    if (id !== undefined) oldBoss = this.boss(guildId, id);
    if (id === undefined && this.bosses(guildId).length >= 100)
      throw new UserError(
        "Limit: 100 bosses per guild. Remove an unused boss first.",
      );
    const duplicate = this.db
      .prepare(
        "SELECT id FROM bosses WHERE guild_id=? AND name_key=? AND id!=?",
      )
      .get(guildId, key, id ?? -1);
    if (duplicate) throw new UserError("A boss with that name already exists.");

    let recurrence_days: string | null = null;
    let event_date: string | null = null;
    if (b.schedule_type === "weekly") {
      const days = normalizeWeekdays(b.recurrence_days);
      if (!days.length)
        throw new UserError(
          "Weekly schedule requires at least one weekday (e.g. Mon, Wed, Fri).",
        );
      recurrence_days = JSON.stringify(days);
    } else if (b.schedule_type === "event") {
      if (!b.event_date)
        throw new UserError(
          "Special Event schedule requires an event date (YYYY-MM-DD).",
        );
      event_date = parseEventDate(b.event_date);
    }

    const savedId = this.db.transaction(() => {
      const now = Date.now();
      let bossId = id;
      if (bossId === undefined) {
        bossId = Number(
          this.db
            .prepare(
              `INSERT INTO bosses(
                guild_id,name,name_key,description,enabled,created_at,updated_at,
                schedule_type,timezone,recurrence_days,event_date,respawn_interval_minutes,respawn_trigger_type
              ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
            )
            .run(
              guildId,
              b.name,
              key,
              b.description,
              Number(b.enabled),
              now,
              now,
              b.schedule_type,
              b.timezone,
              recurrence_days,
              event_date,
              b.respawn_interval_minutes ?? null,
              b.respawn_trigger_type,
            ).lastInsertRowid,
        );
        this.addAuditLog(
          guildId,
          userId,
          "boss_add",
          "boss",
          String(bossId),
          undefined,
          b.name,
        );
      } else {
        this.db
          .prepare(
            `UPDATE bosses SET
              name=?,name_key=?,description=?,enabled=?,updated_at=?,
              schedule_type=?,timezone=?,recurrence_days=?,event_date=?,respawn_interval_minutes=?,respawn_trigger_type=?
            WHERE guild_id=? AND id=?`,
          )
          .run(
            b.name,
            key,
            b.description,
            Number(b.enabled),
            now,
            b.schedule_type,
            b.timezone,
            recurrence_days,
            event_date,
            b.respawn_interval_minutes ?? null,
            b.respawn_trigger_type,
            guildId,
            bossId,
          );
        this.addAuditLog(
          guildId,
          userId,
          "boss_edit",
          "boss",
          String(bossId),
          oldBoss?.name,
          b.name,
        );
      }
      this.db
        .prepare("DELETE FROM boss_spawn_times WHERE boss_id=?")
        .run(bossId);
      const insert = this.db.prepare(
        "INSERT INTO boss_spawn_times(boss_id,spawn_time) VALUES (?,?)",
      );
      times.forEach((t) => insert.run(bossId, t));
      return bossId;
    })();
    this.revision++;
    return this.boss(guildId, savedId);
  }
  removeBoss(guildId: string, id: number, userId = "system") {
    const boss = this.boss(guildId, id);
    this.db.transaction(() => {
      this.db
        .prepare("DELETE FROM bosses WHERE guild_id=? AND id=?")
        .run(guildId, id);
      this.db
        .prepare(
          "UPDATE notification_logs SET status='cancelled' WHERE guild_id=? AND boss_id=? AND status='pending'",
        )
        .run(guildId, id);
      this.addAuditLog(
        guildId,
        userId,
        "boss_remove",
        "boss",
        String(id),
        boss.name,
        undefined,
      );
    })();
    this.revision++;
  }
  addAuditLog(
    guildId: string,
    userId: string,
    actionType: string,
    targetType: string,
    targetId?: string | null,
    previousValue?: string | null,
    newValue?: string | null,
    createdAt = Date.now(),
  ) {
    this.db
      .prepare(
        `INSERT INTO audit_logs (
          guild_id, user_id, action_type, target_type, target_id, previous_value, new_value, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        guildId,
        userId,
        actionType,
        targetType,
        targetId ?? null,
        previousValue ?? null,
        newValue ?? null,
        createdAt,
      );
  }
  auditLogs(
    guildId: string,
    filter?: string,
    limit = 20,
    offset = 0,
  ): AuditLog[] {
    let sql = "SELECT * FROM audit_logs WHERE guild_id=?";
    const params: (string | number)[] = [guildId];

    if (filter === "boss") {
      sql += " AND action_type LIKE 'boss_%'";
    } else if (filter === "channel") {
      sql += " AND action_type = 'channel_set'";
    } else if (filter === "settings") {
      sql +=
        " AND (action_type = 'settings_update' OR action_type = 'role_set' OR action_type LIKE 'panel_%' OR action_type LIKE 'schedule_%')";
    }

    sql += " ORDER BY created_at DESC LIMIT ? OFFSET ?";
    params.push(limit, offset);

    return this.db.prepare(sql).all(...params) as AuditLog[];
  }
  auditLogCount(guildId: string, filter?: string): number {
    let sql = "SELECT COUNT(*) AS count FROM audit_logs WHERE guild_id=?";
    const params: string[] = [guildId];

    if (filter === "boss") {
      sql += " AND action_type LIKE 'boss_%'";
    } else if (filter === "channel") {
      sql += " AND action_type = 'channel_set'";
    } else if (filter === "settings") {
      sql +=
        " AND (action_type = 'settings_update' OR action_type = 'role_set' OR action_type LIKE 'panel_%' OR action_type LIKE 'schedule_%')";
    }

    return (this.db.prepare(sql).get(...params) as { count: number }).count;
  }
  recordKillReport(
    guildId: string,
    bossId: number,
    userId: string,
    reportType: "defeat" | "alive" | "correction",
    reportedAt: number,
    notes?: string,
  ): BossKillReport {
    this.boss(guildId, bossId);
    const now = Date.now();
    const id = Number(
      this.db
        .prepare(
          `INSERT INTO boss_kill_reports (
            guild_id, boss_id, user_id, report_type, reported_at, submitted_at, notes
          ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          guildId,
          bossId,
          userId,
          reportType,
          reportedAt,
          now,
          notes ?? null,
        ).lastInsertRowid,
    );
    this.addAuditLog(
      guildId,
      userId,
      `report_${reportType}`,
      "boss",
      String(bossId),
      undefined,
      `Reported at ${DateTime.fromMillis(reportedAt, { zone: ZONE }).toISO()}`,
    );
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
  latestKillReport(guildId: string, bossId: number): BossKillReport | undefined {
    return this.db
      .prepare(
        "SELECT * FROM boss_kill_reports WHERE guild_id=? AND boss_id=? ORDER BY reported_at DESC, id DESC LIMIT 1",
      )
      .get(guildId, bossId) as BossKillReport | undefined;
  }
  killReportHistory(
    guildId: string,
    bossId: number,
    limit = 20,
  ): BossKillReport[] {
    return this.db
      .prepare(
        "SELECT * FROM boss_kill_reports WHERE guild_id=? AND boss_id=? ORDER BY reported_at DESC, id DESC LIMIT ?",
      )
      .all(guildId, bossId, limit) as BossKillReport[];
  }
  cleanupLogs(now = Date.now()) {
    const auditCutoff = now - 90 * 86_400_000;
    const deliveryCutoff = now - 30 * 86_400_000;
    const errorCutoff = now - 14 * 86_400_000;
    this.db
      .prepare("DELETE FROM audit_logs WHERE created_at < ?")
      .run(auditCutoff);
    this.db
      .prepare(
        "DELETE FROM notification_logs WHERE scheduled_at < ? AND status NOT IN ('pending', 'sending')",
      )
      .run(deliveryCutoff);
    this.db
      .prepare(
        "DELETE FROM notification_logs WHERE scheduled_at < ? AND error_message IS NOT NULL AND status NOT IN ('pending', 'sending')",
      )
      .run(errorCutoff);
  }
}
