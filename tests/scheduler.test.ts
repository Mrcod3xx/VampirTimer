import { afterEach, expect, it } from "vitest";
import { DateTime } from "luxon";
import { Store, type Event } from "../src/database/store.js";
import { Scheduler, SafeRetry } from "../src/services/scheduler.js";
const opened: Store[] = [];
afterEach(() => opened.splice(0).forEach((s) => s.close()));
const instant = (s: string) => DateTime.fromISO(s + "+08:00").toMillis();
function setup(start = "2026-10-31T13:30:00") {
  const s = new Store(":memory:");
  opened.push(s);
  let now = instant(start);
  s.initGuild("a", now);
  s.updateSettings("a", { notification_channel_id: "123456789012345678" });
  const sent: Event[][] = [];
  const delivery = {
    prepare: async () => s.settings("a").notification_channel_id!,
    send: async (_c: string, e: Event[]) => {
      sent.push(e);
      return "message";
    },
  };
  const scheduler = new Scheduler(
    s,
    delivery,
    () => ["a"],
    () => now,
  );
  return {
    s,
    sent,
    scheduler,
    delivery,
    set: (t: string) => {
      now = instant(t);
    },
  };
}
it("groups simultaneous reminders and prevents repeat sends across ticks/restarts", async () => {
  const t = setup();
  await t.scheduler.tick();
  expect(t.sent).toHaveLength(1);
  expect(t.sent[0]).toHaveLength(2);
  await t.scheduler.tick();
  t.scheduler.recover();
  await t.scheduler.tick();
  expect(t.sent).toHaveLength(1);
  t.set("2026-10-31T13:50:00");
  await t.scheduler.tick();
  expect(t.sent[1]![0]!.minutes).toBe(10);
  t.set("2026-10-31T14:00:00");
  await t.scheduler.tick();
  expect(t.sent[2]![0]!.minutes).toBe(0);
});
it("expires offline events and resumes a recent event", async () => {
  const t = setup();
  await t.scheduler.tick();
  t.set("2026-10-31T14:01:00");
  await t.scheduler.tick();
  expect(t.sent).toHaveLength(2);
  expect(t.sent[1]![0]!.minutes).toBe(0);
  expect(
    t.s.db
      .prepare(
        "SELECT * FROM notification_logs WHERE status='missed' AND minutes=10",
      )
      .all(),
  ).toHaveLength(2);
});
it("handles reminders crossing midnight", async () => {
  const t = setup("2026-10-31T23:40:00");
  t.s.saveBoss("a", {
    name: "Midnight",
    description: "",
    enabled: true,
    times: "00:10",
  });
  await t.scheduler.tick();
  expect(t.sent[0]![0]).toMatchObject({
    minutes: 30,
    spawn_at: instant("2026-11-01T00:10:00"),
  });
});
it("cancels disabled bosses and stages, and changing combine never repeats sent events", async () => {
  const t = setup();
  t.s.updateSettings("a", { reminder_30_enabled: 0 });
  await t.scheduler.tick();
  expect(t.sent).toHaveLength(0);
  t.s.updateSettings("a", { reminder_30_enabled: 1 });
  await t.scheduler.tick();
  expect(t.sent).toHaveLength(1);
  t.s.updateSettings("a", { combine_notifications: 0 });
  await t.scheduler.tick();
  expect(t.sent).toHaveLength(1);
  const b = t.s.bosses("a")[0]!;
  t.s.saveBoss("a", { ...b, enabled: false, times: b.times.join(",") }, b.id);
  t.set("2026-10-31T13:50:00");
  await t.scheduler.tick();
  expect(t.sent[1]).toHaveLength(1);
});
it("never resends a crash-ambiguous claim", async () => {
  const t = setup();
  t.scheduler.reconcile(instant("2026-10-31T13:30:00"));
  t.s.db
    .prepare(
      "UPDATE notification_logs SET status='sending' WHERE minutes=30 AND scheduled_at=?",
    )
    .run(instant("2026-10-31T13:30:00"));
  t.scheduler.recover();
  await t.scheduler.tick();
  expect(t.sent).toHaveLength(0);
  expect(
    t.s.db
      .prepare("SELECT * FROM notification_logs WHERE status='uncertain'")
      .all(),
  ).toHaveLength(2);
});
it("retries safe failures with backoff but not ambiguous network sends", async () => {
  const t = setup();
  t.delivery.prepare = async () => {
    throw new SafeRetry("Missing channel");
  };
  await t.scheduler.tick();
  expect(
    t.s.db
      .prepare(
        "SELECT * FROM notification_logs WHERE attempts=1 AND status='pending'",
      )
      .all(),
  ).toHaveLength(2);
  t.set("2026-10-31T13:30:11");
  t.delivery.prepare = async () => t.s.settings("a").notification_channel_id!;
  t.delivery.send = async () => {
    throw new Error("Socket closed");
  };
  await t.scheduler.tick();
  expect(
    t.s.db
      .prepare("SELECT * FROM notification_logs WHERE status='uncertain'")
      .all(),
  ).toHaveLength(2);
});
it("rechecks lateness and channel after asynchronous preparation", async () => {
  const t = setup();
  t.delivery.prepare = async () => {
    t.set("2026-10-31T13:33:00");
    return t.s.settings("a").notification_channel_id!;
  };
  await t.scheduler.tick();
  expect(t.sent).toHaveLength(0);
});
it("generates a non-pinging daily schedule event", async () => {
  const t = setup("2026-10-31T08:00:00");
  await t.scheduler.tick();
  expect(t.sent[0]![0]!.minutes).toBe(-1);
});
