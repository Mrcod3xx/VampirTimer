import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ChannelType,
  PermissionFlagsBits,
  PermissionsBitField,
  type GuildBasedChannel,
} from "discord.js";
import { Store } from "../src/database/store.js";
import { Components } from "../src/ui/components.js";
import { Views } from "../src/ui/views.js";
import { commands } from "../src/bot/commands.js";
import { Notifications } from "../src/services/notifications.js";
import { Subscriptions } from "../src/services/subscriptions.js";
import { PublicPanel } from "../src/services/publicPanel.js";
import { requireAdmin, validateChannel } from "../src/utils/permissions.js";
import { G, C, U, R, discordMock } from "./discordMock.js";
const stores: Store[] = [];
function setup() {
  const store = new Store(":memory:");
  stores.push(store);
  store.initGuild(G);
  return { store, ...discordMock() };
}
afterEach(() => stores.splice(0).forEach((s) => s.close()));
it("registers all required commands with valid Discord structures", () => {
  const json = commands.map((c) => c.toJSON());
  expect(json.map((c) => c.name)).toEqual([
    "add",
    "edit",
    "remove",
    "set",
    "panel",
    "boss",
  ]);
  expect(
    json.find((c) => c.name === "boss")!.options!.map((o) => o.name),
  ).toEqual(
    expect.arrayContaining([
      "next",
      "schedule",
      "countdown",
      "list",
      "alerts",
      "subscribe",
      "unsubscribe",
      "setup",
      "test",
      "backup",
      "help",
    ]),
  );
  expect(json.find((c) => c.name === "add")!.default_member_permissions).toBe(
    String(PermissionFlagsBits.Administrator),
  );
});
it("binds controls to the guild, user and expiry; public controls are read-only", () => {
  const { store } = setup();
  let now = 0;
  const c = new Components(store, () => now);
  const id = c.id(G, U, "remove", "1");
  expect(c.decode(id, G, U).action).toBe("remove");
  expect(() => c.decode(id, G, "other")).toThrow();
  expect(() => c.decode(id, "other", U)).toThrow();
  expect(() => c.decode(id.replace("remove", "confirmRemove"), G, U)).toThrow();
  now = 901000;
  expect(() => c.decode(id, G, U)).toThrow("expired");
  expect(() =>
    c.decode(c.id(G, "0", "confirmRemove", "1", true), G, U),
  ).toThrow("public");
});
it("requires administrator permissions independently of button visibility", () => {
  expect(() => requireAdmin(new PermissionsBitField())).toThrow(
    "administrators",
  );
  expect(() =>
    requireAdmin(new PermissionsBitField(PermissionFlagsBits.Administrator)),
  ).not.toThrow();
});
it("validates channels and immediately redirects the configured channel", async () => {
  const t = setup();
  const n = new Notifications(t.store, t.client);
  await n.setChannel(G, C);
  expect(t.store.settings(G).notification_channel_id).toBe(C);
  const second = { ...t.channel, id: "723456789012345678" };
  t.channels.set(second.id, second);
  await n.setChannel(G, second.id);
  expect(await n.prepare(G)).toBe(second.id);
  t.channel.permissionsFor.mockReturnValue(new PermissionsBitField());
  await expect(n.setChannel(G, C)).rejects.toThrow("View Channel");
  expect(t.store.settings(G).notification_channel_id).toBe(second.id);
  await expect(n.channel(G, "823456789012345678")).rejects.toThrow(
    "Select a text",
  );
  expect(() =>
    validateChannel(
      { ...t.channel, guildId: "other" } as GuildBasedChannel,
      G,
      "bot",
    ),
  ).toThrow();
  expect(() =>
    validateChannel(
      { ...t.channel, type: ChannelType.GuildVoice } as GuildBasedChannel,
      G,
      "bot",
    ),
  ).toThrow();
});
it("delivers tests without pings or spawn ledger entries", async () => {
  const t = setup();
  t.store.updateSettings(G, {
    notification_channel_id: C,
    global_alert_role_id: R,
  });
  await new Notifications(t.store, t.client).test(G);
  const payload = t.channel.send.mock.calls[0]![0];
  expect(payload.allowedMentions).toEqual({ parse: [] });
  expect(payload.content).toBeUndefined();
  expect(
    t.store.db.prepare("SELECT * FROM notification_logs").all(),
  ).toHaveLength(0);
});
it("deduplicates role mentions and disables them for daily summaries", async () => {
  const t = setup();
  t.store.updateSettings(G, {
    notification_channel_id: C,
    global_alert_role_id: R,
  });
  const n = new Notifications(t.store, t.client);
  const events = t.store
    .bosses(G)
    .map((b) => ({
      event_key: String(b.id),
      guild_id: G,
      boss_id: b.id,
      spawn_at: Date.now(),
      minutes: 30,
      scheduled_at: 0,
      status: "sending",
      attempts: 1,
      retry_at: 0,
    }));
  await n.send(C, events);
  expect(t.channel.send.mock.calls[0]![0].allowedMentions.roles).toEqual([R]);
  await n.send(C, [{ ...events[0]!, minutes: -1, boss_id: 0 }]);
  expect(t.channel.send.mock.calls[1]![0].allowedMentions.roles).toEqual([]);
  t.store.updateSettings(G, { role_mentions_enabled: 0 });
  await n.send(C, events);
  expect(t.channel.send.mock.calls[2]![0].allowedMentions.roles).toEqual([]);
});
it("supports global and individual subscriptions without cross-pinging", async () => {
  const t = setup();
  const service = new Subscriptions(t.store);
  const b = t.store.bosses(G)[0]!;
  const specific = "923456789012345678";
  t.addRole(specific);
  await service.configure(t.guild, 0, R);
  await service.configure(t.guild, b.id, specific);
  await service.set(t.guild, U, 0, true);
  expect(t.member.roles.cache.has(R)).toBe(true);
  await service.set(t.guild, U, b.id, true);
  expect(t.member.roles.cache.has(R)).toBe(false);
  expect(t.member.roles.cache.has(specific)).toBe(true);
  expect(service.receipts(G, U)).toEqual([{ scope: b.id, role_id: specific }]);
  t.store.removeBoss(G, b.id);
  await service.set(t.guild, U, null, false);
  expect(t.member.roles.cache.size).toBe(0);
  expect(service.receipts(G, U)).toHaveLength(0);
});
it("refuses privileged or high roles, duplicate role scopes, and partial failed subscriptions", async () => {
  const t = setup();
  const service = new Subscriptions(t.store);
  const b = t.store.bosses(G)[0]!;
  t.roleMap.get(R)!.permissions = new PermissionsBitField(
    PermissionFlagsBits.Administrator,
  );
  await expect(service.configure(t.guild, 0, R)).rejects.toThrow(
    "no permissions",
  );
  t.addRole();
  t.roleMap.get(R)!.comparePositionTo = () => 1;
  await expect(service.configure(t.guild, 0, R)).rejects.toThrow("above");
  t.addRole();
  await service.configure(t.guild, 0, R);
  await expect(service.configure(t.guild, b.id, R)).rejects.toThrow(
    "different role",
  );
  t.member.roles.add.mockRejectedValueOnce(new Error("Offline"));
  await expect(service.set(t.guild, U, 0, true)).rejects.toThrow("Offline");
  expect(service.receipts(G, U)).toHaveLength(0);
});
it("edits one persistent public panel, handles deletion and retires an old destination", async () => {
  const t = setup();
  t.store.updateSettings(G, { notification_channel_id: C });
  const n = new Notifications(t.store, t.client);
  const panel = new PublicPanel(n, new Views(t.store, new Components(t.store)));
  await panel.refresh(G, true);
  await panel.refresh(G, true);
  expect(t.channel.send).toHaveBeenCalledTimes(1);
  const id = t.store.settings(G).panel_message_id!;
  expect(t.messages.get(id).edit).toHaveBeenCalledTimes(1);
  t.messages.delete(id);
  await panel.refresh(G);
  expect(t.store.settings(G).panel_message_id).toBeNull();
  expect(t.channel.send).toHaveBeenCalledTimes(1);
  await panel.refresh(G, true);
  expect(t.channel.send).toHaveBeenCalledTimes(2);
  const second = {
    ...t.channel,
    id: "723456789012345678",
    send: vi.fn(async () => ({ id: "new", url: "new-url" })),
  };
  t.channels.set(second.id, second);
  await n.setChannel(G, second.id);
  await panel.refresh(G, true);
  expect(t.store.settings(G).panel_channel_id).toBe(second.id);
});
it("serializes paginated views and every modal within Discord component limits", () => {
  const t = setup();
  for (let i = 0; i < 28; i++)
    t.store.saveBoss(G, {
      name: `Boss ${i}`,
      description: "Description",
      enabled: true,
      times: "02:00,14:00",
    });
  const v = new Views(t.store, new Components(t.store));
  const views = [
    v.main(G, U),
    v.admin(G, U),
    v.next(G, U),
    v.schedule(G, U, 2),
    v.schedule(G, U, 2, "manage"),
    v.schedule(G, U, 1, "choose"),
    v.settings(G, U),
    v.roles(G, U),
    v.alerts(G, U, new Set()),
    v.channels(G, U, C),
    v.remove(G, U, t.store.bosses(G)[0]!.id),
  ];
  for (const view of views) {
    expect(view.components.length).toBeLessThanOrEqual(5);
    for (const r of view.components) {
      const json = r.toJSON();
      expect(json.components.length).toBeLessThanOrEqual(5);
    }
    for (const e of view.embeds) expect(e.toJSON()).toBeDefined();
  }
  expect(v.bossModal(G, U).toJSON().components).toHaveLength(4);
  expect(v.intervalsModal(G, U).toJSON().components).toHaveLength(2);
});

