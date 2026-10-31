import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { z } from "zod";
import { migrate } from "./migrations.js";
import { parseTimes } from "../utils/time.js";
import { UserError } from "../utils/logger.js";

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
  created_at: number;
  updated_at: number;
}
export interface Boss {
  id: number;
  guild_id: string;
  name: string;
  description: string;
  enabled: number;
  times: string[];
  role_id: string | null;
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
});
export const settingToggles = [
  "notifications_enabled",
  "reminder_30_enabled",
  "reminder_10_enabled",
  "spawn_notification_enabled",
  "combine_notifications",
  "role_mentions_enabled",
  "daily_enabled",
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
      const row = this.db
        .prepare(
          "SELECT defaults_initialized FROM guild_settings WHERE guild_id=?",
        )
        .get(guildId) as { defaults_initialized: number };
      if (row.defaults_initialized) return;
      this.saveBoss(guildId, {
        name: "1-Star Gehenna Boss",
        description: "Lv. 56 Mildis · Lv. 56 Regan · Lv. 56 Avok · Lv. 60 Eligo · Lv. 60 Lussem · Lv. 60 Arto",
        enabled: true,
        times: "14:00,18:00,22:00",
      });
      this.saveBoss(guildId, {
        name: "2-Star Gehenna Boss",
        description: "Lv. 62 Guardian Beast Gazoth · Lv. 62 Guardian Beast K'Valkan · Lv. 62 Guardian Beast Beherd",
        enabled: true,
        times: "14:00,22:00",
      });
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
  updateSettings(guildId: string, patch: Partial<Settings>) {
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
      times: (times.all(b.id) as { spawn_time: string }[]).map(
        (t) => t.spawn_time,
      ),
    }));
  }
  boss(guildId: string, id: number) {
    const boss = this.bosses(guildId).find((b) => b.id === id);
    if (!boss)
      throw new UserError("This boss no longer exists. Reopen the panel.");
    return boss;
  }
  saveBoss(guildId: string, input: z.input<typeof bossInput>, id?: number) {
    const result = bossInput.safeParse(input);
    if (!result.success)
      throw new UserError(result.error.issues.map((i) => i.message).join("; "));
    const b = result.data;
    const times = parseTimes(b.times);
    const key = b.name.normalize("NFKC").toLowerCase();
    if (id !== undefined) this.boss(guildId, id);
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
    const savedId = this.db.transaction(() => {
      const now = Date.now();
      let bossId = id;
      if (bossId === undefined)
        bossId = Number(
          this.db
            .prepare(
              "INSERT INTO bosses(guild_id,name,name_key,description,enabled,created_at,updated_at) VALUES (?,?,?,?,?,?,?)",
            )
            .run(
              guildId,
              b.name,
              key,
              b.description,
              Number(b.enabled),
              now,
              now,
            ).lastInsertRowid,
        );
      else
        this.db
          .prepare(
            "UPDATE bosses SET name=?,name_key=?,description=?,enabled=?,updated_at=? WHERE guild_id=? AND id=?",
          )
          .run(
            b.name,
            key,
            b.description,
            Number(b.enabled),
            now,
            guildId,
            bossId,
          );
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
  removeBoss(guildId: string, id: number) {
    this.boss(guildId, id);
    this.db.transaction(() => {
      this.db
        .prepare("DELETE FROM bosses WHERE guild_id=? AND id=?")
        .run(guildId, id);
      this.db
        .prepare(
          "UPDATE notification_logs SET status='cancelled' WHERE guild_id=? AND boss_id=? AND status='pending'",
        )
        .run(guildId, id);
      // Keep role receipts after deletion so members can still remove old opt-in roles.
    })();
    this.revision++;
  }
}
