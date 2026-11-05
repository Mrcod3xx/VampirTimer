import { afterEach, expect, it, vi } from "vitest";
import {
  MessageFlags,
  PermissionsBitField,
  type Interaction,
} from "discord.js";
import { Store } from "../src/database/store.js";
import { Views } from "../src/ui/views.js";
import { Components } from "../src/ui/components.js";
import { Notifications } from "../src/services/notifications.js";
import { Router } from "../src/bot/router.js";
import { G, C, U, R, discordMock } from "./discordMock.js";
const stores: Store[] = [];
afterEach(() => stores.splice(0).forEach((s) => s.close()));
function setup() {
  const store = new Store(":memory:");
  stores.push(store);
  store.initGuild(G);
  store.updateSettings(G, { notification_channel_id: C });
  const mock = discordMock();
  const views = new Views(store, new Components(store));
  const router = new Router(
    store,
    views,
    new Notifications(store, mock.client),
  );
  function interaction(
    action: string,
    arg = "",
    kind = "button",
    extra: Record<string, unknown> = {},
  ) {
    const i: any = {
      guild: mock.guild,
      guildId: G,
      user: { id: U },
      memberPermissions: mock.permissions,
      inGuild: () => true,
      isAutocomplete: () => kind === "autocomplete",
      isRepliable: () => kind !== "autocomplete",
      isChatInputCommand: () => kind === "command",
      isButton: () => kind === "button",
      isAnySelectMenu: () => kind.endsWith("select"),
      isStringSelectMenu: () => kind === "stringselect",
      isChannelSelectMenu: () => kind === "channelselect",
      isRoleSelectMenu: () => kind === "roleselect",
      isModalSubmit: () => kind === "modal",
      message: { flags: { has: () => true } },
      customId: views.id(G, U, action, arg),
      values: [],
      deferred: false,
      replied: false,
      reply: vi.fn(async () => {
        i.replied = true;
      }),
      editReply: vi.fn(async () => {}),
      deferReply: vi.fn(async () => {
        i.deferred = true;
      }),
      deferUpdate: vi.fn(async () => {
        i.deferred = true;
      }),
      showModal: vi.fn(async () => {}),
      respond: vi.fn(async () => {}),
      ...extra,
    };
    return i;
  }
  const run = async (
    action: string,
    arg = "",
    kind = "button",
    extra: Record<string, unknown> = {},
  ) => {
    const i = interaction(action, arg, kind, extra);
    await router.handle(i as Interaction);
    return i;
  };
  return { store, views, router, run, interaction, ...mock };
}
it("opens member/admin views and all navigation buttons without dead handlers", async () => {
  const t = setup();
  for (const action of [
    "main",
    "admin",
    "help",
    "next",
    "schedule",
    "manage",
    "choose",
    "settings",
    "channels",
    "roles",
    "alerts",
    "status",
  ]) {
    const i = await t.run(action);
    expect(i.editReply).toHaveBeenCalled();
    expect(i.editReply.mock.calls[0]![0].content).toBe("");
  }
});
it("opens add/edit forms, validates saves, toggles, then confirms removal", async () => {
  const t = setup();
  const original = t.store.bosses(G)[0]!;
  for (const action of ["add", "edit"]) {
    const i = await t.run(action, String(original.id));
    expect(i.showModal).toHaveBeenCalled();
    expect(i.deferUpdate).not.toHaveBeenCalled();
  }
  const fields = {
    name: "New boss",
    description: "New location",
    times: "2:00 PM, 6:00 PM",
    enabled: "yes",
  };
  await t.run("saveBoss", "new", "modal", {
    fields: { getTextInputValue: (id: keyof typeof fields) => fields[id] },
  });
  const boss = t.store.bosses(G).find((b) => b.name === "New boss")!;
  expect(boss.times).toEqual(["14:00", "18:00"]);
  await t.run("toggleBoss", String(boss.id));
  expect(t.store.boss(G, boss.id).enabled).toBe(0);
  await t.run("remove", String(boss.id));
  expect(t.store.boss(G, boss.id)).toBeDefined();
  await t.run("manage");
  expect(t.store.boss(G, boss.id)).toBeDefined();
  await t.run("confirmRemove", String(boss.id));
  expect(() => t.store.boss(G, boss.id)).toThrow();
});
it("enforces administrator permission for every mutation, including forged visible admin controls", async () => {
  const t = setup();
  for (const action of [
    "add",
    "edit",
    "remove",
    "confirmRemove",
    "toggleBoss",
    "admin",
    "manage",
    "settings",
    "setting",
    "channels",
    "selectChannel",
    "confirmChannel",
    "saveBoss",
    "saveIntervals",
    "roles",
    "bossRole",
    "selectRole",
    "createRole",
    "test",
    "publish",
    "status",
    "backup",
  ]) {
    const i = await t.run(action, "1", "button", {
      memberPermissions: new PermissionsBitField(),
    });
    expect(i.reply.mock.calls[0]![0].content).toContain("administrators");
    expect(i.reply.mock.calls[0]![0].flags).toBe(MessageFlags.Ephemeral);
  }
  expect(t.store.bosses(G)).toHaveLength(9);
  expect(t.channel.send).not.toHaveBeenCalled();
});
it("handles role/channel selectors, reminders, subscriptions, test and publication", async () => {
  const t = setup();
  const boss = t.store.bosses(G)[0]!;
  for (const action of ["selectBoss", "selectAlert"]) {
    const i = await t.run(action, "", "stringselect", {
      values: [String(boss.id)],
    });
    expect(i.editReply.mock.calls[0]![0].content).toBe("");
  }
  await t.run("selectChannel", "", "channelselect", { values: [C] });
  await t.run("confirmChannel", C);
  expect(t.store.settings(G).notification_channel_id).toBe(C);
  await t.run("setting", "reminder_30_enabled");
  expect(t.store.settings(G).reminder_30_enabled).toBe(0);
  const intervals = await t.run("intervals");
  expect(intervals.showModal).toHaveBeenCalled();
  await t.run("saveIntervals", "", "modal", {
    fields: {
      getTextInputValue: (id: string) =>
        id === "daily" ? "7:00 AM" : "45, 15",
    },
  });
  expect(t.store.settings(G)).toMatchObject({
    reminder_minutes: "[45,15]",
    daily_time: "07:00",
  });
  await t.run("selectRole", "0", "roleselect", { values: [R] });
  await t.run("subscribe", "0");
  expect(t.member.roles.cache.has(R)).toBe(true);
  await t.run("unsubscribe", "all");
  expect(t.member.roles.cache.has(R)).toBe(false);
  await t.run("bossRole", String(boss.id));
  await t.run("createRole", String(boss.id));
  expect(t.store.boss(G, boss.id).role_id).toBe("623456789012345678");
  await t.run("test");
  await t.run("backup");
  await t.run("publish");
  await t.run("refresh");
  expect(t.channel.send).toHaveBeenCalledTimes(2);
});
it("supports required slash paths and private replies to public buttons", async () => {
  const t = setup();
  for (const sub of [
    "next",
    "schedule",
    "countdown",
    "list",
    "alerts",
    "setup",
    "help",
    "status",
  ]) {
    const i = await t.run("", "", "command", {
      commandName: "boss",
      options: { getSubcommand: () => sub, getInteger: () => null },
    });
    expect(i.deferReply).toHaveBeenCalledWith({
      flags: MessageFlags.Ephemeral,
    });
  }
  const i = await t.run("next", "", "button", {
    customId: t.views.components.id(G, "0", "next", "", true),
    message: { flags: { has: () => false } },
  });
  expect(i.deferReply).toHaveBeenCalled();
  expect(i.deferUpdate).not.toHaveBeenCalled();
});
it("handles malformed inputs, expired controls and Discord API failures gracefully", async () => {
  const t = setup();
  const invalid = await t.run("saveIntervals", "", "modal", {
    fields: {
      getTextInputValue: (id: string) => (id === "daily" ? "07:00" : "1.5"),
    },
  });
  expect(invalid.editReply.mock.calls[0]![0].content).toContain(
    "whole minutes",
  );
  const tampered = await t.run("admin", "", "button", {
    customId: "bt|admin|fake|bad",
  });
  expect(tampered.reply.mock.calls[0]![0].content).toContain("Unknown control");
  t.channel.send.mockRejectedValueOnce({ code: 50013 });
  const failed = await t.run("test");
  expect(failed.editReply.mock.calls[0]![0].content).toContain("50013");
});

