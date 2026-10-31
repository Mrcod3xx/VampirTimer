import { ChannelType, PermissionFlagsBits, } from "discord.js";
import { UserError } from "./logger.js";
export function requireAdmin(permissions) {
    if (!permissions?.has(PermissionFlagsBits.Administrator))
        throw new UserError("Only server administrators can change tracker settings.");
}
export function validateChannel(channel, guildId, botId) {
    if (!channel ||
        channel.guildId !== guildId ||
        ![ChannelType.GuildText, ChannelType.GuildAnnouncement].includes(channel.type))
        throw new UserError("Select a text or announcement channel in this server.");
    const permissions = channel.permissionsFor(botId);
    if (!permissions?.has([
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.EmbedLinks,
    ]))
        throw new UserError("The bot needs View Channel, Send Messages and Embed Links in that channel.");
    return channel;
}
export async function manageableRole(guild, id, removing = false) {
    const [role, me] = await Promise.all([
        guild.roles.fetch(id),
        guild.members.fetchMe(),
    ]);
    if (!role ||
        role.id === guild.id ||
        role.managed ||
        (!removing && role.permissions.bitfield !== 0n))
        throw new UserError("Use a dedicated, unmanaged opt-in role with no permissions. Never use @everyone or a privileged role.");
    if (!me.permissions.has(PermissionFlagsBits.ManageRoles) ||
        role.comparePositionTo(me.roles.highest) >= 0)
        throw new UserError("The bot needs Manage Roles and its highest role must be above the alert role.");
    if (!removing &&
        !role.mentionable &&
        !me.permissions.has(PermissionFlagsBits.MentionEveryone))
        throw new UserError("Make the alert role mentionable so the bot can notify it.");
    return role;
}
//# sourceMappingURL=permissions.js.map