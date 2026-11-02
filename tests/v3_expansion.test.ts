import { describe, expect, it, beforeEach } from "vitest";
import { DateTime } from "luxon";
import { Store, type Boss } from "../src/database/store.js";
import { Views } from "../src/ui/views.js";
import { Components } from "../src/ui/components.js";
import {
  ZONE,
  isBossDueOnDay,
  getNextBossOccurrence,
  normalizeWeekdays,
  formatWeeklyDays,
  parseEventDate,
  calculateBossRespawnStatus,
  nextSpawn,
  toUnixSeconds,
} from "../src/utils/time.js";

const G = "123456789012345678";
const U = "987654321098765432";

describe("Gehenna Boss Tracker V3 Feature Expansion", () => {
  let store: Store;
  let views: Views;

  beforeEach(() => {
    store = new Store(":memory:");
    store.initGuild(G);
    views = new Views(store, new Components(store));
  });

  describe("Feature 1 — Advanced Boss Scheduling", () => {
    it("normalizes weekdays flexibly from string, array, or JSON", () => {
      expect(normalizeWeekdays("mon, wed, fri")).toEqual(["mon", "wed", "fri"]);
      expect(normalizeWeekdays("Friday, Monday, Wednesday")).toEqual(["mon", "wed", "fri"]);
      expect(normalizeWeekdays(JSON.stringify(["fri", "mon"]))).toEqual(["mon", "fri"]);
      expect(formatWeeklyDays("mon, wed, fri")).toBe("Mon, Wed, Fri");
      expect(formatWeeklyDays([])).toBe("None");
    });

    it("parses and validates event dates in YYYY-MM-DD format", () => {
      expect(parseEventDate("2026-12-15")).toBe("2026-12-15");
      expect(() => parseEventDate("15-12-2026")).toThrow(/YYYY-MM-DD/);
      expect(() => parseEventDate("invalid-date")).toThrow(/YYYY-MM-DD/);
    });

    it("supports Weekly Fixed Schedules (e.g. Mon, Wed, Fri at 8:00 PM PHT)", () => {
      const boss = store.saveBoss(
        G,
        {
          name: "Ancient World Boss",
          description: "Weekly Boss",
          times: "20:00",
          enabled: true,
          schedule_type: "weekly",
          recurrence_days: "Mon, Wed, Fri",
        },
        undefined,
        U,
      );

      expect(boss.schedule_type).toBe("weekly");
      expect(boss.recurrence_days).toBe(JSON.stringify(["mon", "wed", "fri"]));

      // Test Monday (due)
      const monday = DateTime.fromISO("2026-11-02T10:00:00", { zone: ZONE }); // Monday
      expect(isBossDueOnDay(boss, monday)).toBe(true);

      // Test Tuesday (not due)
      const tuesday = DateTime.fromISO("2026-11-03T10:00:00", { zone: ZONE }); // Tuesday
      expect(isBossDueOnDay(boss, tuesday)).toBe(false);

      // Test Wednesday (due)
      const wednesday = DateTime.fromISO("2026-11-04T10:00:00", { zone: ZONE }); // Wednesday
      expect(isBossDueOnDay(boss, wednesday)).toBe(true);

      // Next occurrence on Tuesday 10:00 AM should be Wednesday 8:00 PM
      const tuesdayMs = tuesday.toMillis();
      const nextAt = getNextBossOccurrence(boss, "20:00", tuesdayMs);
      expect(nextAt).toBeDefined();
      const nextDt = DateTime.fromMillis(nextAt!, { zone: ZONE });
      expect(nextDt.weekdayShort).toBe("Wed");
      expect(nextDt.toFormat("HH:mm")).toBe("20:00");
    });

    it("supports Special Event Schedules (e.g. 2026-12-15 at 7:00 PM PHT)", () => {
      const boss = store.saveBoss(
        G,
        {
          name: "Winter Special Event",
          description: "Special Event Boss",
          times: "19:00",
          enabled: true,
          schedule_type: "event",
          event_date: "2026-12-15",
        },
        undefined,
        U,
      );

      expect(boss.schedule_type).toBe("event");
      expect(boss.event_date).toBe("2026-12-15");

      const eventDay = DateTime.fromISO("2026-12-15T12:00:00", { zone: ZONE });
      const otherDay = DateTime.fromISO("2026-12-16T12:00:00", { zone: ZONE });

      expect(isBossDueOnDay(boss, eventDay)).toBe(true);
      expect(isBossDueOnDay(boss, otherDay)).toBe(false);

      // Before event: occurrence matches
      const beforeEvent = DateTime.fromISO("2026-12-15T10:00:00", { zone: ZONE }).toMillis();
      const occBefore = getNextBossOccurrence(boss, "19:00", beforeEvent);
      expect(occBefore).toBe(DateTime.fromISO("2026-12-15T19:00:00", { zone: ZONE }).toMillis());

      // After event: occurrence is null (does not repeat)
      const afterEvent = DateTime.fromISO("2026-12-15T20:00:00", { zone: ZONE }).toMillis();
      const occAfter = getNextBossOccurrence(boss, "19:00", afterEvent);
      expect(occAfter).toBeNull();
    });

    it("ensures all modal variations strictly comply with Discord limit of <= 5 fields", () => {
      const dailyModal = views.bossModal(G, U, undefined, "daily");
      expect(dailyModal.components.length).toBeLessThanOrEqual(5);
      expect(dailyModal.components.length).toBe(4); // name, times, description, enabled

      const weeklyModal = views.bossModal(G, U, undefined, "weekly");
      expect(weeklyModal.components.length).toBeLessThanOrEqual(5);
      expect(weeklyModal.components.length).toBe(5); // name, days, times, description, enabled

      const eventModal = views.bossModal(G, U, undefined, "event");
      expect(eventModal.components.length).toBeLessThanOrEqual(5);
      expect(eventModal.components.length).toBe(5); // name, event_date, times, description, enabled
    });

    it("renders schedule badge in admin and member boss views", () => {
      const weeklyBoss = store.saveBoss(
        G,
        {
          name: "Ancient World Boss",
          description: "1-Star Boss",
          times: "20:00",
          enabled: true,
          schedule_type: "weekly",
          recurrence_days: "Mon, Fri",
        },
        undefined,
        U,
      );

      const adminView = views.boss(G, U, weeklyBoss.id, false);
      expect(adminView.embeds[0]!.data.description).toContain("Weekly (Mon, Fri)");

      const memberView = views.boss(G, U, weeklyBoss.id, true);
      expect(memberView.embeds[0]!.data.description).toContain("Weekly (Mon, Fri)");
    });
  });

  describe("Feature 2 — Reliability Monitoring & Admin Audit Logs", () => {
    it("records audit logs for boss additions, edits, and deletions", () => {
      const b = store.saveBoss(
        G,
        {
          name: "Test Audit Boss",
          description: "Audit test",
          times: "14:00",
          enabled: true,
        },
        undefined,
        U,
      );

      // Verify boss_add log
      const logs1 = store.auditLogs(G, "boss");
      expect(logs1.length).toBeGreaterThanOrEqual(1);
      expect(logs1[0]!.action_type).toBe("boss_add");
      expect(logs1[0]!.user_id).toBe(U);

      // Edit boss
      store.saveBoss(
        G,
        {
          ...b,
          enabled: Boolean(b.enabled),
          name: "Renamed Audit Boss",
          times: "15:00",
        },
        b.id,
        U,
      );

      const logs2 = store.auditLogs(G, "boss");
      expect(logs2[0]!.action_type).toBe("boss_edit");
      expect(logs2[0]!.previous_value).toBe("Test Audit Boss");
      expect(logs2[0]!.new_value).toBe("Renamed Audit Boss");

      // Delete boss
      store.removeBoss(G, b.id, U);
      const logs3 = store.auditLogs(G, "boss");
      expect(logs3[0]!.action_type).toBe("boss_remove");
    });

    it("filters audit logs by category (boss, channel, settings)", () => {
      store.db.prepare("DELETE FROM audit_logs").run();
      store.addAuditLog(G, U, "channel_set", "channel", "999", "old", "new");
      store.addAuditLog(G, U, "settings_update", "settings", null, null, '{"notifications_enabled":0}');
      store.addAuditLog(G, U, "boss_add", "boss", "1", null, "New Boss");

      expect(store.auditLogs(G, "channel").length).toBe(1);
      expect(store.auditLogs(G, "settings").length).toBe(1);
      expect(store.auditLogs(G, "boss").length).toBe(1);
      expect(store.auditLogs(G, undefined).length).toBe(3);
    });

    it("renders Bot System Status with health indicators and delivery logs button", () => {
      // Record a test delivery log
      store.db
        .prepare(
          `INSERT INTO notification_logs (
            event_key, guild_id, boss_id, spawn_at, minutes, scheduled_at, status, sent_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run("evt_test", G, 1, Date.now() - 60000, 0, Date.now() - 60000, "sent", Date.now() - 59000);

      const statusView = views.status(G, U);
      expect(statusView.embeds[0]!.data.title).toBe("📊 BOT SYSTEM STATUS");
      expect(statusView.embeds[0]!.data.description).toContain("Bot Status:** 🟢 Online");
      expect(statusView.embeds[0]!.data.description).toContain("Scheduler:** 🟢 Running");
      expect(statusView.embeds[0]!.data.description).toContain("Database:** 🟢 Connected");
      expect(statusView.embeds[0]!.data.description).toContain("Last Delivery:** 🟢 Successful");

      // Buttons check
      const btnRow1 = statusView.components[0]!.components.map((c) => (c.toJSON() as any).label);
      expect(btnRow1).toContain("🔄 Refresh");
      expect(btnRow1).toContain("📋 Delivery Logs");
      expect(btnRow1).toContain("📜 Audit Logs");
    });

    it("renders Delivery Logs sub-view with pagination", () => {
      // Insert multiple logs
      for (let i = 0; i < 8; i++) {
        store.db
          .prepare(
            `INSERT INTO notification_logs (
              event_key, guild_id, boss_id, spawn_at, minutes, scheduled_at, status, sent_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(`evt_${i}`, G, 1, Date.now() - (i + 1) * 60000, 30, Date.now() - (i + 1) * 60000, "sent", Date.now() - (i + 1) * 60000);
      }

      const logsView = views.deliveryLogs(G, U, 0);
      expect(logsView.embeds[0]!.data.title).toBe("📋 NOTIFICATION DELIVERY LOGS");
      expect(logsView.embeds[0]!.data.description).toContain("Page 1 of 2 • 8 total events");
      expect(logsView.components[0]!.components.map((c) => (c.toJSON() as any).label)).toContain("Next");
    });

    it("prunes old logs while strictly preserving active bosses and settings", () => {
      store.db.prepare("DELETE FROM audit_logs").run();
      const now = Date.now();
      const oldAuditTime = now - 95 * 86_400_000; // 95 days old (cutoff 90)
      const freshAuditTime = now - 10 * 86_400_000; // 10 days old

      store.addAuditLog(G, U, "boss_add", "boss", "1", null, "Old Boss", oldAuditTime);
      store.addAuditLog(G, U, "boss_add", "boss", "2", null, "Recent Boss", freshAuditTime);

      expect(store.auditLogs(G).length).toBe(2);

      store.cleanupLogs(now);

      const remaining = store.auditLogs(G);
      expect(remaining.length).toBe(1);
      expect(remaining[0]!.new_value).toBe("Recent Boss");

      // Active bosses are completely untouched
      expect(store.bosses(G).length).toBe(9);
    });
  });

  describe("Feature 3 — Manual Boss Kill Status & Respawn Tracking (PREPARED BUT DISABLED)", () => {
    it("ensures interval_respawn_tracking_enabled defaults to disabled (0)", () => {
      const s = store.settings(G);
      expect(s.interval_respawn_tracking_enabled).toBe(0);
    });

    it("correctly calculates boss respawn status for interval-based boss logic", () => {
      const boss = { respawn_interval_minutes: 240 }; // 4 hours

      // No reports -> Unknown
      const sUnknown = calculateBossRespawnStatus(boss);
      expect(sUnknown.status).toBe("unknown");

      // Defeated 1 hour ago -> respawn_pending
      const defeated1hAgo = Date.now() - 60 * 60 * 1000;
      const sPending = calculateBossRespawnStatus(
        boss,
        { report_type: "defeat", reported_at: defeated1hAgo },
        Date.now(),
      );
      expect(sPending.status).toBe("respawn_pending");

      // Defeated 5 hours ago (interval 4 hours) -> estimated_ready
      const defeated5hAgo = Date.now() - 300 * 60 * 1000;
      const sReady = calculateBossRespawnStatus(
        boss,
        { report_type: "defeat", reported_at: defeated5hAgo },
        Date.now(),
      );
      expect(sReady.status).toBe("estimated_ready");

      // Reported alive -> confirmed_alive
      const sAlive = calculateBossRespawnStatus(boss, {
        report_type: "alive",
        reported_at: Date.now() - 5000,
      });
      expect(sAlive.status).toBe("confirmed_alive");
    });

    it("records and queries kill reports in SQLite", () => {
      const b = store.bosses(G)[0]!;
      const rep = store.recordKillReport(G, b.id, U, "defeat", Date.now() - 10000, "Guild raid kill");
      expect(rep.id).toBeDefined();
      expect(rep.report_type).toBe("defeat");
      expect(rep.notes).toBe("Guild raid kill");

      const latest = store.latestKillReport(G, b.id);
      expect(latest?.report_type).toBe("defeat");

      const history = store.killReportHistory(G, b.id);
      expect(history.length).toBe(1);
    });

    it("presents all 4 schedule types in addScheduleType including Interval Respawn", () => {
      const v = views.addScheduleType(G, U);
      expect(v.embeds[0]!.data.title).toBe("➕ SELECT SCHEDULE TYPE");
      expect(v.embeds[0]!.data.description).toContain("Daily Schedule (Type A)");
      expect(v.embeds[0]!.data.description).toContain("Weekly Schedule (Type B)");
      expect(v.embeds[0]!.data.description).toContain("Special Event (Type C)");
      expect(v.embeds[0]!.data.description).toContain("Interval Respawn (Type D)");

      const buttonLabels = v.components.flatMap((r) =>
        r.components.map((c) => (c.toJSON() as any).label),
      );
      expect(buttonLabels).toContain("📅 Daily Schedule");
      expect(buttonLabels).toContain("🗓️ Weekly Schedule");
      expect(buttonLabels).toContain("⭐ Special Event");
      expect(buttonLabels).toContain("⏳ Interval Respawn");
    });

    it("creates a 5-component modal for Interval Respawn complying with Discord limits", () => {
      const modal = views.bossModal(G, U, undefined, "interval");
      expect(modal.data.title).toBe("Add Interval Boss");
      expect(modal.components.length).toBe(5);
      const customIds = modal.components.map(
        (c) => (c.toJSON() as any).components[0].custom_id,
      );
      expect(customIds).toEqual([
        "name",
        "interval",
        "times",
        "description",
        "enabled",
      ]);
    });

    it("saves and parses interval duration into respawn_interval_minutes", () => {
      const b = store.saveBoss(
        G,
        {
          name: "Interval Dragon",
          description: "Interval Boss",
          times: "14:00",
          enabled: true,
          schedule_type: "interval",
          respawn_interval_minutes: 480, // 8 hours
        },
        undefined,
        U,
      );
      expect(b.schedule_type).toBe("interval");
      expect(b.respawn_interval_minutes).toBe(480);

      // Verify boss detail view formatting
      const bView = views.boss(G, U, b.id, false);
      expect(bView.embeds[0]!.data.description).toContain("Interval (8h after defeat)");
      expect(bView.embeds[0]!.data.description).toContain("Respawn Interval:** 8 hours after defeat");
    });
  });
});
