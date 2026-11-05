import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, EmbedBuilder, escapeMarkdown, } from "discord.js";
import { createHash } from "node:crypto";
import { DateTime } from "luxon";
import { SafeRetry } from "./scheduler.js";
import { Components } from "../ui/components.js";
import { ZONE, getNextBossOccurrence, formatTime, getNextOccurrence, groupBossesByTierAndLevel, toUnixSeconds, zoneLabel, } from "../utils/time.js";
import { validateChannel } from "../utils/permissions.js";
import { errorCode, UserError } from "../utils/logger.js";
export function scheduleText(store, guildId, limit = 20, nowMs = Date.now()) {
    const bosses = store.bosses(guildId).filter((b) => b.enabled);
    if (!bosses.length)
        return "No active bosses configured.";
    if (bosses.some((b) => b.schedule_type !== "daily")) {
        const tracking = Boolean(store.settings(guildId).interval_respawn_tracking_enabled);
        const text = bosses
            .slice(0, 12)
            .map((b) => {
            const times = (b.schedule_type === "interval" ? ["00:00"] : b.times)
                .map((t) => getNextBossOccurrence(b, t, nowMs, tracking))
                .filter((t) => t !== null);
            const at = times.length ? Math.min(...times) : null;
            return `**${escapeMarkdown(b.name)}** · ${b.schedule_type}\n${at !== null ? `Next: <t:${toUnixSeconds(at)}:f> (<t:${toUnixSeconds(at)}:R>)` : b.schedule_type === "interval" ? "Awaiting a defeat report, or tracking disabled" : "No upcoming occurrence"}`;
        })
            .join("\n\n");
        return text + (bosses.length > 12 ? "\n\nMore bosses: /boss schedule" : "");
    }
    const timeMap = new Map();
    for (const b of bosses) {
        for (const t of b.times) {
            const list = timeMap.get(t) ?? [];
            list.push(b);
            timeMap.set(t, list);
        }
    }
    const times = [...timeMap.keys()].sort();
    const visibleTimes = times.slice(0, limit);
    const timeRows = visibleTimes.map((t) => {
        const bList = timeMap.get(t);
        const has1 = bList.some((b) => (b.description ?? "").includes("1-Star"));
        const has2 = bList.some((b) => (b.description ?? "").includes("2-Star"));
        let tier = "";
        if (has1 && has2)
            tier = "⭐ 1-Star + ⭐⭐ 2-Star";
        else if (has1)
            tier = "⭐ 1-Star";
        else if (has2)
            tier = "⭐⭐ 2-Star";
        else
            tier = bList.map((b) => escapeMarkdown(b.name)).join(", ");
        const nextAt = getNextOccurrence(t, nowMs);
        const sec = toUnixSeconds(nextAt);
        return `**${formatTime(t)} PHT**\n• ${tier}\n• Your Time: <t:${sec}:t> (<t:${sec}:R>)`;
    });
    const { oneStar, twoStar, other } = groupBossesByTierAndLevel(bosses);
    const sections = [
        "*Daily Spawns • Philippine Time (UTC+8)*\n",
        "⏰ **Spawn Schedule**\n",
        timeRows.join("\n\n"),
        "\n───────────────────────────────────────────\n",
    ];
    if (oneStar.count > 0) {
        sections.push(`⭐ **1-Star Bosses (${oneStar.count})**`);
        for (const g of oneStar.groups) {
            sections.push(`**${g.group}** ${g.names.map((x) => escapeMarkdown(x)).join(" • ")}`);
        }
        sections.push("");
    }
    if (twoStar.count > 0) {
        sections.push(`⭐⭐ **2-Star Bosses (${twoStar.count})**`);
        for (const g of twoStar.groups) {
            if (g.group.includes("Guardian Beasts")) {
                sections.push(`**${g.group}**\n${g.names.map((x) => escapeMarkdown(x)).join(" • ")}`);
            }
            else {
                sections.push(`**${g.group}** ${g.names.map((x) => escapeMarkdown(x)).join(" • ")}`);
            }
        }
        sections.push("");
    }
    if (other.count > 0) {
        sections.push(`**Other Bosses (${other.count})**`);
        for (const g of other.groups) {
            sections.push(`**${g.group}** ${g.names.map((x) => escapeMarkdown(x)).join(" • ")}`);
        }
        sections.push("");
    }
    sections.push("───────────────────────────────────────────");
    sections.push(`**${bosses.length} Bosses • ${times.length} Daily Spawn Times**`);
    sections.push("All spawn times are based on Philippine Time (UTC+8).");
    if (times.length > limit) {
        sections.push("\n… and more. Use View Bosses.");
    }
    const text = sections.join("\n");
    return text.length > 3800
        ? text.slice(0, 3700) + "\n\nFull schedule: /boss schedule"
        : text;
}
export class Notifications {
    store;
    client;
    components;
    constructor(store, client, components) {
        this.store = store;
        this.client = client;
        this.components = components ?? new Components(store);
    }
    async channel(guildId, id) {
        const channelId = id ?? this.store.settings(guildId).notification_channel_id;
        if (!channelId)
            throw new UserError("No notification channel configured. An administrator can use /set channel.");
        const guild = this.client.guilds.cache.get(guildId);
        if (!guild)
            throw new UserError("The bot is not connected to this guild.");
        const channel = await guild.channels.fetch(channelId);
        validateChannel(channel, guildId, this.client.user.id);
        if (!channel ||
            (channel.type !== ChannelType.GuildText &&
                channel.type !== ChannelType.GuildAnnouncement))
            throw new UserError("Channel is not available.");
        return channel;
    }
    async prepare(guildId) {
        if (!this.client.isReady())
            throw new SafeRetry("Discord is disconnected");
        try {
            return (await this.channel(guildId)).id;
        }
        catch (error) {
            throw new SafeRetry(error instanceof UserError
                ? error.message
                : `Channel unavailable (${errorCode(error)})`);
        }
    }
    async send(channelId, events) {
        const first = events[0];
        // prepare() has already fetched and cached the channel; no asynchronous gap before send.
        const channel = this.client.channels.cache.get(channelId);
        if (!channel ||
            (channel.type !== ChannelType.GuildText &&
                channel.type !== ChannelType.GuildAnnouncement))
            throw new SafeRetry("Channel no longer available");
        const s = this.store.settings(first.guild_id);
        if (s.notification_channel_id !== channelId)
            throw new SafeRetry("Channel changed");
        const names = events.map((e) => e.minutes === -1
            ? ""
            : escapeMarkdown(this.store.boss(first.guild_id, e.boss_id).name));
        const daily = first.minutes === -1;
        const roles = new Set();
        if (!daily && s.role_mentions_enabled) {
            if (s.global_alert_role_id)
                roles.add(s.global_alert_role_id);
            for (const e of events) {
                const id = this.store.boss(first.guild_id, e.boss_id).role_id;
                if (id)
                    roles.add(id);
            }
        }
        // A deleted/privileged role must never become a notification target accidentally.
        for (const id of roles) {
            const role = channel.guild.roles.cache.get(id);
            if (!role ||
                role.id === channel.guild.id ||
                role.managed ||
                role.permissions.bitfield !== 0n)
                roles.delete(id);
        }
        const spawnSec = toUnixSeconds(first.spawn_at);
        const phtFormatted = `${DateTime.fromMillis(first.spawn_at, {
            zone: ZONE,
            locale: "en",
        }).toFormat("h:mm a")} PHT`;
        let title;
        let description;
        let color = 0x8b5cf6;
        if (daily) {
            title = "👹 TODAY’S BOSS SCHEDULE";
            description = scheduleText(this.store, first.guild_id);
            color = 0x8b5cf6;
        }
        else {
            const activeBosses = events
                .map((e) => this.store.boss(first.guild_id, e.boss_id))
                .filter(Boolean);
            const { oneStar, twoStar, other } = groupBossesByTierAndLevel(activeBosses);
            const bossSections = [];
            if (oneStar.count > 0) {
                bossSections.push(`⭐ **1-Star Bosses (${oneStar.count})**`);
                for (const g of oneStar.groups) {
                    bossSections.push(`**${g.group}** ${g.names.map((x) => escapeMarkdown(x)).join(" • ")}`);
                }
                bossSections.push("");
            }
            if (twoStar.count > 0) {
                bossSections.push(`⭐⭐ **2-Star Bosses (${twoStar.count})**`);
                for (const g of twoStar.groups) {
                    if (g.group.includes("Guardian Beasts")) {
                        bossSections.push(`**${g.group}**\n${g.names.map((x) => escapeMarkdown(x)).join(" • ")}`);
                    }
                    else {
                        bossSections.push(`**${g.group}** ${g.names.map((x) => escapeMarkdown(x)).join(" • ")}`);
                    }
                }
                bossSections.push("");
            }
            if (other.count > 0) {
                bossSections.push(`**Other Bosses (${other.count})**`);
                for (const g of other.groups) {
                    bossSections.push(`**${g.group}** ${g.names.map((x) => escapeMarkdown(x)).join(" • ")}`);
                }
                bossSections.push("");
            }
            const bossListText = bossSections.join("\n").trim();
            if (first.minutes === 30) {
                title = "⏰ BOSS SPAWN IN 30 MINUTES";
                color = 0xeab308;
                description = `**Scheduled Spawn:** ${phtFormatted}\n**Your Local Time:** <t:${spawnSec}:t>\n**Starts:** <t:${spawnSec}:R>\n\n${bossListText}\n\n⚔️ **Prepare your party!**`;
            }
            else if (first.minutes === 10) {
                title = "⚠️ BOSS SPAWN IN 10 MINUTES!";
                color = 0xf59e0b;
                description = `**Scheduled Spawn:** ${phtFormatted}\n**Your Local Time:** <t:${spawnSec}:t>\n**Starts:** <t:${spawnSec}:R>\n\n${bossListText}\n\n⚔️ **Get ready!**`;
            }
            else if (first.minutes === 0) {
                title = "🔥 GEHENNA BOSSES HAVE SPAWNED!";
                color = 0xf97316;
                description = `**Scheduled Spawn:** ${phtFormatted}\n**Your Local Time:** <t:${spawnSec}:t>\n\n${bossListText}\n\n⚔️ **Good luck, everyone!**`;
            }
            else {
                title = `⏰ BOSS SPAWN IN ${first.minutes} MINUTES!`;
                color = 0xf59e0b;
                description = `**Scheduled Spawn:** ${phtFormatted}\n**Your Local Time:** <t:${spawnSec}:t>\n**Starts:** <t:${spawnSec}:R>\n\n${bossListText}\n\n⚔️ **Prepare your party!**`;
            }
        }
        if (!daily &&
            events.some((e) => this.store.boss(first.guild_id, e.boss_id).schedule_type ===
                "interval")) {
            title =
                first.minutes === 0
                    ? "⏳ ESTIMATED RESPAWN TIME"
                    : `⏳ ESTIMATED RESPAWN IN ${first.minutes} MINUTES`;
            description +=
                "\n\nRespawn estimates use player defeat reports; appearance is not confirmed in-game.";
        }
        const embed = new EmbedBuilder()
            .setColor(color)
            .setTitle(title)
            .setDescription(description)
            .setFooter({ text: zoneLabel })
            .setTimestamp();
        const roleIds = [...roles];
        const nonce = createHash("sha256")
            .update(events
            .map((e) => e.event_key)
            .sort()
            .join("|"))
            .digest("hex")
            .slice(0, 24);
        const components = [];
        if (first.minutes === 0 && s.interval_respawn_tracking_enabled) {
            const targetEvents = events.filter((e) => e.boss_id > 0);
            const intervalEvents = targetEvents.filter((e) => this.store.boss(first.guild_id, e.boss_id).schedule_type ===
                "interval");
            const eligible = intervalEvents.length > 0 ? intervalEvents : targetEvents;
            if (eligible.length === 1) {
                const b = this.store.boss(first.guild_id, eligible[0].boss_id);
                const btn = new ButtonBuilder()
                    .setCustomId(this.components.id(first.guild_id, "0", "defeated", String(b.id), true))
                    .setLabel("⚔️ Report Defeated")
                    .setStyle(ButtonStyle.Success);
                components.push(new ActionRowBuilder().addComponents(btn));
            }
            else if (eligible.length > 1 && eligible.length <= 10) {
                for (let i = 0; i < eligible.length; i += 5) {
                    const chunk = eligible.slice(i, i + 5);
                    const buttons = chunk.map((e) => {
                        const b = this.store.boss(first.guild_id, e.boss_id);
                        const shortName = b.name.length > 20 ? b.name.slice(0, 19) + "…" : b.name;
                        return new ButtonBuilder()
                            .setCustomId(this.components.id(first.guild_id, "0", "defeated", String(b.id), true))
                            .setLabel(`⚔️ ${shortName}`)
                            .setStyle(ButtonStyle.Success);
                    });
                    components.push(new ActionRowBuilder().addComponents(buttons));
                }
            }
        }
        try {
            const message = await channel.send({
                embeds: [embed],
                components: components.length ? components : undefined,
                content: roleIds.map((id) => `<@&${id}>`).join(" ") || undefined,
                allowedMentions: {
                    parse: [],
                    roles: roleIds,
                    users: [],
                    repliedUser: false,
                },
                nonce,
                enforceNonce: true,
            });
            return message.id;
        }
        catch (error) {
            const code = errorCode(error);
            if (["50001", "50013", "10003", "RateLimitError"].includes(code) ||
                (error instanceof Error && error.name === "RateLimitError"))
                throw new SafeRetry(`Discord rejected send (${code})`);
            throw error;
        }
    }
    async test(guildId) {
        const channel = await this.channel(guildId);
        await channel.send({
            embeds: [
                new EmbedBuilder()
                    .setTitle("🧪 TEST — Boss tracker")
                    .setDescription("Notifications can reach this channel. This is not a real spawn alert.\n" +
                    scheduleText(this.store, guildId, 5))
                    .setColor(0x5865f2)
                    .setFooter({ text: zoneLabel }),
            ],
            allowedMentions: { parse: [] },
        });
    }
    async setChannel(guildId, channelId) {
        await this.channel(guildId, channelId);
        const previous = this.store.settings(guildId).notification_channel_id;
        this.store.updateSettings(guildId, { notification_channel_id: channelId });
        return previous;
    }
}
//# sourceMappingURL=notifications.js.map