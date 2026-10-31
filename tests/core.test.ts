import { afterEach, describe, expect, it } from "vitest";
import { DateTime } from "luxon";
import { Store } from "../src/database/store.js";
import { formatTime, nextSpawn, parseTimes } from "../src/utils/time.js";
const stores: Store[] = [];
function store() {
  const s = new Store(":memory:");
  stores.push(s);
  s.initGuild("a");
  return s;
}
afterEach(() => stores.splice(0).forEach((s) => s.close()));
describe("Philippine time", () => {
  it("normalizes, sorts and deduplicates 12/24-hour times", () =>
    expect(parseTimes("10:00 PM,14:00,2:00 pm,12:00 AM,12:00 PM")).toEqual([
      "00:00",
      "12:00",
      "14:00",
      "22:00",
    ]));
  it("formats 12-hour times", () =>
    expect(["00:00", "12:00", "14:00"].map(formatTime)).toEqual([
      "12:00 AM",
      "12:00 PM",
      "2:00 PM",
    ]));
  it.each(["24:00", "0:00 PM", "14:00 PM", "13:99", "", "2 PM"])(
    "rejects %s",
    (t) => expect(() => parseTimes(t)).toThrow(),
  );
  it("rolls into tomorrow in Manila independent of UTC date", () => {
    const s = store();
    const now = DateTime.fromISO("2026-10-31T23:30:00+08:00").toMillis();
    const next = nextSpawn(s.bosses("a"), now)!;
    expect(next.at).toBe(
      DateTime.fromISO("2026-11-01T14:00:00+08:00").toMillis(),
    );
    expect(next.bosses).toHaveLength(9);
  });
});
describe("SQLite boss management", () => {
  it("initializes once, including after deliberate default deletion", () => {
    const s = store();
    const id = s.bosses("a")[0]!.id;
    s.removeBoss("a", id);
    s.initGuild("a");
    expect(s.bosses("a")).toHaveLength(8);
  });
  it("creates, edits stable ID, isolates guilds, rejects duplicates and deletes", () => {
    const s = store();
    s.initGuild("b");
    const b = s.saveBoss("a", {
      name: "Hydra",
      description: "Cave",
      enabled: true,
      times: "01:00,13:00",
    });
    expect(() =>
      s.saveBoss("a", {
        name: "HYDRA",
        description: "",
        enabled: true,
        times: "14:00",
      }),
    ).toThrow("already exists");
    expect(() => s.boss("b", b.id)).toThrow();
    expect(
      s.saveBoss(
        "a",
        { name: "Hydra II", description: "", enabled: false, times: "02:00" },
        b.id,
      ),
    ).toMatchObject({ id: b.id, enabled: 0, times: ["02:00"] });
    s.removeBoss("a", b.id);
    expect(s.bosses("a")).toHaveLength(9);
    expect(s.bosses("b")).toHaveLength(9);
  });
  it("validates settings, and migrations do not repeat", () => {
    const s = store();
    s.updateSettings("a", { notification_channel_id: "123456789012345678" });
    expect(s.settings("a").notification_channel_id).toBe("123456789012345678");
    expect(() => s.updateSettings("a", { reminder_minutes: "[-1]" })).toThrow();
    expect(s.db.prepare("SELECT * FROM schema_migrations").all()).toHaveLength(
      1,
    );
    expect(s.db.pragma("foreign_keys", { simple: true })).toBe(1);
  });
});
