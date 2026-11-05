import { describe, expect, it } from "vitest";
import { DateTime } from "luxon";
import {
  ZONE,
  discordFullDate,
  discordRelative,
  discordShortDate,
  discordTime,
  getNextOccurrence,
  getTodayOccurrence,
  groupBossesByTierAndLevel,
  toUnixSeconds,
} from "../src/utils/time.js";
import { Store } from "../src/database/store.js";
import { Views } from "../src/ui/views.js";
import { Components } from "../src/ui/components.js";
import { Notifications, scheduleText } from "../src/services/notifications.js";
import { discordMock, G, U, C } from "./discordMock.js";

describe("Gehenna Boss Tracker V2 Redesign & Dynamic Timestamps", () => {
  it("converts Philippine spawn times to accurate UTC instants and Unix seconds", () => {
    // Reference date: 2026-11-02 in Asia/Manila (PHT is UTC+8)
    const basePHT = DateTime.fromISO("2026-11-02T10:00:00", { zone: ZONE });
    const nowMs = basePHT.toMillis();

    // 2:00 PM Manila = 14:00 PHT = 06:00 UTC
    const at2pm = getNextOccurrence("14:00", nowMs);
    const dt2pm = DateTime.fromMillis(at2pm).toUTC();
    expect(dt2pm.hour).toBe(6);
    expect(dt2pm.minute).toBe(0);
    const sec2pm = toUnixSeconds(at2pm);
    expect(sec2pm).toBe(Math.floor(at2pm / 1000));
    expect(Number.isInteger(sec2pm)).toBe(true);

    // 6:00 PM Manila = 18:00 PHT = 10:00 UTC
    const at6pm = getNextOccurrence("18:00", nowMs);
    const dt6pm = DateTime.fromMillis(at6pm).toUTC();
    expect(dt6pm.hour).toBe(10);
    expect(dt6pm.minute).toBe(0);

    // 10:00 PM Manila = 22:00 PHT = 14:00 UTC
    const at10pm = getNextOccurrence("22:00", nowMs);
    const dt10pm = DateTime.fromMillis(at10pm).toUTC();
    expect(dt10pm.hour).toBe(14);
    expect(dt10pm.minute).toBe(0);
  });

  it("formats Discord dynamic timestamp syntax tags properly", () => {
    const epochSec = 1793608800; // specific unix seconds
    const date = new Date(epochSec * 1000);

    expect(discordTime(date)).toBe(`<t:${epochSec}:t>`);
    expect(discordShortDate(date)).toBe(`<t:${epochSec}:f>`);
    expect(discordFullDate(date)).toBe(`<t:${epochSec}:F>`);
    expect(discordRelative(date)).toBe(`<t:${epochSec}:R>`);
  });

  it("handles midnight rollover and next-occurrence calculation", () => {
    // At 11:00 PM Manila time (23:00), 2:00 PM today has already passed.
    const lateNightPHT = DateTime.fromISO("2026-11-02T23:00:00", { zone: ZONE });
    const nowMs = lateNightPHT.toMillis();

    // The next 2:00 PM occurrence should be tomorrow (2026-11-03)
    const next2pm = getNextOccurrence("14:00", nowMs);
    const dtNext = DateTime.fromMillis(next2pm, { zone: ZONE });
    expect(dtNext.day).toBe(3);
    expect(dtNext.month).toBe(11);
    expect(dtNext.hour).toBe(14);
    expect(dtNext.minute).toBe(0);

    // Today's occurrence should still reference 2026-11-02
    const today2pm = getTodayOccurrence("14:00", nowMs);
    const dtToday = DateTime.fromMillis(today2pm, { zone: ZONE });
    expect(dtToday.day).toBe(2);
    expect(dtToday.hour).toBe(14);
  });

  it("groups default 9 bosses compactly by tier and level", () => {
    const store = new Store(":memory:");
    store.initGuild(G);
    const bosses = store.bosses(G);

    expect(bosses.length).toBe(9);
    const { oneStar, twoStar, other } = groupBossesByTierAndLevel(bosses);

    expect(oneStar.count).toBe(6);
    expect(twoStar.count).toBe(3);
    expect(other.count).toBe(0);

    // Verify Lv. 56 and Lv. 60 groups in 1-Star
    const lv56Group = oneStar.groups.find((g) => g.group.includes("56"));
    expect(lv56Group?.names).toEqual(["Mildis", "Regan", "Avok"]);

    const lv60Group = oneStar.groups.find((g) => g.group.includes("60"));
    expect(lv60Group?.names).toEqual(["Eligo", "Lussem", "Arto"]);

    // Verify Lv. 62 Guardian Beasts group in 2-Star
    const lv62Group = twoStar.groups.find((g) => g.group.includes("62"));
    expect(lv62Group?.names).toEqual(["Gazoth", "K'Valkan", "Beherd"]);
  });

  it("renders scheduleText with dynamic Discord timestamps and compact tiers", () => {
    const store = new Store(":memory:");
    store.initGuild(G);
    const text = scheduleText(store, G, 20, new Date("2026-11-02T10:00:00+08:00").getTime());

    // Should contain Philippine Time and Discord dynamic timestamps
    expect(text).toContain("2:00 PM PHT");
    expect(text).toContain("6:00 PM PHT");
    expect(text).toContain("10:00 PM PHT");
    expect(text).toMatch(/Your Time: <t:\d+:t> \(<t:\d+:R>\)/);

    // Should contain tier grouping
    expect(text).toContain("⭐ 1-Star + ⭐⭐ 2-Star");
    expect(text).toContain("⭐ **1-Star Bosses (6)**");
    expect(text).toContain("⭐⭐ **2-Star Bosses (3)**");
    expect(text).toContain("Mildis • Regan • Avok");
    expect(text).toContain("Gazoth • K'Valkan • Beherd");
  });

  it("renders Admin Control Panel with reorganized 3 rows and More sub-view", () => {
    const store = new Store(":memory:");
    store.initGuild(G);
    const views = new Views(store, new Components(store));

    const adminView = views.admin(G, U);
    expect(adminView.embeds[0]!.data.title).toBe("⚙️ BOSS TRACKER CONTROL PANEL");
    expect(adminView.embeds[0]!.data.color).toBe(0x5865f2);

    // 3 component rows: Boss Management, Server Configuration, Tools
    expect(adminView.components.length).toBe(3);
    const row1Labels = adminView.components[0]!.components.map((c) => (c.toJSON() as any).label);
    expect(row1Labels).toEqual(["➕ Add Boss", "📋 Manage", "⏰ Schedule"]);

    const row2Labels = adminView.components[1]!.components.map((c) => (c.toJSON() as any).label);
    expect(row2Labels).toEqual(["# Set Channel", "🔔 Alerts", "🏷️ Roles"]);

    const row3Labels = adminView.components[2]!.components.map((c) => (c.toJSON() as any).label);
    expect(row3Labels).toEqual(["🧪 Test", "📊 Status", "⚙️ More"]);

    // More sub-view
    const moreView = views.more(G, U);
    expect(moreView.embeds[0]!.data.title).toBe("⚙️ ADVANCED ADMIN TOOLS");
    const moreLabels = moreView.components[0]!.components.map((c) => (c.toJSON() as any).label);
    expect(moreLabels).toContain("📢 Publish Schedule");
    expect(moreLabels).toContain("🔄 Reset Public Panel");
  });

  it("implements smart pagination: hides Previous/Next and page counter on single page", () => {
    const store = new Store(":memory:");
    store.initGuild(G);
    const views = new Views(store, new Components(store));

    // Default 9 bosses fit in 1 page (size 10)
    const singlePage = views.schedule(G, U, 0, "schedule");
    expect(singlePage.embeds[0]!.data.description).not.toContain("Page 1 of 1");
    expect(singlePage.embeds[0]!.data.description).toContain("9 bosses • Philippine Time (UTC+8)");

    // Button nav row (row index 1) should not contain Previous or Next
    const navButtons = singlePage.components[1]!.components.map((c) => (c.toJSON() as any).label);
    expect(navButtons).not.toContain("Previous");
    expect(navButtons).not.toContain("Next");
    expect(navButtons).toContain("Back");

    // Add 15 more bosses to exceed 1 page (total 24 bosses -> 3 pages of 10)
    for (let i = 0; i < 15; i++) {
      store.saveBoss(G, {
        name: `Extra Boss ${i}`,
        description: "1-Star Boss",
        times: "14:00",
        enabled: true,
      });
    }

    const multiPage = views.schedule(G, U, 0, "schedule");
    expect(multiPage.embeds[0]!.data.description).toContain("Page 1 of 3");
    const multiNavButtons = multiPage.components[1]!.components.map((c) => (c.toJSON() as any).label);
    expect(multiNavButtons).toContain("Previous");
    expect(multiNavButtons).toContain("Next");
    expect(multiNavButtons).toContain("Back");
  });

  it("renders Next Spawn and Countdown views with Discord relative and local timestamps", () => {
    const store = new Store(":memory:");
    store.initGuild(G);
    const views = new Views(store, new Components(store), () =>
      new Date("2026-11-02T13:00:00+08:00").getTime(),
    );

    const nextView = views.next(G, U);
    expect(nextView.embeds[0]!.data.title).toBe("⏳ NEXT BOSS SPAWN");
    expect(nextView.embeds[0]!.data.color).toBe(0x8b5cf6);
    expect(nextView.embeds[0]!.data.description).toContain("Starts:** <t:");
    expect(nextView.embeds[0]!.data.description).not.toContain("Philippine Time:");
    expect(nextView.embeds[0]!.data.description).not.toContain("Full Date:");

    const countdownView = views.countdown(G, U);
    expect(countdownView.embeds[0]!.data.title).toBe("⏳ NEXT BOSS COUNTDOWN");
    expect(countdownView.embeds[0]!.data.color).toBe(0x8b5cf6);
    expect(countdownView.embeds[0]!.data.description).toContain("Countdown:** <t:");
    expect(countdownView.embeds[0]!.data.description).toContain("⭐ **1-Star:** 6 bosses");
  });

  it("renders notifications with required colors and localized timestamps", async () => {
    const mock = discordMock();
    const store = new Store(":memory:");
    store.initGuild(G);
    store.updateSettings(G, { notification_channel_id: C });
    const notifications = new Notifications(store, mock.client as any);

    const spawnAt = new Date("2026-11-02T22:00:00+08:00").getTime();
    const spawnSec = toUnixSeconds(spawnAt);
    const events = store.bosses(G).map((b) => ({
      event_key: `evt_${b.id}`,
      guild_id: G,
      boss_id: b.id,
      spawn_at: spawnAt,
      minutes: 30,
      scheduled_at: spawnAt - 30 * 60000,
      status: "sending",
      attempts: 1,
      retry_at: 0,
    }));

    // 1. 30-Minute Warning: Color 0xEAB308
    await notifications.send(C, events);
    const send30 = mock.channel.send.mock.calls[0]![0];
    const embed30 = send30.embeds[0];
    expect(embed30.data.title).toBe("⏰ BOSS SPAWN IN 30 MINUTES");
    expect(embed30.data.color).toBe(0xeab308);
    expect(embed30.data.description).toContain(`Your Local Time:** <t:${spawnSec}:t>`);
    expect(embed30.data.description).toContain(`Starts:** <t:${spawnSec}:R>`);
    expect(embed30.data.description).toContain("⚔️ **Prepare your party!**");

    // 2. 10-Minute Warning: Color 0xF59E0B
    const events10 = events.map((e) => ({ ...e, minutes: 10 }));
    await notifications.send(C, events10);
    const send10 = mock.channel.send.mock.calls[1]![0];
    const embed10 = send10.embeds[0];
    expect(embed10.data.title).toBe("⚠️ BOSS SPAWN IN 10 MINUTES!");
    expect(embed10.data.color).toBe(0xf59e0b);
    expect(embed10.data.description).toContain("⚔️ **Get ready!**");

    // 3. Exact Spawn: Color 0xF97316
    const events0 = events.map((e) => ({ ...e, minutes: 0 }));
    await notifications.send(C, events0);
    const send0 = mock.channel.send.mock.calls[2]![0];
    const embed0 = send0.embeds[0];
    expect(embed0.data.title).toBe("🔥 GEHENNA BOSSES HAVE SPAWNED!");
    expect(embed0.data.color).toBe(0xf97316);
    expect(embed0.data.description).toContain("⚔️ **Good luck, everyone!**");
  });

  it("renders single-boss detailed member view with next spawn timestamp", () => {
    const store = new Store(":memory:");
    store.initGuild(G);
    const views = new Views(store, new Components(store), () =>
      new Date("2026-11-02T13:00:00+08:00").getTime(),
    );

    const b = store.bosses(G)[0]!;
    const memberView = views.boss(G, U, b.id, true);
    expect(memberView.embeds[0]!.data.title).toContain(b.name);
    expect(memberView.embeds[0]!.data.description).toContain("Your Local Time:** <t:");
    expect(memberView.embeds[0]!.data.description).toContain("Starts:** <t:");

    const labels = memberView.components[0]!.components.map((c) => (c.toJSON() as any).label);
    expect(labels).toContain("Back to Directory");
  });

  it("renders choose alerts with tier emojis, role indicators, and tier-grouped alert subscriptions", () => {
    const store = new Store(":memory:");
    store.initGuild(G);
    const b = store.bosses(G)[0]!;
    store.db.prepare("INSERT INTO boss_alert_roles(guild_id,boss_id,role_id) VALUES (?,?,?)").run(G, b.id, "999888777");

    const views = new Views(store, new Components(store));

    // 1. In choose mode, select menu shows role status and tier emoji
    const chooseView = views.schedule(G, U, 0, "choose");
    expect(chooseView.embeds[0]!.data.title).toBe("🔔 SELECT A BOSS");
    const selectMenu = chooseView.components[0]!.components[0]!.toJSON() as any;
    expect(selectMenu.placeholder).toContain("Select a boss to manage alerts");
    const optionWithRole = selectMenu.options.find((o: any) => o.value === String(b.id));
    expect(optionWithRole.description).toContain("🔔 Role set");
    expect(optionWithRole.label).toContain(b.name);

    // 2. In alerts view, individual subscriptions are categorized by star tier
    const alertsView = views.alerts(G, U, new Set(["999888777"]));
    expect(alertsView.embeds[0]!.data.title).toBe("🔔 MY BOSS ALERTS");
    expect(alertsView.embeds[0]!.data.description).toContain("Alert Status:** 🟢 Enabled");
    expect(alertsView.embeds[0]!.data.description).toContain("1-Star Bosses (1)");
    expect(alertsView.embeds[0]!.data.description).toContain("Mildis");
  });
});
