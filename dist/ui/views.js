import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelSelectMenuBuilder, ChannelType, EmbedBuilder, ModalBuilder, RoleSelectMenuBuilder, StringSelectMenuBuilder, TextInputBuilder, TextInputStyle, escapeMarkdown, } from "discord.js";
import { DateTime } from "luxon";
import { settingToggles } from "../database/store.js";
import { ZONE, formatTime, getNextOccurrence, groupBossesByTierAndLevel, nextSpawn, toUnixSeconds, zoneLabel, } from "../utils/time.js";
export const row = (...components) => new ActionRowBuilder().addComponents(components);
const labels = {
    notifications_enabled: "All notifications",
    reminder_30_enabled: "30-minute warnings",
    reminder_10_enabled: "10-minute warnings",
    spawn_notification_enabled: "Spawn alerts",
    combine_notifications: "Combine simultaneous spawns",
    role_mentions_enabled: "Role mentions",
    daily_enabled: "Daily schedule",
};
export class Views {
    store;
    components;
    now;
    constructor(store, components, now = Date.now) {
        this.store = store;
        this.components = components;
        this.now = now;
    }
    id(g, u, action, arg = "") {
        return this.components.id(g, u, action, arg);
    }
    button(g, u, action, label, arg = "", style = ButtonStyle.Secondary) {
        return new ButtonBuilder()
            .setCustomId(this.id(g, u, action, arg))
            .setLabel(label)
            .setStyle(style);
    }
    view(title, description, rows = [], color = 0x5865f2) {
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
    back(g, u, action = "admin") {
        return this.button(g, u, action, "Back");
    }
    main(g, u) {
        const s = this.store.settings(g);
        const bosses = this.store.bosses(g);
        const next = nextSpawn(bosses, this.now());
        let nextSpawnText = "None";
        if (next) {
            const sec = toUnixSeconds(next.at);
            const pht = `${DateTime.fromMillis(next.at, { zone: ZONE }).toFormat("h:mm a")} PHT`;
            nextSpawnText = `${pht} (<t:${sec}:R>)`;
        }
        return this.view("👹 GEHENNA BOSS TRACKER", `**Bosses Tracked:** ${bosses.length}\n**Notification Channel:** ${s.notification_channel_id ? `<#${s.notification_channel_id}>` : "Not configured"}\n**Notifications:** ${s.notifications_enabled ? "🟢 Enabled" : "🔴 Disabled"}\n**Next Spawn:** ${nextSpawnText}`, [
            row(this.button(g, u, "schedule", "View Bosses", "0"), this.button(g, u, "next", "Next Boss"), this.button(g, u, "alerts", "My Alerts"), this.button(g, u, "admin", "Admin Settings")),
        ], 0x8b5cf6);
    }
    admin(g, u) {
        const s = this.store.settings(g);
        const bosses = this.store.bosses(g);
        const desc = [
            "Manage boss schedules and notifications\n",
            `**Notification Channel:** ${s.notification_channel_id ? `<#${s.notification_channel_id}>` : "Not configured"}`,
            `**Bosses Tracked:** ${bosses.length}`,
            `**Notifications:** ${s.notifications_enabled ? "🟢 Enabled" : "🔴 Disabled"}`,
            `**Timezone:** Philippine Time (UTC+8)`,
        ].join("\n");
        return this.view("⚙️ BOSS TRACKER CONTROL PANEL", desc, [
            row(this.button(g, u, "add", "➕ Add Boss"), this.button(g, u, "manage", "📋 Manage", "0"), this.button(g, u, "schedule", "⏰ Schedule", "0")),
            row(this.button(g, u, "channels", "# Set Channel"), this.button(g, u, "settings", "🔔 Alerts"), this.button(g, u, "roles", "🏷️ Roles")),
            row(this.button(g, u, "test", "🧪 Test"), this.button(g, u, "status", "📊 Status"), this.button(g, u, "more", "⚙️ More")),
        ], 0x5865f2);
    }
    more(g, u) {
        return this.view("⚙️ ADVANCED ADMIN TOOLS", "Additional management controls for the boss tracker.", [
            row(this.button(g, u, "publish", "📢 Publish Schedule"), this.button(g, u, "resetPanel", "🔄 Reset Public Panel"), this.button(g, u, "intervals", "⏰ Reminder Intervals")),
            row(this.button(g, u, "backup", "💾 Backup Database"), this.back(g, u, "admin")),
        ], 0x5865f2);
    }
    next(g, u) {
        const next = nextSpawn(this.store.bosses(g), this.now());
        if (!next) {
            return this.view("⏳ NEXT BOSS SPAWN", "No active schedules.", [
                row(this.button(g, u, "next", "Refresh"), this.button(g, u, "schedule", "Full Schedule", "0"), this.back(g, u, "main")),
            ], 0x8b5cf6);
        }
        const sec = toUnixSeconds(next.at);
        const phtFormatted = `${DateTime.fromMillis(next.at, { zone: ZONE, locale: "en" }).toFormat("h:mm a")} PHT`;
        const { oneStar, twoStar, other } = groupBossesByTierAndLevel(next.bosses);
        const bossSections = [];
        if (oneStar.count > 0) {
            bossSections.push(`⭐ **1-Star Bosses (${oneStar.count})**`);
            for (const grp of oneStar.groups) {
                bossSections.push(`**${grp.group}** ${grp.names.map((x) => escapeMarkdown(x)).join(" • ")}`);
            }
            bossSections.push("");
        }
        if (twoStar.count > 0) {
            bossSections.push(`⭐⭐ **2-Star Bosses (${twoStar.count})**`);
            for (const grp of twoStar.groups) {
                if (grp.group.includes("Guardian Beasts")) {
                    bossSections.push(`**${grp.group}**\n${grp.names.map((x) => escapeMarkdown(x)).join(" • ")}`);
                }
                else {
                    bossSections.push(`**${grp.group}** ${grp.names.map((x) => escapeMarkdown(x)).join(" • ")}`);
                }
            }
            bossSections.push("");
        }
        if (other.count > 0) {
            bossSections.push(`**Other Bosses (${other.count})**`);
            for (const grp of other.groups) {
                bossSections.push(`**${grp.group}** ${grp.names.map((x) => escapeMarkdown(x)).join(" • ")}`);
            }
            bossSections.push("");
        }
        const rawDesc = [
            `**Philippine Time:** ${phtFormatted}`,
            `**Your Local Time:** <t:${sec}:t>`,
            `**Full Date:** <t:${sec}:F>`,
            `**Starts:** <t:${sec}:R>\n`,
            `**Scheduled Bosses (${next.bosses.length})**`,
            bossSections.join("\n").trim(),
        ].join("\n");
        const desc = rawDesc.length > 4000 ? `${rawDesc.slice(0, 3950)}…` : rawDesc;
        const v = this.view("⏳ NEXT BOSS SPAWN", desc, [
            row(this.button(g, u, "next", "🔄 Refresh"), this.button(g, u, "schedule", "📅 Full Schedule", "0"), this.back(g, u, "main")),
        ], 0x8b5cf6);
        v.embeds[0].setFooter({
            text: "Countdown is refreshed when you open this view. In Discord, use a refresh button or timestamp.",
        });
        return v;
    }
    countdown(g, u) {
        const next = nextSpawn(this.store.bosses(g), this.now());
        if (!next) {
            return this.view("⏳ NEXT BOSS COUNTDOWN", "No upcoming bosses scheduled.", [
                row(this.button(g, u, "countdown", "Refresh"), this.button(g, u, "schedule", "Full Schedule", "0"), this.back(g, u, "main")),
            ], 0x8b5cf6);
        }
        const sec = toUnixSeconds(next.at);
        const phtFormatted = `${DateTime.fromMillis(next.at, { zone: ZONE, locale: "en" }).toFormat("h:mm a")} PHT`;
        const { oneStar, twoStar, other } = groupBossesByTierAndLevel(next.bosses);
        const desc = [
            `**Spawn:** ${phtFormatted}`,
            `**Your Local Time:** <t:${sec}:t>`,
            `**Countdown:** <t:${sec}:R>`,
            `**Bosses:** ${next.bosses.length}\n`,
            oneStar.count > 0 ? `⭐ **1-Star:** ${oneStar.count} bosses` : "",
            twoStar.count > 0 ? `⭐⭐ **2-Star:** ${twoStar.count} bosses` : "",
            other.count > 0 ? `**Other:** ${other.count} bosses` : "",
        ]
            .filter(Boolean)
            .join("\n");
        return this.view("⏳ NEXT BOSS COUNTDOWN", desc, [
            row(this.button(g, u, "countdown", "🔄 Refresh"), this.button(g, u, "schedule", "📅 Full Schedule", "0"), this.back(g, u, "main")),
        ], 0x8b5cf6);
    }
    schedule(g, u, page = 0, mode = "schedule") {
        const bosses = this.store.bosses(g);
        const size = 10;
        const pages = Math.max(1, Math.ceil(bosses.length / size));
        page = Math.max(0, Math.min(pages - 1, Number.isFinite(page) ? page : 0));
        const visible = bosses.slice(page * size, (page + 1) * size);
        const rows = [];
        if (visible.length) {
            rows.push(row(new StringSelectMenuBuilder()
                .setCustomId(this.id(g, u, mode === "manage"
                ? "selectBoss"
                : mode === "choose"
                    ? "selectAlert"
                    : "viewBossDetail"))
                .setPlaceholder("Choose a boss for details")
                .addOptions(visible.map((b) => ({
                label: b.name.slice(0, 100),
                value: String(b.id),
                description: `${b.description || (b.enabled ? "Active" : "Disabled")}`.slice(0, 100),
            })))));
        }
        const nav = [];
        if (pages > 1) {
            nav.push(this.button(g, u, mode, "Previous", String(page - 1)).setDisabled(page === 0), this.button(g, u, mode, "Next", String(page + 1)).setDisabled(page === pages - 1));
        }
        nav.push(this.back(g, u, mode === "manage" ? "admin" : mode === "choose" ? "alerts" : "main"));
        if (mode === "manage")
            nav.push(this.button(g, u, "add", "Add Boss"));
        rows.push(row(...nav));
        const pageSubtitle = pages > 1
            ? `Page ${page + 1} of ${pages} • ${bosses.length} bosses\nAll times below are Philippine Time.`
            : `${bosses.length} bosses • Philippine Time (UTC+8)`;
        const result = this.view(mode === "manage"
            ? "⚙️ MANAGE BOSSES"
            : mode === "choose"
                ? "🔔 SELECT A BOSS"
                : "📅 DAILY BOSS SCHEDULE", pageSubtitle, rows, mode === "schedule" ? 0x8b5cf6 : 0x5865f2);
        if (!visible.length) {
            result.embeds[0].addFields({
                name: "No bosses",
                value: "An administrator can use /add boss.",
            });
        }
        for (const b of visible) {
            result.embeds[0].addFields({
                name: `${b.enabled ? "🟢" : "⏸️"} ${b.name}`,
                value: `${b.times.map(formatTime).join(" · ")}\n${escapeMarkdown(b.description).slice(0, 400) || "Daily recurrence"}`,
                inline: true,
            });
        }
        return result;
    }
    boss(g, u, id, member = false) {
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
        if (member) {
            const nextAt = Math.min(...b.times.map((t) => getNextOccurrence(t, this.now())));
            const nextSec = toUnixSeconds(nextAt);
            const nextPht = `${DateTime.fromMillis(nextAt, { zone: ZONE }).toFormat("h:mm a")} PHT`;
            const desc = [
                `**Tier:** ${tierBadge}`,
                `**Status:** ${b.enabled ? "Active" : "Disabled"}\n`,
                `⏰ **Spawn Schedule**`,
                b.times.map((t) => `• ${formatTime(t)} PHT`).join("\n") + "\n",
                `⏱️ **Next Spawn**`,
                `**Philippine Time:** ${nextPht}`,
                `**Your Local Time:** <t:${nextSec}:t>`,
                `**Starts:** <t:${nextSec}:R>`,
            ].join("\n");
            return this.view(`${starEmoji} ${escapeMarkdown(b.name)}`, desc, [
                row(this.button(g, u, "subscribe", "Subscribe", String(id), ButtonStyle.Success), this.button(g, u, "unsubscribe", "Unsubscribe", String(id)), this.button(g, u, "schedule", "Back to Directory", "0")),
            ], 0x8b5cf6);
        }
        const desc = [
            `${b.enabled ? "🟢 Active" : "⏸️ Disabled"}  ${tierBadge}\n`,
            `⏰ **Spawn Schedule**\n${b.times.map(formatTime).join(" • ")}\n`,
            `🔔 **Alert Role**\n${b.role_id ? `<@&${b.role_id}>` : "Not configured"}`,
        ].join("\n");
        return this.view(`${starEmoji} ${escapeMarkdown(b.name)}`, desc, [
            row(this.button(g, u, "edit", "✏️ Edit", String(id)), this.button(g, u, "toggleBoss", b.enabled ? "⏸️ Disable" : "▶️ Enable", String(id)), this.button(g, u, "bossRole", "🔔 Set Role", String(id)), this.button(g, u, "remove", "🗑️ Remove", String(id), ButtonStyle.Danger), this.button(g, u, "manage", "← Back", "0")),
        ], 0x5865f2);
    }
    remove(g, u, id) {
        const b = this.store.boss(g, id);
        return this.view("⚠️ REMOVE BOSS?", `Remove **${escapeMarkdown(b.name)}** and its future alerts? Other bosses will stay configured.`, [
            row(this.button(g, u, "confirmRemove", "Confirm Removal", String(id), ButtonStyle.Danger), this.button(g, u, "manage", "Cancel", "0")),
        ]);
    }
    settings(g, u) {
        const s = this.store.settings(g);
        const rows = [];
        const buttons = settingToggles.map((k) => this.button(g, u, "setting", `${s[k] ? "✓" : "✕"} ${labels[k]}`, k, s[k] ? ButtonStyle.Success : ButtonStyle.Secondary));
        for (let n = 0; n < buttons.length; n += 3)
            rows.push(row(...buttons.slice(n, n + 3)));
        rows.push(row(this.button(g, u, "intervals", "Edit Reminder Times"), this.back(g, u)));
        return this.view("⚙️ NOTIFICATION SETTINGS", `Reminder intervals: **${JSON.parse(s.reminder_minutes).join(", ") || "None"} minutes**\nDaily schedule: **${formatTime(s.daily_time)}**\n30- and 10-minute switches apply when those intervals are in the list. Exact-spawn alerts have a separate switch.`, rows);
    }
    channels(g, u, suggested) {
        const s = this.store.settings(g);
        const menu = new ChannelSelectMenuBuilder()
            .setCustomId(this.id(g, u, "selectChannel"))
            .setPlaceholder("Choose the notification channel")
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement);
        if (s.notification_channel_id || suggested)
            menu.setDefaultChannels(s.notification_channel_id ?? suggested);
        const desc = [
            `**Current Channel:** ${s.notification_channel_id ? `<#${s.notification_channel_id}>` : "Not configured"}`,
            `**Status:** ${s.notification_channel_id ? "🟢 Connected" : "🔴 No channel selected"}\n`,
            `**Bot Permissions**`,
            `• View Channel: Available`,
            `• Send Messages: Available`,
            `• Embed Links: Available\n`,
            `${suggested ? `Suggested: <#${suggested}>\n` : ""}Choose a channel below, then confirm. The bot will send future spawn alerts there:`,
        ].join("\n");
        return this.view("# NOTIFICATION CHANNEL SETTINGS", desc, [
            row(menu),
            row(this.button(g, u, "test", "🧪 Test Notification"), this.back(g, u)),
        ], 0x5865f2);
    }
    status(g, u) {
        const s = this.store.settings(g);
        const lastLog = this.store.db
            .prepare("SELECT status, error_message, sent_at FROM notification_logs WHERE guild_id=? ORDER BY scheduled_at DESC LIMIT 1")
            .get(g);
        const lastDeliveryText = !lastLog
            ? "No events yet"
            : lastLog.status === "sent"
                ? "Successful"
                : lastLog.error_message || lastLog.status;
        const next = nextSpawn(this.store.bosses(g), this.now());
        let nextAlertText = "No upcoming alerts scheduled";
        if (next) {
            const intervals = JSON.parse(s.reminder_minutes).sort((a, b) => b - a);
            const candidates = intervals
                .map((m) => next.at - m * 60000)
                .filter((t) => t >= this.now());
            const nextAlertAt = candidates.length > 0 ? Math.min(...candidates) : next.at;
            const alertSec = toUnixSeconds(nextAlertAt);
            const alertPht = `${DateTime.fromMillis(nextAlertAt, { zone: ZONE }).toFormat("h:mm a")} PHT`;
            nextAlertText = `**Philippine Time:** ${alertPht}\n**Your Local Time:** <t:${alertSec}:t>\n**Starts:** <t:${alertSec}:R>`;
        }
        const desc = [
            `**Bot Status:** Online`,
            `**Scheduler:** Running`,
            `**Notification Channel:** ${s.notification_channel_id ? `<#${s.notification_channel_id}>` : "Not configured"}`,
            `**Last Delivery:** ${lastDeliveryText}\n`,
            `**Next Scheduled Alert:**`,
            nextAlertText,
        ].join("\n");
        return this.view("📊 NOTIFICATION DELIVERY STATUS", desc, [
            row(this.button(g, u, "status", "🔄 Refresh"), this.button(g, u, "test", "🧪 Test Notification"), this.back(g, u, "admin")),
        ], 0x3b82f6);
    }
    confirmChannel(g, u, id) {
        return this.view("📣 CONFIRM CHANNEL", `Send future scheduled notifications to <#${id}>?`, [
            row(this.button(g, u, "confirmChannel", "Confirm Channel", id, ButtonStyle.Success), this.button(g, u, "channels", "Cancel")),
        ]);
    }
    roles(g, u, scope = 0) {
        const s = this.store.settings(g);
        const role = scope === 0 ? s.global_alert_role_id : this.store.boss(g, scope).role_id;
        const rows = [
            row(new RoleSelectMenuBuilder()
                .setCustomId(this.id(g, u, "selectRole", String(scope)))
                .setPlaceholder("Select a dedicated opt-in role")),
            row(this.button(g, u, "createRole", "Create Opt-in Role", String(scope)), this.back(g, u)),
        ];
        return this.view("🔔 ALERT ROLE SETTINGS", `Scope: **${scope === 0 ? "All bosses" : escapeMarkdown(this.store.boss(g, scope).name)}**\nCurrent: ${role ? `<@&${role}>` : "Not configured"}\nUse a role with no permissions, below the bot’s highest role. Members opt in themselves.\nTo set a boss-specific role, use Manage Bosses → choose boss → Set Alert Role.`, rows);
    }
    alerts(g, u, held) {
        const s = this.store.settings(g);
        const all = Boolean(s.global_alert_role_id && held.has(s.global_alert_role_id));
        const bosses = this.store
            .bosses(g)
            .filter((b) => b.role_id && held.has(b.role_id));
        const isEnabled = all || bosses.length > 0;
        let subsText;
        if (all) {
            subsText =
                "⭐ 1-Star Bosses — Subscribed\n⭐⭐ 2-Star Bosses — Subscribed\n*(All Gehenna Bosses)*";
        }
        else if (bosses.length > 0) {
            subsText =
                bosses
                    .slice(0, 15)
                    .map((b) => `• ${escapeMarkdown(b.name)} — Subscribed`)
                    .join("\n") + (bosses.length > 15 ? "\n…more subscriptions" : "");
        }
        else {
            subsText = "None configured";
        }
        const desc = [
            `**Status:** ${isEnabled ? "🟢 Enabled" : "🔴 Disabled"}\n`,
            `**Subscriptions**\n${subsText}\n`,
            `**Notification Role**\n${s.global_alert_role_id ? `<@&${s.global_alert_role_id}>` : "Not configured"}\n`,
            `Enable Alerts subscribes to **all** bosses. Selecting an individual boss removes the all-boss role. Disable Alerts removes all opt-in roles.`,
        ].join("\n");
        const toggleButton = isEnabled
            ? this.button(g, u, "unsubscribe", "Disable Alerts", "all", ButtonStyle.Danger)
            : this.button(g, u, "subscribe", "Enable Alerts", "0", ButtonStyle.Success);
        return this.view("🔔 MY BOSS ALERTS", desc, [
            row(toggleButton, this.button(g, u, "choose", "Choose Bosses", "0"), this.button(g, u, "schedule", "View Schedule", "0")),
            row(this.back(g, u, "main")),
        ], 0x8b5cf6);
    }
    bossModal(g, u, boss) {
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
        ];
        for (const [id, label, value, required, max] of fields) {
            const input = new TextInputBuilder()
                .setCustomId(id)
                .setLabel(label)
                .setStyle(id === "description"
                ? TextInputStyle.Paragraph
                : TextInputStyle.Short)
                .setRequired(required)
                .setMaxLength(max);
            if (value)
                input.setValue(value);
            modal.addComponents(new ActionRowBuilder().addComponents(input));
        }
        return modal;
    }
    intervalsModal(g, u) {
        const s = this.store.settings(g);
        const minutes = new TextInputBuilder()
            .setCustomId("minutes")
            .setLabel("Reminder minutes (1–180), max 5")
            .setStyle(TextInputStyle.Short)
            .setRequired(false);
        const value = JSON.parse(s.reminder_minutes).join(", ");
        if (value)
            minutes.setValue(value);
        return new ModalBuilder()
            .setCustomId(this.id(g, u, "saveIntervals"))
            .setTitle("Notification Times")
            .addComponents(new ActionRowBuilder().addComponents(minutes), new ActionRowBuilder().addComponents(new TextInputBuilder()
            .setCustomId("daily")
            .setLabel("Daily schedule time (Philippine Time)")
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setValue(formatTime(s.daily_time))));
    }
    resetPanel(g, u) {
        return this.view("⚠️ RESET PUBLIC PANEL REFERENCE?", "Use this only if the old public panel cannot be reached. This forgets its saved message ID. It does not delete the old Discord message. Remove any old message manually before publishing a replacement to avoid duplicate panels.", [
            row(this.button(g, u, "confirmResetPanel", "Forget Saved Panel", "", ButtonStyle.Danger), this.back(g, u)),
        ]);
    }
    help() {
        return this.view("📖 BOSS TRACKER HELP", "**Members**\n/panel — dashboard\n/boss next · countdown — next spawn\n/boss schedule · list — all bosses\n/boss alerts — your preferences\n/boss subscribe [boss] — opt in (omit boss for all)\n/boss unsubscribe [boss] — opt out (omit boss for all)\n\n**Administrators**\n/add boss · /edit boss · /remove boss\n/set channel — notification destination\n/boss setup — settings and roles\n/boss test — test without mentions\n/boss publish — public schedule\n/boss status — recent delivery status\n\nThis bot follows configured daily schedules; it cannot detect in-game spawns.");
    }
}
//# sourceMappingURL=views.js.map