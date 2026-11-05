import { validEvent } from "../services/scheduler.js";
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
import { DateTime } from "luxon";
import {
  Store,
  settingToggles,
  type Boss,
  type ScheduleType,
} from "../database/store.js";
import { Components } from "./components.js";
import {
  ZONE,
  calculateBossRespawnStatus,
  displayInstant,
  formatPhilippineTime,
  formatTime,
  formatWeeklyDays,
  getNextOccurrence,
  getNextBossOccurrence,
  groupBossesByTierAndLevel,
  nextSpawn,
  toUnixSeconds,
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
  interval_respawn_tracking_enabled: "Interval Respawn Alerts",
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
    color = 0x5865f2,
  ): View {
    return {
      embeds: [
        new EmbedBuilder()
          .setTitle(title)
          .setDescription(description)
          .setColor(color)
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
    const next = nextSpawn(
      bosses,
      this.now(),
      Boolean(this.store.settings(g).interval_respawn_tracking_enabled),
    );
    let nextSpawnText = "None";
    if (next) {
      const sec = toUnixSeconds(next.at);
      const pht = `${DateTime.fromMillis(next.at, { zone: ZONE }).toFormat("h:mm a")} PHT`;
      nextSpawnText = `${pht} (<t:${sec}:R>)`;
    }
    return this.view(
      "👹 GEHENNA BOSS TRACKER",
      `**Bosses Tracked:** ${bosses.length}\n**Notification Channel:** ${s.notification_channel_id ? `<#${s.notification_channel_id}>` : "Not configured"}\n**Notifications:** ${s.notifications_enabled ? "🟢 Enabled" : "🔴 Disabled"}\n**Next Spawn:** ${nextSpawnText}`,
      [
        row(
          this.button(g, u, "schedule", "View Bosses", "0"),
          this.button(g, u, "next", "Next Boss"),
          this.button(g, u, "alerts", "My Alerts"),
          this.button(g, u, "admin", "Admin Settings"),
        ),
      ],
      0x8b5cf6,
    );
  }
  admin(g: string, u: string) {
    const s = this.store.settings(g);
    const bosses = this.store.bosses(g);
    const desc = [
      "Manage boss schedules and notifications\n",
      `**Notification Channel:** ${s.notification_channel_id ? `<#${s.notification_channel_id}>` : "Not configured"}`,
      `**Bosses Tracked:** ${bosses.length}`,
      `**Notifications:** ${s.notifications_enabled ? "🟢 Enabled" : "🔴 Disabled"}`,
      `**Timezone:** Philippine Time (UTC+8)`,
    ].join("\n");

    return this.view(
      "⚙️ BOSS TRACKER CONTROL PANEL",
      desc,
      [
        row(
          this.button(g, u, "addScheduleType", "➕ Add Boss"),
          this.button(g, u, "manage", "📋 Manage", "0"),
          this.button(g, u, "schedule", "⏰ Schedule", "0"),
        ),
        row(
          this.button(g, u, "channels", "# Set Channel"),
          this.button(g, u, "settings", "🔔 Alerts"),
          this.button(g, u, "roles", "🏷️ Roles"),
        ),
        row(
          this.button(g, u, "test", "🧪 Test"),
          this.button(g, u, "status", "📊 Status"),
          this.button(g, u, "more", "⚙️ More"),
        ),
      ],
      0x5865f2,
    );
  }
  addScheduleType(g: string, u: string) {
    const desc = [
      "Select the schedule type for the new boss:\n",
      "• **Daily Schedule (Type A):** Spawns at fixed times every day (default).",
      "• **Weekly Schedule (Type B):** Spawns at fixed times on specific weekdays (e.g. Mon, Wed, Fri).",
      "• **Special Event (Type C):** Spawns on a specific calendar date (YYYY-MM-DD).",
      "• **Interval Respawn (Type D):** Respawns after a set duration following defeat (e.g. 4h, 8h).",
    ].join("\n");

    return this.view(
      "➕ SELECT SCHEDULE TYPE",
      desc,
      [
        row(
          this.button(
            g,
            u,
            "addModal",
            "📅 Daily Schedule",
            "daily",
            ButtonStyle.Primary,
          ),
          this.button(
            g,
            u,
            "addModal",
            "🗓️ Weekly Schedule",
            "weekly",
            ButtonStyle.Primary,
          ),
        ),
        row(
          this.button(
            g,
            u,
            "addModal",
            "⭐ Special Event",
            "event",
            ButtonStyle.Primary,
          ),
          this.button(
            g,
            u,
            "addModal",
            "⏳ Interval Respawn",
            "interval",
            ButtonStyle.Primary,
          ),
        ),
        row(this.back(g, u, "admin")),
      ],
      0x5865f2,
    );
  }
  more(g: string, u: string) {
    return this.view(
      "⚙️ ADVANCED ADMIN TOOLS",
      "Additional management controls for the boss tracker.",
      [
        row(
          this.button(g, u, "publish", "📢 Publish Schedule"),
          this.button(g, u, "resetPanel", "🔄 Reset Public Panel"),
          this.button(g, u, "audit", "📜 Audit Logs", "all:0"),
        ),
        row(
          this.button(g, u, "intervals", "⏰ Reminder Intervals"),
          this.button(g, u, "backup", "💾 Backup Database"),
          this.back(g, u, "admin"),
        ),
      ],
      0x5865f2,
    );
  }
  next(g: string, u: string) {
    const next = nextSpawn(
      this.store.bosses(g),
      this.now(),
      Boolean(this.store.settings(g).interval_respawn_tracking_enabled),
    );
    if (!next) {
      return this.view(
        "⏳ NEXT BOSS SPAWN",
        "No active schedules.",
        [
          row(
            this.button(g, u, "next", "Refresh"),
            this.button(g, u, "schedule", "Full Schedule", "0"),
            this.back(g, u, "main"),
          ),
        ],
        0x8b5cf6,
      );
    }
    const sec = toUnixSeconds(next.at);
    const { oneStar, twoStar, other } = groupBossesByTierAndLevel(next.bosses);
    const bossSections: string[] = [];

    if (oneStar.count > 0) {
      bossSections.push(`⭐ **1-Star Bosses (${oneStar.count})**`);
      for (const grp of oneStar.groups) {
        bossSections.push(
          `**${grp.group}** ${grp.names.map((x) => escapeMarkdown(x)).join(" • ")}`,
        );
      }
      bossSections.push("");
    }

    if (twoStar.count > 0) {
      bossSections.push(`⭐⭐ **2-Star Bosses (${twoStar.count})**`);
      for (const grp of twoStar.groups) {
        if (grp.group.includes("Guardian Beasts")) {
          bossSections.push(
            `**${grp.group}**\n${grp.names.map((x) => escapeMarkdown(x)).join(" • ")}`,
          );
        } else {
          bossSections.push(
            `**${grp.group}** ${grp.names.map((x) => escapeMarkdown(x)).join(" • ")}`,
          );
        }
      }
      bossSections.push("");
    }

    if (other.count > 0) {
      bossSections.push(`**Other Bosses (${other.count})**`);
      for (const grp of other.groups) {
        bossSections.push(
          `**${grp.group}** ${grp.names.map((x) => escapeMarkdown(x)).join(" • ")}`,
        );
      }
      bossSections.push("");
    }

    const rawDesc = [
      `**Starts:** <t:${sec}:R>\n`,
      `**Scheduled Bosses (${next.bosses.length})**`,
      bossSections.join("\n").trim(),
    ].join("\n");

    const desc = rawDesc.length > 4000 ? `${rawDesc.slice(0, 3950)}…` : rawDesc;

    const v = this.view(
      "⏳ NEXT BOSS SPAWN",
      desc,
      [
        row(
          this.button(g, u, "next", "🔄 Refresh"),
          this.button(g, u, "schedule", "📅 Full Schedule", "0"),
          this.back(g, u, "main"),
        ),
      ],
      0x8b5cf6,
    );
    v.embeds[0]!.setFooter({
      text: "Countdown is refreshed when you open this view. In Discord, use a refresh button or timestamp.",
    });
    return v;
  }
  countdown(g: string, u: string) {
    const next = nextSpawn(
      this.store.bosses(g),
      this.now(),
      Boolean(this.store.settings(g).interval_respawn_tracking_enabled),
    );
    if (!next) {
      return this.view(
        "⏳ NEXT BOSS COUNTDOWN",
        "No upcoming bosses scheduled.",
        [
          row(
            this.button(g, u, "countdown", "Refresh"),
            this.button(g, u, "schedule", "Full Schedule", "0"),
            this.back(g, u, "main"),
          ),
        ],
        0x8b5cf6,
      );
    }

    const sec = toUnixSeconds(next.at);
    const { oneStar, twoStar, other } = groupBossesByTierAndLevel(next.bosses);

    const desc = [
      `**Countdown:** <t:${sec}:R>`,
      `**Starts:** <t:${sec}:t>`,
      `**Scheduled Bosses (${next.bosses.length})**\n`,
      oneStar.count > 0 ? `⭐ **1-Star:** ${oneStar.count} bosses` : "",
      twoStar.count > 0 ? `⭐⭐ **2-Star:** ${twoStar.count} bosses` : "",
      other.count > 0 ? `**Other:** ${other.count} bosses` : "",
    ]
      .filter(Boolean)
      .join("\n");

    return this.view(
      "⏳ NEXT BOSS COUNTDOWN",
      desc,
      [
        row(
          this.button(g, u, "countdown", "🔄 Refresh"),
          this.button(g, u, "schedule", "📅 Full Schedule", "0"),
          this.back(g, u, "main"),
        ),
      ],
      0x8b5cf6,
    );
  }
  schedule(
    g: string,
    u: string,
    page = 0,
    mode: "schedule" | "manage" | "choose" = "schedule",
  ) {
    const bosses = this.store.bosses(g);
    const size = 10;
    const pages = Math.max(1, Math.ceil(bosses.length / size));
    page = Math.max(0, Math.min(pages - 1, Number.isFinite(page) ? page : 0));
    const visible = bosses.slice(page * size, (page + 1) * size);
    const rows: View["components"] = [];

    if (visible.length) {
      rows.push(
        row(
          new StringSelectMenuBuilder()
            .setCustomId(
              this.id(
                g,
                u,
                mode === "manage"
                  ? "selectBoss"
                  : mode === "choose"
                    ? "selectAlert"
                    : "viewBossDetail",
              ),
            )
            .setPlaceholder("Choose a boss for details")
            .addOptions(
              visible.map((b) => ({
                label: b.name.slice(0, 100),
                value: String(b.id),
                description:
                  `${b.description || (b.enabled ? "Active" : "Disabled")}`.slice(
                    0,
                    100,
                  ),
              })),
            ),
        ),
      );
    }

    const nav: ButtonBuilder[] = [];
    if (pages > 1) {
      nav.push(
        this.button(g, u, mode, "Previous", String(page - 1)).setDisabled(
          page === 0,
        ),
        this.button(g, u, mode, "Next", String(page + 1)).setDisabled(
          page === pages - 1,
        ),
      );
    }
    nav.push(
      this.back(
        g,
        u,
        mode === "manage" ? "admin" : mode === "choose" ? "alerts" : "main",
      ),
    );
    if (mode === "manage")
      nav.push(this.button(g, u, "addScheduleType", "Add Boss"));
    rows.push(row(...nav));

    const pageSubtitle =
      pages > 1
        ? `Page ${page + 1} of ${pages} • ${bosses.length} bosses\nAll times below are Philippine Time.`
        : `${bosses.length} bosses • Philippine Time (UTC+8)`;

    const result = this.view(
      mode === "manage"
        ? "⚙️ MANAGE BOSSES"
        : mode === "choose"
          ? "🔔 SELECT A BOSS"
          : "📅 DAILY BOSS SCHEDULE",
      pageSubtitle,
      rows,
      mode === "schedule" ? 0x8b5cf6 : 0x5865f2,
    );

    if (!visible.length) {
      result.embeds[0]!.addFields({
        name: "No bosses",
        value: "An administrator can use /add boss.",
      });
    }

    for (const b of visible) {
      let scheduleInfo = "Daily recurrence";
      if (b.schedule_type === "weekly") {
        scheduleInfo = `Weekly (${formatWeeklyDays(b.recurrence_days)})`;
      } else if (b.schedule_type === "event") {
        scheduleInfo = `Special Event (${b.event_date || "Date TBD"})`;
      } else if (b.schedule_type === "interval") {
        const hours = Math.round((b.respawn_interval_minutes ?? 60) / 60);
        scheduleInfo = `Interval Respawn (${hours}h)`;
      }
      result.embeds[0]!.addFields({
        name: `${b.enabled ? "🟢" : "⏸️"} ${b.name}`,
        value: `${b.times.map(formatTime).join(" · ")}\n${scheduleInfo}${b.description ? ` • ${escapeMarkdown(b.description).slice(0, 150)}` : ""}`,
        inline: true,
      });
    }

    return result;
  }
  boss(g: string, u: string, id: number, member = false) {
    const b = this.store.boss(g, id);
    const starMatch = /([⭐]+)/.exec(b.description ?? "");
    const starEmoji = starMatch
      ? starMatch[1]
      : b.description?.includes("2-Star")
        ? "⭐⭐"
        : "⭐";
    const tierBadge = b.description?.includes("2-Star")
      ? "2-Star Boss"
      : b.description?.includes("1-Star")
        ? "1-Star Boss"
        : "Boss";

    let scheduleBadge = "Daily";
    if (b.schedule_type === "weekly") {
      scheduleBadge = `Weekly (${formatWeeklyDays(b.recurrence_days)})`;
    } else if (b.schedule_type === "event") {
      scheduleBadge = `Special Event (${b.event_date || "Date TBD"})`;
    } else if (b.schedule_type === "interval") {
      const hours = Math.round((b.respawn_interval_minutes ?? 60) / 60);
      scheduleBadge = `Interval (${hours}h after defeat)`;
    }

    if (member) {
      let nextSpawnInfo: string[];
      if (b.schedule_type === "interval") {
        const lastKill = this.store.latestKillReport(g, b.id);
        const respawnStatus = calculateBossRespawnStatus(
          b,
          lastKill ?? undefined,
          this.now(),
        );
        if (
          respawnStatus.status === "respawn_pending" &&
          respawnStatus.estimatedRespawnAt
        ) {
          const respawnSec = toUnixSeconds(respawnStatus.estimatedRespawnAt);
          nextSpawnInfo = [
            `**Status:** Defeated (Respawn Pending)`,
            `**Estimated Respawn:** <t:${respawnSec}:t>`,
            `**Respawning:** <t:${respawnSec}:R>`,
          ];
        } else if (respawnStatus.status === "estimated_ready") {
          nextSpawnInfo = [
            `**Status:** Estimated Ready / Alive`,
            `*Respawn timer has elapsed. Defeat not yet reported.*`,
          ];
        } else {
          nextSpawnInfo = [
            `**Status:** ${b.enabled ? "Active" : "Disabled"} (Interval Tracking)`,
            `*Report defeats with \`/boss defeated\`*`,
          ];
        }
      } else {
        const occurrences = b.times
          .map((t) => getNextBossOccurrence(b, t, this.now()))
          .filter((at): at is number => at !== null);
        const nextAt = occurrences.length ? Math.min(...occurrences) : null;

        if (nextAt !== null) {
          const nextSec = toUnixSeconds(nextAt);
          nextSpawnInfo = [
            `**Your Local Time:** <t:${nextSec}:t>`,
            `**Starts:** <t:${nextSec}:R>`,
          ];
        } else {
          nextSpawnInfo = ["*No upcoming spawn scheduled*"];
        }
      }

      const desc = [
        `**Tier:** ${tierBadge}`,
        `**Schedule Type:** ${scheduleBadge}`,
        `**Status:** ${b.enabled ? "Active" : "Disabled"}\n`,
        b.schedule_type === "interval"
          ? `⏳ **Respawn Interval:** ${Math.round((b.respawn_interval_minutes ?? 60) / 60)} hours after defeat\nTimer starts after a defeat report; base daily times are ignored.\n`
          : `⏰ **Spawn Schedule**\n${b.times.map((t) => `• ${formatTime(t)} PHT`).join("\n")}\n`,
        `⏱️ **Next Spawn**`,
        ...nextSpawnInfo,
      ].join("\n");

      return this.view(
        `${starEmoji} ${escapeMarkdown(b.name)}`,
        desc,
        [
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
            this.button(g, u, "schedule", "Back to Directory", "0"),
            ...(b.schedule_type === "interval"
              ? [this.button(g, u, "defeated", "Report Defeated", String(id))]
              : []),
          ),
        ],
        0x8b5cf6,
      );
    }

    const desc = [
      `${b.enabled ? "🟢 Active" : "⏸️ Disabled"}  ${tierBadge} • ${scheduleBadge}\n`,
      b.schedule_type === "interval"
        ? `⏳ **Respawn Interval:** ${Math.round((b.respawn_interval_minutes ?? 60) / 60)} hours after defeat\nTimer starts after a defeat report; daily base times are ignored.\n`
        : `⏰ **Spawn Schedule**\n${b.times.map(formatTime).join(" • ")}\n`,
      `🔔 **Alert Role**\n${b.role_id ? `<@&${b.role_id}>` : "Not configured"}`,
    ].join("\n");

    return this.view(
      `${starEmoji} ${escapeMarkdown(b.name)}`,
      desc,
      [
        row(
          this.button(g, u, "edit", "✏️ Edit", String(id)),
          this.button(
            g,
            u,
            "toggleBoss",
            b.enabled ? "⏸️ Disable" : "▶️ Enable",
            String(id),
          ),
          this.button(g, u, "bossRole", "🔔 Set Role", String(id)),
          this.button(
            g,
            u,
            "remove",
            "🗑️ Remove",
            String(id),
            ButtonStyle.Danger,
          ),
          this.button(g, u, "manage", "← Back", "0"),
        ),
        row(
          this.button(g, u, "alive", "Confirm Alive", String(id)),
          this.button(g, u, "undo-report", "Undo Last Report", String(id)),
        ),
      ],
      0x5865f2,
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

    const desc = [
      `**Current Channel:** ${s.notification_channel_id ? `<#${s.notification_channel_id}>` : "Not configured"}`,
      `**Status:** ${s.notification_channel_id ? "🟢 Connected" : "🔴 No channel selected"}\n`,
      `**Bot Permissions**`,
      `• View Channel: Available`,
      `• Send Messages: Available`,
      `• Embed Links: Available\n`,
      `${suggested ? `Suggested: <#${suggested}>\n` : ""}Choose a channel below, then confirm. The bot will send future spawn alerts there:`,
    ].join("\n");

    return this.view(
      "# NOTIFICATION CHANNEL SETTINGS",
      desc,
      [
        row(menu),
        row(this.button(g, u, "test", "🧪 Test Notification"), this.back(g, u)),
      ],
      0x5865f2,
    );
  }
  status(g: string, u: string) {
    const s = this.store.settings(g);
    const lastLog = this.store.db
      .prepare(
        "SELECT status, error_message, scheduled_at, sent_at FROM notification_logs WHERE guild_id=? AND status IN ('sent','missed','uncertain') ORDER BY COALESCE(sent_at, scheduled_at) DESC LIMIT 1",
      )
      .get(g) as
      | {
          status: string;
          error_message: string | null;
          scheduled_at: number;
          sent_at: number | null;
        }
      | undefined;

    let lastDeliveryText = "No events yet";
    if (lastLog) {
      const sec = toUnixSeconds(lastLog.sent_at || lastLog.scheduled_at);
      if (lastLog.status === "sent") {
        lastDeliveryText = `🟢 Successful (<t:${sec}:R>)`;
      } else {
        lastDeliveryText = `🔴 ${lastLog.error_message || lastLog.status} (<t:${sec}:R>)`;
      }
    }

    const failedCount = (
      this.store.db
        .prepare(
          "SELECT COUNT(*) AS count FROM notification_logs WHERE guild_id=? AND (status='failed' OR error_message IS NOT NULL)",
        )
        .get(g) as { count: number }
    ).count;

    const missedCount = (
      this.store.db
        .prepare(
          "SELECT COUNT(*) AS count FROM notification_logs WHERE guild_id=? AND status='missed'",
        )
        .get(g) as { count: number }
    ).count;

    const pending = this.store.db
      .prepare(
        "SELECT * FROM notification_logs WHERE guild_id=? AND status='pending' AND scheduled_at>=? ORDER BY scheduled_at LIMIT 500",
      )
      .all(g, this.now()) as import("../database/store.js").Event[];
    const bosses = this.store.bosses(g);
    const nextAlert = pending.find((event) => validEvent(event, s, bosses));
    const nextAlertText = !s.notifications_enabled
      ? "Paused by administrator"
      : nextAlert
        ? `<t:${toUnixSeconds(nextAlert.scheduled_at)}:t> (<t:${toUnixSeconds(nextAlert.scheduled_at)}:R>)`
        : "No pending alerts; schedules reconcile within 30 seconds";
    const heartbeat = this.store.schedulerHeartbeat;
    const schedulerStatus = this.store.schedulerError
      ? `🔴 Error: ${this.store.schedulerError}`
      : heartbeat !== null && this.now() - heartbeat < 60_000
        ? "🟢 Running"
        : "🟡 Waiting for scheduler heartbeat";
    const uncertain = (
      this.store.db
        .prepare(
          "SELECT COUNT(*) AS n FROM notification_logs WHERE guild_id=? AND status='uncertain'",
        )
        .get(g) as { n: number }
    ).n;
    const desc = [
      `**Bot Status:** 🟢 Online`,
      `**Scheduler:** ${schedulerStatus}`,
      `**Database:** 🟢 Connected (SQLite WAL)`,
      `**Timezone:** Philippine Time (UTC+8)\n`,
      `**Notification Channel:** ${s.notification_channel_id ? `<#${s.notification_channel_id}>` : "🔴 Not configured"}`,
      `**Last Delivery:** ${lastDeliveryText}`,
      `**Next Scheduled Alert:** ${nextAlertText}\n`,
      `**Reliability Metrics (Retained History)**`,
      `• Failed Deliveries: **${failedCount}**`,
      `• Missed Reminders: **${missedCount}**`,
      `• Uncertain deliveries: **${uncertain}** (not resent automatically)`,
      `**Memory:** ${Math.round(process.memoryUsage().rss / 1048576)} MB RSS`,
    ].join("\n");

    return this.view(
      "📊 BOT SYSTEM STATUS",
      desc,
      [
        row(
          this.button(g, u, "status", "🔄 Refresh"),
          this.button(g, u, "deliveryLogs", "📋 Delivery Logs", "0"),
          this.button(g, u, "audit", "📜 Audit Logs", "all:0"),
        ),
        row(
          this.button(g, u, "test", "🧪 Test Notification"),
          this.back(g, u, "admin"),
        ),
      ],
      0x3b82f6,
    );
  }
  deliveryLogs(g: string, u: string, page = 0) {
    const size = 6;
    const totalCount = (
      this.store.db
        .prepare(
          "SELECT COUNT(*) AS count FROM notification_logs WHERE guild_id=?",
        )
        .get(g) as { count: number }
    ).count;
    const pages = Math.max(1, Math.ceil(totalCount / size));
    page = Math.max(0, Math.min(pages - 1, Number.isFinite(page) ? page : 0));

    const logs = this.store.db
      .prepare(
        "SELECT * FROM notification_logs WHERE guild_id=? ORDER BY scheduled_at DESC LIMIT ? OFFSET ?",
      )
      .all(g, size, page * size) as Array<{
      status: string;
      minutes: number;
      scheduled_at: number;
      sent_at: number | null;
      error_message: string | null;
    }>;

    const rows: View["components"] = [];
    const nav: ButtonBuilder[] = [];
    if (pages > 1) {
      nav.push(
        this.button(
          g,
          u,
          "deliveryLogs",
          "Previous",
          String(page - 1),
        ).setDisabled(page === 0),
        this.button(g, u, "deliveryLogs", "Next", String(page + 1)).setDisabled(
          page === pages - 1,
        ),
      );
    }
    nav.push(this.button(g, u, "status", "← Back to Status"));
    rows.push(row(...nav));

    const statusIcons: Record<string, string> = {
      sent: "🟢 Sent",
      failed: "🔴 Failed",
      missed: "⚠️ Missed",
      pending: "⏳ Pending",
      uncertain: "🟠 Uncertain",
      sending: "📤 Sending",
      cancelled: "⚪ Cancelled",
    };

    const lines = logs.map((log) => {
      const icon = statusIcons[log.status] || log.status;
      const timeSec = toUnixSeconds(log.scheduled_at);
      const typeLabel =
        log.minutes === 0 ? "Exact Spawn Alert" : `${log.minutes}-Min Warning`;
      const err = log.error_message
        ? `\n  *Error: ${escapeMarkdown(log.error_message)}*`
        : "";
      return `• **<t:${timeSec}:f>** (<t:${timeSec}:R>)\n  Type: \`${typeLabel}\` • Status: ${icon}${err}`;
    });

    const desc = logs.length
      ? `Showing recent delivery history (Page ${page + 1} of ${pages} • ${totalCount} total events):\n\n${lines.join("\n\n")}`
      : "No notification logs recorded yet.";

    return this.view("📋 NOTIFICATION DELIVERY LOGS", desc, rows, 0x3b82f6);
  }
  audit(g: string, u: string, filter = "all", page = 0) {
    const size = 6;
    const queryFilter = filter === "all" ? undefined : filter;
    const totalCount = this.store.auditLogCount(g, queryFilter);
    const pages = Math.max(1, Math.ceil(totalCount / size));
    page = Math.max(0, Math.min(pages - 1, Number.isFinite(page) ? page : 0));

    const logs = this.store.auditLogs(g, queryFilter, size, page * size);
    const rows: View["components"] = [];

    // Filter select menu
    rows.push(
      row(
        new StringSelectMenuBuilder()
          .setCustomId(this.id(g, u, "auditFilter"))
          .setPlaceholder("Filter by category")
          .addOptions([
            { label: "All Changes", value: "all", default: filter === "all" },
            {
              label: "Boss Changes",
              value: "boss",
              default: filter === "boss",
            },
            {
              label: "Channel Changes",
              value: "channel",
              default: filter === "channel",
            },
            {
              label: "Settings & Roles",
              value: "settings",
              default: filter === "settings",
            },
          ]),
      ),
    );

    const nav: ButtonBuilder[] = [];
    if (pages > 1) {
      nav.push(
        this.button(
          g,
          u,
          "auditPage",
          "Previous",
          `${filter}:${page - 1}`,
        ).setDisabled(page === 0),
        this.button(
          g,
          u,
          "auditPage",
          "Next",
          `${filter}:${page + 1}`,
        ).setDisabled(page === pages - 1),
      );
    }
    nav.push(this.back(g, u, "admin"));
    rows.push(row(...nav));

    const actionIcons: Record<string, string> = {
      boss_add: "➕ Boss Added",
      boss_edit: "✏️ Boss Edited",
      boss_remove: "🗑️ Boss Removed",
      boss_toggle: "⏸️ Boss Toggled",
      channel_set: "📢 Channel Set",
      role_set: "🔔 Role Set",
      settings_update: "⚙️ Settings Updated",
      schedule_publish: "📢 Schedule Published",
      panel_reset: "🔄 Panel Reset",
      backup_create: "💾 Backup Created",
      backup_auto: "💾 Automated Backup",
    };

    const lines = logs.map((log) => {
      const timeSec = toUnixSeconds(log.created_at);
      const title = actionIcons[log.action_type] || log.action_type;
      const user = log.user_id === "system" ? "*System*" : `<@${log.user_id}>`;
      let change = "";
      if (log.previous_value && log.new_value) {
        change = `\n  \`${escapeMarkdown(log.previous_value)}\` ➔ \`${escapeMarkdown(log.new_value)}\``;
      } else if (log.new_value) {
        change = `\n  \`${escapeMarkdown(log.new_value.slice(0, 150))}\``;
      } else if (log.previous_value) {
        change = `\n  \`${escapeMarkdown(log.previous_value.slice(0, 150))}\``;
      }
      return `• **${title}** by ${user} • <t:${timeSec}:R>${change}`;
    });

    const desc = logs.length
      ? `Showing administrative changes (Page ${page + 1} of ${pages} • ${totalCount} entries):\n\n${lines.join("\n\n")}`
      : `No audit log entries recorded${filter !== "all" ? ` for category "${filter}"` : ""}.`;

    return this.view("📜 ADMIN AUDIT LOGS", desc, rows, 0x5865f2);
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

    let subsText: string;
    if (all) {
      subsText =
        "⭐ 1-Star Bosses — Subscribed\n⭐⭐ 2-Star Bosses — Subscribed\n*(All Gehenna Bosses)*";
    } else if (bosses.length > 0) {
      subsText =
        bosses
          .slice(0, 15)
          .map((b) => `• ${escapeMarkdown(b.name)} — Subscribed`)
          .join("\n") + (bosses.length > 15 ? "\n…more subscriptions" : "");
    } else {
      subsText = "None configured";
    }

    const desc = [
      `**Status:** ${isEnabled ? "🟢 Enabled" : "🔴 Disabled"}\n`,
      `**Subscriptions**\n${subsText}\n`,
      `**Notification Role**\n${s.global_alert_role_id ? `<@&${s.global_alert_role_id}>` : "Not configured"}\n`,
      `Enable Alerts subscribes to **all** bosses. Selecting an individual boss removes the all-boss role. Disable Alerts removes all opt-in roles.`,
    ].join("\n");

    const toggleButton = isEnabled
      ? this.button(
          g,
          u,
          "unsubscribe",
          "Disable Alerts",
          "all",
          ButtonStyle.Danger,
        )
      : this.button(
          g,
          u,
          "subscribe",
          "Enable Alerts",
          "0",
          ButtonStyle.Success,
        );

    return this.view(
      "🔔 MY BOSS ALERTS",
      desc,
      [
        row(
          toggleButton,
          this.button(g, u, "choose", "Choose Bosses", "0"),
          this.button(g, u, "schedule", "View Schedule", "0"),
        ),
        row(this.back(g, u, "main")),
      ],
      0x8b5cf6,
    );
  }
  bossModal(g: string, u: string, boss?: Boss, scheduleType?: ScheduleType) {
    const type: ScheduleType = (boss?.schedule_type ||
      scheduleType ||
      "daily") as ScheduleType;
    const modal = new ModalBuilder()
      .setCustomId(
        this.id(g, u, "saveBoss", `${boss ? boss.id : "new"}:${type}`),
      )
      .setTitle(
        boss
          ? `Edit ${type === "event" ? "Event" : type.charAt(0).toUpperCase() + type.slice(1)} Boss`
          : `Add ${type === "event" ? "Event" : type.charAt(0).toUpperCase() + type.slice(1)} Boss`,
      );

    const rows: ActionRowBuilder<TextInputBuilder>[] = [];

    const nameInput = new TextInputBuilder()
      .setCustomId("name")
      .setLabel("Boss Name")
      .setStyle(TextInputStyle.Short)
      .setRequired(true)
      .setMaxLength(80);
    if (boss?.name) nameInput.setValue(boss.name);
    rows.push(
      new ActionRowBuilder<TextInputBuilder>().addComponents(nameInput),
    );

    if (type === "weekly") {
      const daysInput = new TextInputBuilder()
        .setCustomId("days")
        .setLabel("Days (e.g. Mon, Wed, Fri)")
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(100);
      if (boss?.recurrence_days) {
        daysInput.setValue(formatWeeklyDays(boss.recurrence_days));
      }
      rows.push(
        new ActionRowBuilder<TextInputBuilder>().addComponents(daysInput),
      );
    } else if (type === "event") {
      const dateInput = new TextInputBuilder()
        .setCustomId("event_date")
        .setLabel("Event Date (YYYY-MM-DD)")
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(20);
      if (boss?.event_date) dateInput.setValue(boss.event_date);
      rows.push(
        new ActionRowBuilder<TextInputBuilder>().addComponents(dateInput),
      );
    } else if (type === "interval") {
      const intervalInput = new TextInputBuilder()
        .setCustomId("interval")
        .setLabel("Respawn Duration (e.g. 4h, 8h, 240m)")
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(20);
      if (boss?.respawn_interval_minutes) {
        const h = boss.respawn_interval_minutes / 60;
        intervalInput.setValue(
          Number.isInteger(h) ? `${h}h` : `${boss.respawn_interval_minutes}m`,
        );
      }
      rows.push(
        new ActionRowBuilder<TextInputBuilder>().addComponents(intervalInput),
      );
    }

    const timesInput = new TextInputBuilder()
      .setCustomId("times")
      .setLabel(
        type === "interval"
          ? "Initial Spawn Time (e.g. 2:00 PM)"
          : "Spawn Times (e.g. 2:00 PM, 18:00)",
      )
      .setStyle(TextInputStyle.Short)
      .setRequired(true)
      .setMaxLength(250);
    if (boss?.times.length) timesInput.setValue(boss.times.join(", "));
    rows.push(
      new ActionRowBuilder<TextInputBuilder>().addComponents(timesInput),
    );

    const descInput = new TextInputBuilder()
      .setCustomId("description")
      .setLabel("Description / Tier (e.g. 1-Star Boss)")
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(false)
      .setMaxLength(800);
    if (boss?.description) descInput.setValue(boss.description);
    rows.push(
      new ActionRowBuilder<TextInputBuilder>().addComponents(descInput),
    );

    const enabledInput = new TextInputBuilder()
      .setCustomId("enabled")
      .setLabel("Enabled: yes or no")
      .setStyle(TextInputStyle.Short)
      .setRequired(true)
      .setMaxLength(3)
      .setValue(boss?.enabled === 0 ? "no" : "yes");
    rows.push(
      new ActionRowBuilder<TextInputBuilder>().addComponents(enabledInput),
    );

    modal.addComponents(rows);
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
      "**Members**\n/panel — dashboard\n/boss next · countdown — next spawn\n/boss schedule · list — all bosses\n/boss alerts — your preferences\n/boss subscribe [boss] — opt in (omit boss for all)\n/boss unsubscribe [boss] — opt out (omit boss for all)\n\n**Administrators**\n/add boss · /edit boss · /remove boss\n/set channel — notification destination\n/boss setup — settings and roles\n/boss test — test without mentions\n/boss publish — public schedule\n/boss status — recent delivery status\n/boss alive · /boss undo-report — administrator report corrections\n\nThis bot follows configured daily schedules; it cannot detect in-game spawns.",
    );
  }
}