it("attaches 1-click 'Report Defeated' button to spawn alerts when interval tracking is enabled", async () => {
  const t = setup();
  t.store.updateSettings(G, {
    notification_channel_id: C,
    interval_respawn_tracking_enabled: 1,
  });
  const b = t.store.bosses(G)[0]!;
  const n = new Notifications(t.store, t.client);
  const event = {
    event_key: `spawn:${b.id}`,
    guild_id: G,
    boss_id: b.id,
    spawn_at: Date.now(),
    minutes: 0,
    scheduled_at: 0,
    status: "sending",
    attempts: 1,
    retry_at: 0,
  };
  await n.send(C, [event]);
  const call = t.channel.send.mock.calls[0]![0];
  expect(call.components).toBeDefined();
  expect(call.components).toHaveLength(1);
  const button = call.components[0].components[0];
  expect(button.data.label).toBe("⚔️ Report Defeated");

  // Also verify that when minutes > 0 (e.g. 10m reminder), no defeat button is attached
  await n.send(C, [{ ...event, minutes: 10 }]);
  const reminderCall = t.channel.send.mock.calls[1]![0];
  expect(reminderCall.components).toBeUndefined();
});

it("handles large simultaneous schedules and a form with no reminders", () => {
  const t = setup();
  for (let i = 0; i < 50; i++)
    t.store.saveBoss(G, {
      name: `${i} ${"*".repeat(70)}`,
      description: "a".repeat(800),
      enabled: true,
      times: "14:00",
    });
  const v = new Views(t.store, new Components(t.store), () =>
    new Date("2026-10-31T13:00:00+08:00").getTime(),
  );
  expect(() => v.next(G, U).embeds[0]!.toJSON()).not.toThrow();
  expect(() => v.schedule(G, U, 3).embeds[0]!.toJSON()).not.toThrow();
  t.store.updateSettings(G, { reminder_minutes: "[]" });
  expect(() => v.intervalsModal(G, U).toJSON()).not.toThrow();
});

it("permits opt-out when a previously safe alert role loses mentionability", async () => {
  const t = setup();
  const service = new Subscriptions(t.store);
  await service.configure(t.guild, 0, R);
  await service.set(t.guild, U, 0, true);
  t.roleMap.get(R)!.mentionable = false;
  t.me.permissions.remove(PermissionFlagsBits.Administrator);
  await service.set(t.guild, U, null, false);
  expect(t.member.roles.cache.has(R)).toBe(false);
});