it("requires confirmation to forget a stale public panel", async () => {
  const t = setup();
  await t.run("publish");
  const message = t.store.settings(G).panel_message_id;
  await t.run("resetPanel");
  expect(t.store.settings(G).panel_message_id).toBe(message);
  await t.run("confirmResetPanel");
  expect(t.store.settings(G).panel_message_id).toBeNull();
});

it("protects report correction commands and restores the prior timer on undo", async () => {
  const t = setup();
  const b = t.store.bosses(G)[0]!;
  t.store.recordKillReport(G, b.id, U, "defeat", Date.now() - 120000);
  for (const action of ["alive", "undo-report"]) {
    const denied = await t.run(action, String(b.id), "button", { memberPermissions: new PermissionsBitField() });
    expect(denied.reply.mock.calls[0]![0].content).toContain("administrators");
  }
  await t.run("alive", String(b.id));
  expect(t.store.latestKillReport(G, b.id)?.report_type).toBe("alive");
  await t.run("undo-report", String(b.id));
  expect(t.store.latestKillReport(G, b.id)?.report_type).toBe("defeat");
});

it("allows non-admin members to click the public 'Report Defeated' button on spawn alerts", async () => {
  const t = setup();
  t.store.updateSettings(G, { interval_respawn_tracking_enabled: 1 });
  const b = t.store.bosses(G)[0]!;
  const components = new Components(t.store);
  const publicCustomId = components.id(G, "0", "defeated", String(b.id), true);

  // Interaction coming from a non-admin member clicking the button on a public message
  const nonAdminInteraction = t.interaction("defeated", String(b.id), "button", {
    customId: publicCustomId,
    memberPermissions: new PermissionsBitField(), // No administrator permissions
    message: { flags: { has: () => false } }, // Non-ephemeral (public channel message)
  });

  await t.router.handle(nonAdminInteraction);
  expect(nonAdminInteraction.deferReply).toHaveBeenCalledWith();
  expect(t.store.latestKillReport(G, b.id)?.report_type).toBe("defeat");
  const editReplyPayload = nonAdminInteraction.editReply.mock.calls[0]![0];
  expect(editReplyPayload.embeds[0].data.title).toBe("⚔️ BOSS DEFEAT RECORDED");
  expect(editReplyPayload.components).toHaveLength(1);
  const buttons = editReplyPayload.components[0].components;
  expect(buttons).toHaveLength(2);
  expect(buttons[0].data.label).toBe("View Schedule");
  expect(buttons[1].data.label).toBe("Next Boss");
});
