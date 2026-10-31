import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  ChannelType,
  EmbedBuilder,
  ModalBuilder,
  RoleSelectMenuBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
  escapeMarkdown,
  type MessageActionRowComponentBuilder,
} from "discord.js";
import { Store, settingToggles, type Boss } from "../database/store.js";
import { Components } from "./components.js";
import {
  displayInstant,
  formatTime,
  nextSpawn,
  zoneLabel,
} from "../utils/time.js";
export const row = (...components: MessageActionRowComponentBuilder[]) =>
  new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
    components,
  );
export interface View {
  embeds: EmbedBuilder[];
  components: ActionRowBuilder<MessageActionRowComponentBuilder>[];
  allowedMentions: { parse: [] };
}
const labels: Record<string, string> = {
  notifications_enabled: "All notifications",
  reminder_30_enabled: "30-minute warnings",
  reminder_10_enabled: "10-minute warnings",
  spawn_notification_enabled: "Spawn alerts",
  combine_notifications: "Combine simultaneous spawns",
  role_mentions_enabled: "Role mentions",
  daily_enabled: "Daily schedule",
};
export class Views {
  constructor(
    readonly store: Store,
    readonly components: Components,
    readonly now = Date.now,
  ) {}
  id(g: string, u: string, action: string, arg = "") {
    return this.components.id(g, u, action, arg);
  }
  button(
    g: string,
    u: string,
    action: string,
    label: string,
    arg = "",
    style = ButtonStyle.Secondary,
  ) {
    return new ButtonBuilder()
      .setCustomId(this.id(g, u, action, arg))
      .setLabel(label)
      .setStyle(style);
  }
  view(
    title: string,
    description: string,
    rows: View["components"] = [],
  ): View {
    return {
      embeds: [
        new EmbedBuilder()
          .setTitle(title)
          .setDescription(description)
          .setColor(0x5865f2)
          .setFooter({ text: zoneLabel }),
      ],
      components: rows,
      allowedMentions: { parse: [] },
    };
  }
  back(g: string, u: string, action = "admin") {
    return this.button(g, u, action, "Back");
  }
  main(g: string, u: string) {
    const s = this.store.settings(g);
    const bosses = this.store.bosses(g);
    const next = nextSpawn(bosses, this.now());
    return this.view(
      "👹 GEHENNA BOSS TRACKER",
      `**Bosses:** ${bosses.length}\n**Notification channel:** ${s.notification_channel_id ? `<#${s.notification_channel_id}>` : "Not configured — ask an administrator"}\n**Notifications:** ${s.notifications_enabled ? "Enabled" : "Disabled"}\n**Next spawn:** ${next ? displayInstant(next.at) : "None"}`,
      [
        row(
          this.button(g, u, "schedule", "View Bosses", "0"),
          this.button(g, u, "next", "Next Boss"),
          this.button(g, u, "alerts", "My Alerts"),
          this.button(g, u, "admin", "Admin Settings"),
        ),
      ],
    );
  }
  admin(g: string, u: string) {
    return this.view(
      "⚙️ BOSS TRACKER ADMIN PANEL",
      "Configure schedules and notifications. Changes save immediately.",
      [
        row(
          this.button(g, u, "add", "Add Boss"),
          this.button(g, u, "manage", "Manage Bosses", "0"),
          this.button(g, u, "channels", "Set Notification Channel"),
        ),
        row(
          this.button(g, u, "settings", "Notification Settings"),
          this.button(g, u, "roles", "Role Settings"),
          this.button(g, u, "test", "Test Notification"),
        ),
        row(
          this.button(g, u, "publish", "Publish Schedule"),
          this.button(g, u, "status", "Delivery Status"),
          this.button(g, u, "resetPanel", "Reset Public Panel"),
          this.back(g, u, "main"),
        ),
      ],
    );
  }
  next(g: string, u: string) {
    const next = nextSpawn(this.store.bosses(g), this.now());
    return this.view(
      "⏳ NEXT BOSS SPAWN",
      next
        ? `${next.bosses
            .slice(0, 20)
            .map((b) => `• ${escapeMarkdown(b.name)}`)
            .join(
              "\n",
            )}\n\n**${displayInstant(next.at)}**\nTime remaining: <t:${Math.floor(next.at / 1000)}:R>\nShowing up to 20 simultaneous bosses; use Full Schedule for all. Discord’s relative countdown updates automatically.`
        : "No active schedules.",
      [
        row(
          this.button(g, u, "next", "Refresh"),
          this.button(g, u, "schedule", "Full Schedule", "0"),
          this.back(g, u, "main"),
        ),
      ],
    );
  }
  schedule(
    g: string,
    u: string,
    page = 0,
    mode: "schedule" | "manage" | "choose" = "schedule",
  ) {
    const bosses = this.store.bosses(g);
    const size = 5;
    const pages = Math.max(1, Math.ceil(bosses.length / size));
    page = Math.max(0, Math.min(pages - 1, Number.isFinite(page) ? page : 0));
    const visible = bosses.slice(page * size, (page + 1) * size);
    const rows: View["components"] = [];
    if (mode !== "schedule" && visible.length)
      rows.push(
        row(
          new StringSelectMenuBuilder()
            .setCustomId(
              this.id(g, u, mode === "manage" ? "selectBoss" : "selectAlert"),
            )
            .setPlaceholder("Choose a boss")
            .addOptions(
              visible.map((b) => ({
                label: b.name.slice(0, 100),
                value: String(b.id),
                description: b.enabled ? "Active" : "Disabled",
              })),
            ),
        ),
      );
    const nav = [
      this.button(g, u, mode, "Previous", String(page - 1)).setDisabled(
        page === 0,
      ),
      this.button(g, u, mode, "Next", String(page + 1)).setDisabled(
        page === pages - 1,
      ),
      this.back(
        g,
        u,
        mode === "manage" ? "admin" : mode === "choose" ? "alerts" : "main",
      ),
    ];
    if (mode === "manage") nav.push(this.button(g, u, "add", "Add Boss"));
    rows.push(row(...nav));
    const result = this.view(
      mode === "manage"
        ? "⚙️ MANAGE BOSSES"
        : mode === "choose"
          ? "🔔 SELECT A BOSS"
          : "📅 DAILY BOSS SCHEDULE",
      `Page ${page + 1}/${pages} · ${bosses.length} bosses\nAll times below are Philippine Time.`,
      rows,
    );
    if (!visible.length)
      result.embeds[0]!.addFields({
        name: "No bosses",
        value: "An administrator can use /add boss.",
      });
    for (const b of visible)
      result.embeds[0]!.addFields({
        name: `${b.enabled ? "🟢" : "⏸️"} ${b.name}`,
        value: `${b.times.map(formatTime).join(" · ")}\n${escapeMarkdown(b.description).slice(0, 400) || "Daily recurrence"}`,
      });
    return result;
  }
  boss(g: string, u: string, id: number, member = false) {
    const b = this.store.boss(g, id);
    return this.view(
      member ? "🔔 BOSS ALERTS" : "⚙️ MANAGE BOSS",
      `**${escapeMarkdown(b.name)}**\n${b.times.map(formatTime).join(" · ")}\n${escapeMarkdown(b.description)}\n\nStatus: ${b.enabled ? "Active" : "Disabled"}\nAlert role: ${b.role_id ? `<@&${b.role_id}>` : "Not configured"}`,
      member
        ? [
            row(
              this.button(
                g,
                u,
                "subscribe",
                "Subscribe",
                String(id),
                ButtonStyle.Success,
              ),
              this.button(g, u, "unsubscribe", "Unsubscribe", String(id)),
              this.back(g, u, "alerts"),
            ),
          ]
        : [
            row(
              this.button(g, u, "edit", "Edit", String(id)),
              this.button(
                g,
                u,
                "toggleBoss",
                b.enabled ? "Disable" : "Enable",
                String(id),
              ),
              this.button(
                g,
                u,
                "remove",
                "Remove",
                String(id),
                ButtonStyle.Danger,
              ),
            ),
            row(
              this.button(g, u, "bossRole", "Set Alert Role", String(id)),
              this.back(g, u, "manage"),
            ),
          ],
    );
  }
  remove(g: string, u: string, id: number) {
    const b = this.store.boss(g, id);
    return this.view(
      "⚠️ REMOVE BOSS?",
      `Remove **${escapeMarkdown(b.name)}** and its future alerts? Other bosses will stay configured.`,
      [
        row(
          this.button(
            g,
            u,
            "confirmRemove",
            "Confirm Removal",
            String(id),
            ButtonStyle.Danger,
          ),
          this.button(g, u, "manage", "Cancel", "0"),
        ),
      ],
    );
  }
  settings(g: string, u: string) {
    const s = this.store.settings(g);
    const rows: View["components"] = [];
    const buttons = settingToggles.map((k) =>
      this.button(
        g,
        u,
        "setting",
        `${s[k] ? "✓" : "✕"} ${labels[k]}`,
        k,
        s[k] ? ButtonStyle.Success : ButtonStyle.Secondary,
      ),
    );
    for (let n = 0; n < buttons.length; n += 3)
      rows.push(row(...buttons.slice(n, n + 3)));
    rows.push(
      row(
        this.button(g, u, "intervals", "Edit Reminder Times"),
        this.back(g, u),
      ),
    );
    return this.view(
      "⚙️ NOTIFICATION SETTINGS",
      `Reminder intervals: **${(JSON.parse(s.reminder_minutes) as number[]).join(", ") || "None"} minutes**\nDaily schedule: **${formatTime(s.daily_time)}**\n30- and 10-minute switches apply when those intervals are in the list. Exact-spawn alerts have a separate switch.`,
      rows,
    );
  }
  channels(g: string, u: string, suggested?: string) {
    const s = this.store.settings(g);
    const menu = new ChannelSelectMenuBuilder()
      .setCustomId(this.id(g, u, "selectChannel"))
      .setPlaceholder("Choose the notification channel")
      .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement);
    if (s.notification_channel_id || suggested)
      menu.setDefaultChannels(s.notification_channel_id ?? suggested!);
    return this.view(
      "📣 NOTIFICATION CHANNEL",
      `Current: ${s.notification_channel_id ? `<#${s.notification_channel_id}>` : "Not configured"}\n${suggested ? `Suggested: <#${suggested}>\n` : ""}Choose a channel, then confirm. The bot will not create channels.`,
      [row(menu), row(this.back(g, u))],
    );
  }
  confirmChannel(g: string, u: string, id: string) {
    return this.view(
      "📣 CONFIRM CHANNEL",
      `Send future scheduled notifications to <#${id}>?`,
      [
        row(
          this.button(
            g,
            u,
            "confirmChannel",
            "Confirm Channel",
            id,
            ButtonStyle.Success,
          ),
          this.button(g, u, "channels", "Cancel"),
        ),
      ],
    );
  }
  roles(g: string, u: string, scope = 0) {
    const s = this.store.settings(g);
    const role =
      scope === 0 ? s.global_alert_role_id : this.store.boss(g, scope).role_id;
    const rows = [
      row(
        new RoleSelectMenuBuilder()
          .setCustomId(this.id(g, u, "selectRole", String(scope)))
          .setPlaceholder("Select a dedicated opt-in role"),
      ),
      row(
        this.button(g, u, "createRole", "Create Opt-in Role", String(scope)),
        this.back(g, u),
      ),
    ];
    return this.view(
      "🔔 ALERT ROLE SETTINGS",
      `Scope: **${scope === 0 ? "All bosses" : escapeMarkdown(this.store.boss(g, scope).name)}**\nCurrent: ${role ? `<@&${role}>` : "Not configured"}\nUse a role with no permissions, below the bot’s highest role. Members opt in themselves.\nTo set a boss-specific role, use Manage Bosses → choose boss → Set Alert Role.`,
      rows,
    );
  }
  alerts(g: string, u: string, held: ReadonlySet<string>) {
    const s = this.store.settings(g);
    const all = Boolean(
      s.global_alert_role_id && held.has(s.global_alert_role_id),
    );
    const bosses = this.store
      .bosses(g)
      .filter((b) => b.role_id && held.has(b.role_id));
    const isEnabled = all || bosses.length > 0;
    const trackedText = all
      ? "- All Gehenna Bosses"
      : bosses.length
        ? bosses
            .slice(0, 20)
            .map((b) => `- ${escapeMarkdown(b.name)}`)
            .join("\n") + (bosses.length > 20 ? "\n…more subscriptions" : "")
        : "None";
    return this.view(
      "🔔 MY BOSS ALERTS",
      `**Status:** ${isEnabled ? "Enabled" : "Disabled"}\n\n**Tracked Bosses:**\n${trackedText}\n\nEnable Alerts subscribes to **all** bosses. Selecting an individual boss removes the all-boss role. Disable Alerts also removes retired roles recorded for your account.`,
      [
        row(
          this.button(
            g,
            u,
            "subscribe",
            "Enable Alerts",
            "0",
            ButtonStyle.Success,
          ),
          this.button(g, u, "unsubscribe", "Disable Alerts", "all"),
          this.button(g, u, "choose", "Select Bosses", "0"),
          this.button(g, u, "schedule", "View Schedule", "0"),
        ),
        row(this.back(g, u, "main")),
      ],
    );
  }
  bossModal(g: string, u: string, boss?: Boss) {
    const modal = new ModalBuilder()
      .setCustomId(this.id(g, u, "saveBoss", boss ? String(boss.id) : "new"))
      .setTitle(boss ? "Edit Boss" : "Add Boss");
    const fields = [
      ["name", "Boss Name", boss?.name ?? "", true, 80],
      [
        "times",
        "Spawn Times (e.g. 2:00 PM, 18:00)",
        boss?.times.join(", ") ?? "",
        true,
        250,
      ],
      ["description", "Description", boss?.description ?? "", false, 800],
      [
        "enabled",
        "Enabled: yes or no",
        boss?.enabled === 0 ? "no" : "yes",
        true,
        3,
      ],
    ] as const;
    for (const [id, label, value, required, max] of fields) {
      const input = new TextInputBuilder()
        .setCustomId(id)
        .setLabel(label)
        .setStyle(
          id === "description"
            ? TextInputStyle.Paragraph
            : TextInputStyle.Short,
        )
        .setRequired(required)
        .setMaxLength(max);
      if (value) input.setValue(value);
      modal.addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(input),
      );
    }
    return modal;
  }
  intervalsModal(g: string, u: string) {
    const s = this.store.settings(g);
    const minutes = new TextInputBuilder()
      .setCustomId("minutes")
      .setLabel("Reminder minutes (1–180), max 5")
      .setStyle(TextInputStyle.Short)
      .setRequired(false);
    const value = (JSON.parse(s.reminder_minutes) as number[]).join(", ");
    if (value) minutes.setValue(value);
    return new ModalBuilder()
      .setCustomId(this.id(g, u, "saveIntervals"))
      .setTitle("Notification Times")
      .addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(minutes),
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId("daily")
            .setLabel("Daily schedule time (Philippine Time)")
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setValue(formatTime(s.daily_time)),
        ),
      );
  }
  resetPanel(g: string, u: string) {
    return this.view(
      "⚠️ RESET PUBLIC PANEL REFERENCE?",
      "Use this only if the old public panel cannot be reached. This forgets its saved message ID. It does not delete the old Discord message. Remove any old message manually before publishing a replacement to avoid duplicate panels.",
      [
        row(
          this.button(
            g,
            u,
            "confirmResetPanel",
            "Forget Saved Panel",
            "",
            ButtonStyle.Danger,
          ),
          this.back(g, u),
        ),
      ],
    );
  }
  help() {
    return this.view(
      "📖 BOSS TRACKER HELP",
      "**Members**\n/panel — dashboard\n/boss next · countdown — next spawn\n/boss schedule · list — all bosses\n/boss alerts — your preferences\n/boss subscribe [boss] — opt in (omit boss for all)\n/boss unsubscribe [boss] — opt out (omit boss for all)\n\n**Administrators**\n/add boss · /edit boss · /remove boss\n/set channel — notification destination\n/boss setup — settings and roles\n/boss test — test without mentions\n/boss publish — public schedule\n/boss status — recent delivery status\n\nThis bot follows configured daily schedules; it cannot detect in-game spawns.",
    );
  }
}
