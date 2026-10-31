import { afterEach, beforeEach, expect, it } from "vitest";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../src/database/store.js";
import {
  backup,
  restore,
  verifyDatabase,
  acquireProcessLock,
} from "../src/services/backup.js";
let dir: string;
let store: Store;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "boss-tracker-"));
  store = new Store(join(dir, "live.db"));
  store.initGuild("a");
});
afterEach(() => {
  if (store.db.open) store.close();
  rmSync(dir, { recursive: true, force: true });
});
it("persists settings, roles, subscriptions and schema across reopen", () => {
  store.updateSettings("a", { notification_channel_id: "123456789012345678" });
  store.db
    .prepare("INSERT INTO member_subscriptions VALUES (?,?,?,?,?)")
    .run("a", "u", 0, "r", 0);
  store.close();
  store = new Store(join(dir, "live.db"));
  store.initGuild("a");
  expect(store.bosses("a")).toHaveLength(2);
  expect(store.settings("a").notification_channel_id).toBe(
    "123456789012345678",
  );
  expect(
    store.db.prepare("SELECT * FROM member_subscriptions").all(),
  ).toHaveLength(1);
  expect(
    store.db.prepare("SELECT * FROM schema_migrations").all(),
  ).toHaveLength(1);
});
it("creates verified WAL-safe snapshots, keeps three, and restores them", async () => {
  const first = await backup(store);
  expect(verifyDatabase(first).guilds).toBe(1);
  store.removeBoss("a", store.bosses("a")[0]!.id);
  store.close();
  await restore(first, join(dir, "live.db"));
  store = new Store(join(dir, "live.db"));
  expect(store.bosses("a")).toHaveLength(2);
  for (let i = 0; i < 4; i++) await backup(store);
  expect(
    readdirSync(join(dir, "backups")).filter((n) => n.endsWith(".db")),
  ).toHaveLength(3);
});
it("blocks a second process and restoration while the bot holds its lock", async () => {
  const release = acquireProcessLock(store.path);
  const snapshot = await backup(store);
  expect(() => acquireProcessLock(store.path)).toThrow("already");
  await expect(restore(snapshot, store.path)).rejects.toThrow("already");
  release();
  const next = acquireProcessLock(store.path);
  next();
});
it("rejects a database from a future migration version", () => {
  store.db.prepare("INSERT INTO schema_migrations VALUES (?,?)").run(999, 0);
  store.close();
  expect(() => new Store(join(dir, "live.db"))).toThrow("newer");
});

it("keeps a sent notification ledger across an actual SQLite close and reopen", async () => {
  const { Scheduler } = await import("../src/services/scheduler.js");
  const now = new Date("2026-10-31T13:30:00+08:00").getTime();
  store.db
    .prepare(
      "UPDATE guild_settings SET created_at=?,last_reconciled=NULL WHERE guild_id=?",
    )
    .run(now, "a");
  store.updateSettings("a", { notification_channel_id: "123456789012345678" });
  let sent = 0;
  const delivery = {
    prepare: async () => "123456789012345678",
    send: async () => String(++sent),
  };
  await new Scheduler(
    store,
    delivery,
    () => ["a"],
    () => now,
  ).tick();
  expect(sent).toBe(1);
  store.close();
  store = new Store(join(dir, "live.db"));
  const restarted = new Scheduler(
    store,
    delivery,
    () => ["a"],
    () => now,
  );
  restarted.recover();
  await restarted.tick();
  expect(sent).toBe(1);
});
