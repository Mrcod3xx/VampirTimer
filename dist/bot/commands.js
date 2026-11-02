import { ChannelType, InteractionContextType, PermissionFlagsBits, SlashCommandBuilder, } from "discord.js";
const base = (name, description) => new SlashCommandBuilder()
    .setName(name)
    .setDescription(description)
    .setContexts(InteractionContextType.Guild);
export const commands = [
    ...["add", "edit", "remove"].map((action) => {
        const command = base(action, `${action} a boss`).setDefaultMemberPermissions(PermissionFlagsBits.Administrator);
        command.addSubcommand((sub) => {
            sub.setName("boss").setDescription(`${action} a daily boss`);
            if (action !== "add")
                sub.addIntegerOption((o) => o
                    .setName("boss")
                    .setDescription("Select a boss")
                    .setRequired(true)
                    .setAutocomplete(true));
            return sub;
        });
        return command;
    }),
    base("set", "Configure the tracker")
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addSubcommand((s) => s
        .setName("channel")
        .setDescription("Set the notification channel")
        .addChannelOption((o) => o
        .setName("channel")
        .setDescription("Existing text channel")
        .setRequired(true)
        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement))),
    base("panel", "Open the boss tracker"),
    base("boss", "Boss schedules and alerts")
        .addSubcommand((s) => s.setName("next").setDescription("See the next spawn"))
        .addSubcommand((s) => s.setName("schedule").setDescription("View the complete daily schedule"))
        .addSubcommand((s) => s.setName("countdown").setDescription("Countdown to the next spawn"))
        .addSubcommand((s) => s.setName("list").setDescription("List all bosses"))
        .addSubcommand((s) => s.setName("alerts").setDescription("Manage your opt-in alerts"))
        .addSubcommand((s) => s
        .setName("subscribe")
        .setDescription("Subscribe to all bosses or one configured boss")
        .addIntegerOption((o) => o
        .setName("boss")
        .setDescription("Omit for all bosses")
        .setAutocomplete(true)))
        .addSubcommand((s) => s
        .setName("unsubscribe")
        .setDescription("Remove all your alerts or one boss subscription")
        .addIntegerOption((o) => o
        .setName("boss")
        .setDescription("Omit to disable all alerts")
        .setAutocomplete(true)))
        .addSubcommand((s) => s.setName("setup").setDescription("Administrator settings"))
        .addSubcommand((s) => s.setName("test").setDescription("Admin: send a test without pings"))
        .addSubcommand((s) => s
        .setName("publish")
        .setDescription("Admin: publish or refresh the public schedule"))
        .addSubcommand((s) => s
        .setName("status")
        .setDescription("Admin: inspect recent delivery status"))
        .addSubcommand((s) => s
        .setName("backup")
        .setDescription("Admin: create a verified database snapshot"))
        .addSubcommand((s) => s
        .setName("audit")
        .setDescription("Admin: inspect audit logs of tracker changes")
        .addStringOption((o) => o
        .setName("filter")
        .setDescription("Category filter")
        .setRequired(false)
        .addChoices({ name: "All Changes", value: "all" }, { name: "Boss Changes", value: "boss" }, { name: "Channel Changes", value: "channel" }, { name: "Settings & Roles", value: "settings" })))
        .addSubcommand((s) => s
        .setName("defeated")
        .setDescription("Report a boss as defeated (interval respawn)")
        .addIntegerOption((o) => o
        .setName("boss")
        .setDescription("Select defeated boss")
        .setRequired(true)
        .setAutocomplete(true)))
        .addSubcommand((s) => s.setName("help").setDescription("Command guide")),
];
//# sourceMappingURL=commands.js.map