import {
  ChannelType,
  escapeMarkdown,
  MessageFlags,
  PermissionFlagsBits,
  type Guild,
  type Interaction,
  type RepliableInteraction,
} from "discord.js";
import { Store, settingToggles } from "../database/store.js";
import { row, Views, type View } from "../ui/views.js";
import { Notifications } from "../services/notifications.js";
import { Subscriptions } from "../services/subscriptions.js";
import { PublicPanel } from "../services/publicPanel.js";
import { backup } from "../services/backup.js";
import { requireAdmin } from "../utils/permissions.js";
import { formatTime, parseTimes } from "../utils/time.js";
import { errorCode, log, UserError } from "../utils/logger.js";

const adminActions = new Set([
  "admin",
  "add",
  "edit",
  "remove",
  "confirmRemove",
  "toggleBoss",
  "manage",
  "selectBoss",
  "channels",
  "selectChannel",
  "confirmChannel",
  "settings",
  "setting",
  "intervals",
  "saveIntervals",
  "saveBoss",
  "roles",
  "bossRole",
  "selectRole",
  "createRole",
  "test",
  "publish",
  "status",
  "backup",
  "resetPanel",
  "confirmResetPanel",
]);
export class Router {
  readonly subscriptions: Subscriptions;
  readonly publicPanel: PublicPanel;
  constructor(
    readonly store: Store,
    readonly views: Views,
    readonly notifications: Notifications,
  ) {
    this.subscriptions = new Subscriptions(store);
    this.publicPanel = new PublicPanel(notifications, views);
  }
  async handle(i: Interaction) {
    try {
      if (!i.inGuild() || !i.guild) {
        if (i.isRepliable())
          await i.reply({
            content: "Use this bot inside a Discord server.",
            flags: MessageFlags.Ephemeral,
          });
        return;
      }
      if (i.isAutocomplete()) {
        if (
          ["edit", "remove"].includes(i.commandName) &&
          !i.memberPermissions?.has(PermissionFlagsBits.Administrator)
        ) {
          await i.respond([]);
          return;
        }
        const query = String(i.options.getFocused()).toLowerCase();
        await i.respond(
          this.store
            .bosses(i.guildId)
            .filter((b) => b.name.toLowerCase().includes(query))
            .slice(0, 25)
            .map((b) => ({ name: b.name, value: b.id })),
        );
        return;
      }
      if (!i.isRepliable()) return;
      let action: string;
      let arg = "";
      if (i.isChatInputCommand()) {
        const sub = i.options.getSubcommand(false);
        if (["add", "edit", "remove"].includes(i.commandName)) {
          action = i.commandName;
          arg = String(i.options.getInteger("boss") ?? "");
        } else if (i.commandName === "set") {
          action = "confirmChannel";
          arg = i.options.getChannel("channel", true).id;
        } else if (i.commandName === "panel") action = "main";
        else if (i.commandName === "boss") {
          action =
            (
              { setup: "admin", countdown: "next", list: "schedule" } as Record<
                string,
                string
              >
            )[sub!] ?? sub!;
          if (action === "subscribe")
            arg = String(i.options.getInteger("boss") ?? 0);
          if (action === "unsubscribe")
            arg = String(i.options.getInteger("boss") ?? "all");
        } else throw new UserError("Unknown command. Use /boss help.");
      } else if (i.isButton() || i.isAnySelectMenu() || i.isModalSubmit()) {
        ({ action, arg } = this.views.components.decode(
          i.customId,
          i.guildId,
          i.user.id,
        ));
      } else return;
      if (adminActions.has(action)) requireAdmin(i.memberPermissions);
      const g = i.guildId;
      const u = i.user.id;
      if (
        (action === "add" || action === "edit") &&
        (i.isChatInputCommand() || i.isButton())
      ) {
        await i.showModal(
          this.views.bossModal(
            g,
            u,
            action === "edit" ? this.store.boss(g, Number(arg)) : undefined,
          ),
        );
        return;
      }
      if (action === "intervals" && i.isButton()) {
        await i.showModal(this.views.intervalsModal(g, u));
        return;
      }
      // Acknowledge before any Discord fetch, role operation or public-panel edit.
      const update =
        (i.isButton() || i.isAnySelectMenu()) &&
        i.message.flags.has(MessageFlags.Ephemeral);
      if (update && (i.isButton() || i.isAnySelectMenu()))
        await i.deferUpdate();
      else await i.deferReply({ flags: MessageFlags.Ephemeral });
      const respond = async (view: View) => {
        await i.editReply({ ...view, content: "" });
      };
      const success = async (text: string) =>
        respond(
          this.views.view("✅ SAVED", text, [
            this.views.main(g, u).components[0]!,
          ]),
        );
      const changed = async (text: string) => {
        const warning = await this.publicPanel.refreshAfterChange(g);
        await success(text + (warning ? `\n\n${warning}` : ""));
      };
      switch (action) {
        case "main":
          await respond(this.views.main(g, u));
          break;
        case "admin":
          await respond(this.views.admin(g, u));
          break;
        case "help":
          await respond(this.views.help());
          break;
        case "next":
          await respond(this.views.next(g, u));
          break;
        case "schedule":
        case "manage":
        case "choose":
          await respond(this.views.schedule(g, u, Number(arg) || 0, action));
          break;
        case "selectBoss":
        case "selectAlert": {
          if (!i.isStringSelectMenu())
            throw new UserError("Invalid selection.");
          await respond(
            this.views.boss(
              g,
              u,
              Number(i.values[0]),
              action === "selectAlert",
            ),
          );
          break;
        }
        case "saveBoss": {
          if (!i.isModalSubmit()) throw new UserError("Invalid form.");
          const enabled = i.fields
            .getTextInputValue("enabled")
            .trim()
            .toLowerCase();
          if (!["yes", "no"].includes(enabled))
            throw new UserError("Enabled must be yes or no.");
          const isNew = arg === "new";
          const b = this.store.saveBoss(
            g,
            {
              name: i.fields.getTextInputValue("name"),
              description: i.fields.getTextInputValue("description"),
              times: i.fields.getTextInputValue("times"),
              enabled: enabled === "yes",
            },
            isNew ? undefined : Number(arg),
          );
          const warning = await this.publicPanel.refreshAfterChange(g);
          if (isNew) {
            const schedList = b.times.map((t) => `- ${formatTime(t)}`).join("\n");
            const text = `Boss: **${escapeMarkdown(b.name)}**\n\nSchedule:\n${schedList}\n\nFrequency: Daily\nTimezone: Philippine Time (UTC+8)\nStatus: ${b.enabled ? "Active" : "Disabled"}\n\nNo restart required.${warning ? `\n\n⚠️ ${warning}` : ""}`;
            await respond(
              this.views.view("✅ Boss Added Successfully", text, [
                row(
                  this.views.button(g, u, "manage", "View Bosses", "0"),
                  this.views.button(g, u, "add", "Add Another Boss"),
                  this.views.back(g, u, "admin"),
                ),
              ]),
            );
          } else {
            const view = this.views.boss(g, u, b.id);
            if (warning)
              view.embeds[0]!.addFields({ name: "Public panel", value: warning });
            await respond(view);
          }
          break;
        }
        case "remove":
          await respond(this.views.remove(g, u, Number(arg)));
          break;
        case "confirmRemove":
          this.store.removeBoss(g, Number(arg));
          await changed(
            "Boss removed. Its future scheduled alerts are cancelled.",
          );
          break;
        case "toggleBoss": {
          const b = this.store.boss(g, Number(arg));
          this.store.saveBoss(
            g,
            { ...b, times: b.times.join(","), enabled: !b.enabled },
            b.id,
          );
          const warning = await this.publicPanel.refreshAfterChange(g);
          const view = this.views.boss(g, u, b.id);
          if (warning)
            view.embeds[0]!.addFields({ name: "Public panel", value: warning });
          await respond(view);
          break;
        }
        case "channels": {
          const channels = await i.guild.channels.fetch();
          const suggested = channels.find(
            (c) => c?.name === "boss" && c.type === ChannelType.GuildText,
          )?.id;
          await respond(this.views.channels(g, u, suggested));
          break;
        }
        case "selectChannel": {
          if (!i.isChannelSelectMenu())
            throw new UserError("Invalid channel selection.");
          await this.notifications.channel(g, i.values[0]);
          await respond(this.views.confirmChannel(g, u, i.values[0]!));
          break;
        }
        case "confirmChannel": {
          const previous = await this.notifications.setChannel(g, arg);
          const warning = await this.publicPanel.refreshAfterChange(g);
          const text = `Previous Channel: ${previous ? `<#${previous}>` : "None"}\nNew Channel: <#${arg}>\nStatus: Active\nTimezone: Asia/Manila\n\nFuture notifications will use the new channel immediately.${warning ? `\n\n⚠️ ${warning}` : ""}`;
          await respond(
            this.views.view("✅ Notification Channel Updated", text, [
              this.views.main(g, u).components[0]!,
            ]),
          );
          break;
        }
        case "settings":
          await respond(this.views.settings(g, u));
          break;
        case "setting": {
          if (!settingToggles.includes(arg as (typeof settingToggles)[number]))
            throw new UserError("Unknown setting.");
          const key = arg as (typeof settingToggles)[number];
          this.store.updateSettings(g, {
            [key]: this.store.settings(g)[key] ? 0 : 1,
          });
          await respond(this.views.settings(g, u));
          break;
        }
        case "saveIntervals": {
          if (!i.isModalSubmit()) throw new UserError("Invalid form.");
          const text = i.fields.getTextInputValue("minutes").trim();
          const parts = text ? text.split(",").map((s) => s.trim()) : [];
          if (parts.some((s) => !/^\d+$/.test(s)))
            throw new UserError(
              "Use comma-separated whole minutes, such as 30, 10.",
            );
          const minutes = [...new Set(parts.map(Number))].sort((a, b) => b - a);
          const daily = parseTimes(i.fields.getTextInputValue("daily"));
          if (daily.length !== 1)
            throw new UserError("Enter one daily schedule time.");
          this.store.updateSettings(g, {
            reminder_minutes: JSON.stringify(minutes),
            daily_time: daily[0],
          });
          await respond(this.views.settings(g, u));
          break;
        }
        case "roles":
        case "bossRole":
          await respond(
            this.views.roles(g, u, action === "roles" ? 0 : Number(arg)),
          );
          break;
        case "selectRole": {
          if (!i.isRoleSelectMenu())
            throw new UserError("Invalid role selection.");
          await this.subscriptions.configure(
            i.guild,
            Number(arg),
            i.values[0]!,
          );
          await respond(this.views.roles(g, u, Number(arg)));
          break;
        }
        case "createRole": {
          const scope = Number(arg);
          const existing =
            scope === 0
              ? this.store.settings(g).global_alert_role_id
              : this.store.boss(g, scope).role_id;
          if (existing)
            throw new UserError(
              "An alert role is already configured. Select an existing role to change it.",
            );
          const me = await i.guild.members.fetchMe();
          if (!me.permissions.has(PermissionFlagsBits.ManageRoles))
            throw new UserError(
              "The bot needs Manage Roles to create an opt-in role.",
            );
          const role = await i.guild.roles.create({
            name:
              scope === 0
                ? "Boss Alerts"
                : `${this.store.boss(g, scope).name} Alerts`.slice(0, 100),
            permissions: [],
            mentionable: true,
            reason: "Administrator configured boss alerts",
          });
          try {
            await this.subscriptions.configure(i.guild, scope, role.id);
          } catch (error) {
            // Keep the role visible for hierarchy repair instead of secretly creating more on every attempt.
            throw new UserError(
              `Created <@&${role.id}>. Move the bot role above it, then select this role in Role Settings. (${errorCode(error)})`,
            );
          }
          await respond(this.views.roles(g, u, scope));
          break;
        }
        case "alerts": {
          const member = await i.guild.members.fetch({ user: u, force: true });
          await respond(
            this.views.alerts(g, u, new Set(member.roles.cache.keys())),
          );
          break;
        }
        case "subscribe":
        case "unsubscribe": {
          await this.subscriptions.set(
            i.guild,
            u,
            arg === "all" ? null : Number(arg),
            action === "subscribe",
          );
          const member = await i.guild.members.fetch({ user: u, force: true });
          await respond(
            this.views.alerts(g, u, new Set(member.roles.cache.keys())),
          );
          break;
        }
        case "test":
          await this.notifications.test(g);
          await success(
            "Test notification sent without mentions. It was not recorded as a real spawn.",
          );
          break;
        case "resetPanel":
          await respond(this.views.resetPanel(g, u));
          break;
        case "confirmResetPanel":
          this.store.updateSettings(g, {
            panel_channel_id: null,
            panel_message_id: null,
          });
          await success(
            "Saved panel reference cleared. Delete any old public message before running /boss publish.",
          );
          break;
        case "publish": {
          const url = await this.publicPanel.refresh(g, true);
          await success(`Public schedule ready: ${url}`);
          break;
        }
        case "refresh":
          this.store.initGuild(g);
          await this.publicPanel.refresh(g);
          await respond(this.views.schedule(g, u, 0));
          break;
        case "status": {
          const counts = this.store.db
            .prepare(
              "SELECT status,COUNT(*) AS count FROM notification_logs WHERE guild_id=? GROUP BY status",
            )
            .all(g) as { status: string; count: number }[];
          const errors = this.store.db
            .prepare(
              "SELECT status,error_message FROM notification_logs WHERE guild_id=? AND error_message IS NOT NULL ORDER BY scheduled_at DESC LIMIT 5",
            )
            .all(g) as { status: string; error_message: string }[];
          await respond(
            this.views.view(
              "📊 DELIVERY STATUS",
              `${counts.map((c) => `${c.status}: **${c.count}**`).join("\n") || "No events yet."}\n\n**Recent problems**\n${errors.map((e) => `${e.status}: ${e.error_message}`).join("\n") || "None"}\n\nProcess RSS: ${Math.round(process.memoryUsage().rss / 1048576)} MB\nSee DEPLOYMENT.md for backups and recovery.`,
            ),
          );
          break;
        }
        case "backup": {
          const filePath = await backup(this.store);
          await success(
            `**Verified database snapshot created:**\n\`${filePath}\`\n\nTo download, log into the Wispbyte panel, open **Files**, and navigate to \`data/backups/\`. Download the \`.db\` file safely to your computer.\n\n*Note: Backups are never sent to Discord channels to protect server security and avoid file leaks.*`,
          );
          break;
        }
        default:
          throw new UserError(
            "This control is no longer supported. Open /panel again.",
          );
      }
    } catch (error) {
      log("warn", "Interaction failed", { code: errorCode(error) });
      const message =
        error instanceof UserError
          ? error.message
          : `The action could not finish (code: ${errorCode(error)}). Check bot permissions or try again shortly. Your saved settings remain in SQLite.`;
      try {
        if (i.isAutocomplete() && !i.responded) await i.respond([]);
        else if (i.isRepliable()) {
          if (i.deferred || i.replied)
            await i.editReply({
              content: message,
              embeds: [],
              components: [],
              allowedMentions: { parse: [] },
            });
          else
            await i.reply({
              content: message,
              flags: MessageFlags.Ephemeral,
              allowedMentions: { parse: [] },
            });
        }
      } catch {
        log(
          "warn",
          "Interaction expired before an error response could be delivered",
        );
      }
    }
  }
}
