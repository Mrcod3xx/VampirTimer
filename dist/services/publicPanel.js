import { ButtonBuilder, ButtonStyle, EmbedBuilder, PermissionFlagsBits, } from "discord.js";
import { scheduleText } from "./notifications.js";
import { row } from "../ui/views.js";
import { errorCode, log, UserError } from "../utils/logger.js";
export class PublicPanel {
    notifications;
    views;
    locks = new Map();
    constructor(notifications, views) {
        this.notifications = notifications;
        this.views = views;
    }
    async refresh(guildId, publish = false) {
        const prior = this.locks.get(guildId) ?? Promise.resolve();
        const task = prior.catch(() => { }).then(() => this.write(guildId, publish));
        this.locks.set(guildId, task);
        try {
            return await task;
        }
        finally {
            if (this.locks.get(guildId) === task)
                this.locks.delete(guildId);
        }
    }
    async write(guildId, publish) {
        const store = this.notifications.store;
        const s = store.settings(guildId);
        if (!s.panel_message_id && !publish)
            return "";
        const payload = {
            embeds: [
                new EmbedBuilder()
                    .setTitle("👿 GEHENNA BOSS TRACKER")
                    .setDescription(scheduleText(store, guildId))
                    .setColor(0x5865f2),
            ],
            components: [
                row(new ButtonBuilder()
                    .setCustomId(this.views.components.id(guildId, "0", "next", "", true))
                    .setLabel("Next Spawn")
                    .setEmoji("⏱")
                    .setStyle(ButtonStyle.Secondary), new ButtonBuilder()
                    .setCustomId(this.views.components.id(guildId, "0", "schedule", "0", true))
                    .setLabel("View Bosses")
                    .setEmoji("📑")
                    .setStyle(ButtonStyle.Secondary), new ButtonBuilder()
                    .setCustomId(this.views.components.id(guildId, "0", "alerts", "", true))
                    .setLabel("My Alerts")
                    .setEmoji("🔔")
                    .setStyle(ButtonStyle.Secondary), new ButtonBuilder()
                    .setCustomId(this.views.components.id(guildId, "0", "refresh", "", true))
                    .setLabel("Refresh")
                    .setEmoji("🔄")
                    .setStyle(ButtonStyle.Secondary)),
            ],
            allowedMentions: { parse: [] },
        };
        if (s.panel_message_id && s.panel_channel_id) {
            try {
                const oldChannel = await this.notifications.channel(guildId, s.panel_channel_id);
                if (!oldChannel
                    .permissionsFor(this.notifications.client.user.id)
                    ?.has(PermissionFlagsBits.ReadMessageHistory))
                    throw new UserError("Read Message History is required to update the public panel.");
                const old = await oldChannel.messages.fetch(s.panel_message_id);
                if (oldChannel.id === s.notification_channel_id) {
                    await old.edit(payload);
                    return old.url;
                }
                // Retire the old panel before publishing at the new destination.
                await old.edit({
                    embeds: [
                        new EmbedBuilder()
                            .setTitle("Boss tracker moved")
                            .setDescription(`Use <#${s.notification_channel_id}> or /panel.`),
                    ],
                    components: [],
                    allowedMentions: { parse: [] },
                });
                store.updateSettings(guildId, {
                    panel_message_id: null,
                    panel_channel_id: null,
                });
                if (!publish)
                    return "";
            }
            catch (error) {
                if (!["10008", "10003"].includes(errorCode(error)))
                    throw error;
                store.updateSettings(guildId, {
                    panel_message_id: null,
                    panel_channel_id: null,
                });
                if (!publish)
                    return "";
            }
        }
        const channel = await this.notifications.channel(guildId);
        if (!channel
            .permissionsFor(this.notifications.client.user.id)
            ?.has(PermissionFlagsBits.ReadMessageHistory))
            throw new UserError("Read Message History is required for a persistent public panel.");
        const message = await channel.send(payload);
        store.updateSettings(guildId, {
            panel_channel_id: channel.id,
            panel_message_id: message.id,
        });
        return message.url;
    }
    async refreshAfterChange(guildId) {
        try {
            await this.refresh(guildId);
        }
        catch (error) {
            log("warn", "Public panel refresh failed", {
                guild: guildId,
                code: errorCode(error),
            });
            return "Settings saved, but the public schedule could not be updated. Check permissions and run /boss publish.";
        }
        return "";
    }
}
//# sourceMappingURL=publicPanel.js.map