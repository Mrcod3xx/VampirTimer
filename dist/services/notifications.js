import { ChannelType, EmbedBuilder, escapeMarkdown, } from "discord.js";
import { createHash } from "node:crypto";
import { DateTime } from "luxon";
import { SafeRetry } from "./scheduler.js";
import { formatTime, ZONE, zoneLabel } from "../utils/time.js";
import { validateChannel } from "../utils/permissions.js";
import { errorCode, UserError } from "../utils/logger.js";
export function scheduleText(store, guildId, limit = 20) {
    const bosses = store.bosses(guildId).filter((b) => b.enabled);
    if (!bosses.length)
        return "No active bosses configured.";
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
    let text = visibleTimes
        .map((t) => {
        const list = timeMap.get(t);
        const groups = new Map();
        for (const b of list) {
            const group = b.description.trim() || "";
            const gList = groups.get(group) ?? [];
            gList.push(escapeMarkdown(b.name));
            groups.set(group, gList);
        }
        const sections = [];
        for (const [group, names] of groups.entries()) {
            if (group) {
                const star = group.includes("1-Star")
                    ? "⭐ "
                    : group.includes("2-Star")
                        ? "⭐⭐ "
                        : "";
                sections.push(`${star}**${escapeMarkdown(group)}**\n${names.map((n) => `• ${n}`).join("\n")}`);
            }
            else {
                sections.push(names.map((n) => `• ${n}`).join("\n"));
            }
        }
        return `**${formatTime(t)}**\n${sections.join("\n\n")}`;
    })
        .join("\n\n");
    if (times.length > limit) {
        text += `\n\n… and more. Use /boss schedule.`;
    }
    return text;
}
export class Notifications {
    store;
    client;
    constructor(store, client) {
        this.store = store;
        this.client = client;
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
        const spawnTimeFormatted = DateTime.fromMillis(first.spawn_at, {
            zone: ZONE,
            locale: "en",
        }).toFormat("h:mm a");
        let title;
        let description;
        if (daily) {
            title = "👹 TODAY’S BOSS SCHEDULE";
            description = scheduleText(this.store, first.guild_id);
        }
        else if (first.minutes === 30) {
            title = "⏰ BOSS SPAWN WARNING";
            description = `The following bosses spawn in 30 minutes:\n\n${names.map((n) => `- ${n}`).join("\n")}\n\nSpawn Time: **${spawnTimeFormatted}**\nTimezone: Philippine Time (UTC+8)\n\nPrepare your party!`;
        }
        else if (first.minutes === 10) {
            title = "⚠️ BOSS SPAWN IN 10 MINUTES!";
            description = `Upcoming Bosses:\n\n${names.map((n) => `- ${n}`).join("\n")}\n\nSpawn Time: **${spawnTimeFormatted}**\n\nGet ready!`;
        }
        else if (first.minutes === 0) {
            title = "🔥 BOSS SPAWN TIME!";
            description = `The following bosses are scheduled to spawn NOW!\n\n${names.map((n) => `- ${n}`).join("\n")}\n\nSpawn Time: **${spawnTimeFormatted}**\nTimezone: Philippine Time (UTC+8)\n\nGood luck, everyone!`;
        }
        else {
            title = `⏰ BOSS SPAWN IN ${first.minutes} MINUTES!`;
            description = `Upcoming Bosses:\n\n${names.map((n) => `- ${n}`).join("\n")}\n\nSpawn Time: **${spawnTimeFormatted}**\nTimezone: Philippine Time (UTC+8)\n\nPrepare your party!`;
        }
        const embed = new EmbedBuilder()
            .setColor(daily ? 0x5865f2 : first.minutes === 0 ? 0xe66b38 : 0xf0b843)
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
        try {
            const message = await channel.send({
                embeds: [embed],
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