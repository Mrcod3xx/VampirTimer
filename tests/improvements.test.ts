import { afterEach, expect, it, vi } from "vitest";
import { Store, type Event } from "../src/database/store.js";
import { Scheduler } from "../src/services/scheduler.js";
import { nextSpawn } from "../src/utils/time.js";
import { syncCommands } from "../src/services/commandSync.js";
import { Views } from "../src/ui/views.js";
import { Components } from "../src/ui/components.js";
import type { Client } from "discord.js";
const stores: Store[] = [];
const base = new Date("2026-11-05T12:00:00+08:00").getTime();
function setup() {
  const store = new Store(":memory:");
  stores.push(store);
  store.initGuild("g", base);
  for (const b of store.bosses("g")) store.removeBoss("g", b.id);
  store.updateSettings("g", {
    notification_channel_id: "123456789012345678",
    interval_respawn_tracking_enabled: 1,
    daily_enabled: 0,
  });
  const boss = store.saveBoss("g", {
    name: "Dragon",
    description: "",
    times: "23:00,23:30",
    enabled: true,
    schedule_type: "interval",
    respawn_interval_minutes: 60,
  });
  let now = base;
  const sent: Event[][] = [];
  const delivery = {
    prepare: async () => "123456789012345678",
    send: async (_c: string, e: Event[]) => {
      sent.push(e);
      return "message";
    },
  };
  const scheduler = new Scheduler(
    store,
    delivery,
    () => ["g"],
    () => now,
  );
  return {
    store,
    boss,
    sent,
    scheduler,
    delivery,
    now: () => now,
    set: (minutes: number) => {
      now = base + minutes * 60000;
    },
  };
}
afterEach(() => stores.splice(0).forEach((s) => s.close()));
it("uses defeat time for reminders, spawn, and one next-spawn entry despite multiple base times", async () => {
  const t = setup();
  t.store.recordKillReport("g", t.boss.id, "u", "defeat", base);
  await t.scheduler.tick();
  expect(nextSpawn(t.store.bosses("g"), base, true)).toMatchObject({
    at: base + 3600000,
  });
  expect(nextSpawn(t.store.bosses("g"), base, true)!.bosses).toHaveLength(1);
  t.set(30);
  await t.scheduler.tick();
  t.set(50);
  await t.scheduler.tick();
  t.set(60);
  await t.scheduler.tick();
  expect(t.sent.map((e) => e[0]!.minutes)).toEqual([30, 10, 0]);
  await t.scheduler.tick();
  expect(t.sent).toHaveLength(3);
  t.set(660);
  await t.scheduler.tick();
  expect(t.sent).toHaveLength(3);
});
it("does not create fixed-time interval alerts without a defeat report", async () => {
  const t = setup();
  t.set(660);
  await t.scheduler.tick();
  expect(t.sent).toHaveLength(0);
  expect(nextSpawn(t.store.bosses("g"), base, true)).toBeNull();
});
it("replaces unsent estimates after a new report, supports alive and undo, rejects duplicate reports", async () => {
  const t = setup();
  t.store.recordKillReport("g", t.boss.id, "u", "defeat", base);
  await t.scheduler.tick();
  expect(() =>
    t.store.recordKillReport("g", t.boss.id, "v", "defeat", base + 1000),
  ).toThrow("already reported");
  expect(() =>
    t.store.recordKillReport("g", t.boss.id, "v", "defeat", base + 15 * 60_000),
  ).toThrow("has not spawned yet");
  t.store.recordKillReport("g", t.boss.id, "u", "correction", base + 600000);
  t.set(30);
  await t.scheduler.tick();
  expect(t.sent).toHaveLength(0);
  t.store.recordKillReport("g", t.boss.id, "u", "alive", base + 1800000);
  t.set(40);
  await t.scheduler.tick();
  expect(t.sent).toHaveLength(0);
  t.store.undoLatestReport("g", t.boss.id, "admin");
  await t.scheduler.tick();
  expect(t.sent).toHaveLength(1);
});
it("preserves disabled tracking and expires missed respawns across restart", async () => {
  const t = setup();
  t.store.recordKillReport("g", t.boss.id, "u", "defeat", base);
  await t.scheduler.tick();
  t.store.updateSettings("g", { interval_respawn_tracking_enabled: 0 });
  t.set(30);
  await t.scheduler.tick();
  expect(t.sent).toHaveLength(0);
  t.store.updateSettings("g", { interval_respawn_tracking_enabled: 1 });
  t.set(33);
  await t.scheduler.tick();
  t.set(65);
  const restarted = new Scheduler(t.store, t.delivery, () => ["g"], t.now);
  restarted.recover();
  await restarted.tick();
  expect(t.sent).toHaveLength(0);
  expect(
    t.store.db
      .prepare("SELECT * FROM notification_logs WHERE status='missed'")
      .all().length,
  ).toBeGreaterThan(0);
});
it("does not present future pending rows as a failed last delivery", async () => {
  const t = setup();
  t.store.recordKillReport("g", t.boss.id, "u", "defeat", base);
  await t.scheduler.tick();
  const v = new Views(t.store, new Components(t.store), t.now);
  const text = v.status("g", "u").embeds[0]!.data.description!;
  expect(text).toContain("Last Delivery:** No events yet");
  expect(text).toContain("Scheduler:** 🟢 Running");
  t.store.updateSettings("g", { notifications_enabled: 0 });
  expect(v.status("g", "u").embeds[0]!.data.description).toContain(
    "Paused by administrator",
  );
});
it("syncs commands once, does no API writes on unchanged restart, and retries after failure", async () => {
  const t = setup();
  const globalSet = vi.fn().mockResolvedValue(undefined);
  const guildSet = vi.fn().mockResolvedValue(undefined);
  const client = {
    application: { id: "app", commands: { set: globalSet } },
    guilds: {
      cache: new Map([["g", { id: "g", commands: { set: guildSet } }]]),
    },
  } as unknown as Client;
  await syncCommands(t.store, client);
  await syncCommands(t.store, client);
  expect(globalSet).toHaveBeenCalledTimes(1);
  expect(guildSet).toHaveBeenCalledTimes(1);
  await syncCommands(t.store, client, "g");
  expect(globalSet).toHaveBeenLastCalledWith([]);
  expect(guildSet).toHaveBeenCalledTimes(2);
  globalSet.mockRejectedValueOnce(new Error("429"));
  await expect(syncCommands(t.store, client)).rejects.toThrow();
  await syncCommands(t.store, client);
  expect(globalSet).toHaveBeenCalledTimes(4);
});
