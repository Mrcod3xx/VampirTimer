import {
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  PermissionFlagsBits,
} from "discord.js";
import { Notifications, scheduleText } from "./notifications.js";
import { row, type Views } from "../ui/views.js";
import { zoneLabel } from "../utils/time.js";
import { errorCode, log, UserError } from "../utils/logger.js";
export class PublicPanel {
  private locks = new Map<string, Promise<unknown>>();
  constructor(
    readonly notifications: Notifications,
    readonly views: Views,
  ) {}
  async refresh(guildId: string, publish = false): Promise<string> {
    const prior = this.locks.get(guildId) ?? Promise.resolve();
    const task = prior.catch(() => {}).then(() => this.write(guildId, publish));
    this.locks.set(guildId, task);
    try {
      return await task;
    } finally {
      if (this.locks.get(guildId) === task) this.locks.delete(guildId);
    }
  }
  private async write(guildId: string, publish: boolean) {
    const store = this.notifications.store;
    const s = store.settings(guildId);
    if (!s.panel_message_id && !publish) return "";
    const payload = {
      embeds: [
        new EmbedBuilder()
          .setTitle("👹 GEHENNA BOSS TRACKER")
          .setDescription(
            `**Daily Spawn Schedule**\n\n${scheduleText(store, guildId)}`,
          )
          .setColor(0x5865f2)
          .setFooter({ text: zoneLabel }),
      ],
      components: [
        row(
          ...(["next", "schedule", "alerts", "refresh"] as const).map((a, i) =>
            new ButtonBuilder()
              .setCustomId(
                this.views.components.id(
                  guildId,
                  "0",
                  a,
                  a === "schedule" ? "0" : "",
                  true,
                ),
              )
              .setLabel(
                ["Next Boss", "Full Schedule", "My Alerts", "Refresh"][i]!,
              )
              .setStyle(ButtonStyle.Secondary),
          ),
        ),
      ],
      allowedMentions: { parse: [] as [] },
    };
    if (s.panel_message_id && s.panel_channel_id) {
      try {
        const oldChannel = await this.notifications.channel(
          guildId,
          s.panel_channel_id,
        );
        if (
          !oldChannel
            .permissionsFor(this.notifications.client.user!.id)
            ?.has(PermissionFlagsBits.ReadMessageHistory)
        )
          throw new UserError(
            "Read Message History is required to update the public panel.",
          );
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
        if (!publish) return "";
      } catch (error) {
        if (!["10008", "10003"].includes(errorCode(error))) throw error;
        store.updateSettings(guildId, {
          panel_message_id: null,
          panel_channel_id: null,
        });
        if (!publish) return "";
      }
    }
    const channel = await this.notifications.channel(guildId);
    if (
      !channel
        .permissionsFor(this.notifications.client.user!.id)
        ?.has(PermissionFlagsBits.ReadMessageHistory)
    )
      throw new UserError(
        "Read Message History is required for a persistent public panel.",
      );
    const message = await channel.send(payload);
    store.updateSettings(guildId, {
      panel_channel_id: channel.id,
      panel_message_id: message.id,
    });
    return message.url;
  }
  async refreshAfterChange(guildId: string) {
    try {
      await this.refresh(guildId);
    } catch (error) {
      log("warn", "Public panel refresh failed", {
        guild: guildId,
        code: errorCode(error),
      });
      return "Settings saved, but the public schedule could not be updated. Check permissions and run /boss publish.";
    }
    return "";
  }
}
