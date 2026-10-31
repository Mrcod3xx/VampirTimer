import {
  ChannelType,
  Collection,
  PermissionsBitField,
  PermissionFlagsBits,
  type Client,
  type Guild,
  type Role,
} from "discord.js";
import { vi } from "vitest";
export const G = "123456789012345678",
  C = "223456789012345678",
  U = "323456789012345678",
  R = "423456789012345678",
  BOT = "523456789012345678";
export function discordMock() {
  const roleMap = new Collection<string, any>();
  const permissions = new PermissionsBitField([
    PermissionFlagsBits.Administrator,
    PermissionFlagsBits.ManageRoles,
    PermissionFlagsBits.ViewChannel,
    PermissionFlagsBits.SendMessages,
    PermissionFlagsBits.EmbedLinks,
    PermissionFlagsBits.ReadMessageHistory,
  ]);
  const held = new Collection<string, any>();
  const member = {
    roles: {
      cache: held,
      add: vi.fn(async (id: string) => {
        held.set(id, roleMap.get(id));
      }),
      remove: vi.fn(async (id: string) => {
        held.delete(id);
      }),
    },
    permissions,
  };
  const me = { permissions, roles: { highest: { id: BOT } } };
  const addRole = (id = R) => {
    const role = {
      id,
      permissions: new PermissionsBitField(),
      managed: false,
      mentionable: true,
      comparePositionTo: () => -1,
    };
    roleMap.set(id, role);
    return role;
  };
  addRole();
  const messages = new Collection<string, any>();
  let seq = 0;
  const channel: any = {
    id: C,
    guildId: G,
    type: ChannelType.GuildText,
    name: "boss",
    permissionsFor: vi.fn(() => permissions),
    messages: {
      fetch: vi.fn(async (id: string) => {
        if (!messages.has(id)) throw { code: 10008 };
        return messages.get(id);
      }),
    },
    send: vi.fn(async (payload: any) => {
      const id = String(++seq);
      const message = {
        id,
        url: `https://discord.com/channels/${G}/${C}/${id}`,
        edit: vi.fn(async () => {}),
        payload,
      };
      messages.set(id, message);
      return message;
    }),
  };
  const channels = new Collection<string, any>([[C, channel]]);
  const guild: any = {
    id: G,
    channels: {
      fetch: vi.fn(async (id?: string) =>
        id ? (channels.get(id) ?? null) : channels,
      ),
    },
    roles: {
      cache: roleMap,
      fetch: vi.fn(async (id: string) => roleMap.get(id)),
      create: vi.fn(async () => addRole("623456789012345678")),
    },
    members: {
      fetch: vi.fn(async () => member),
      fetchMe: vi.fn(async () => me),
    },
  };
  channel.guild = guild;
  const client = {
    user: { id: BOT },
    isReady: () => true,
    guilds: { cache: new Collection([[G, guild]]) },
    channels: { cache: channels },
  } as unknown as Client;
  return {
    client,
    guild: guild as Guild,
    channel,
    channels,
    messages,
    member,
    me,
    addRole,
    roleMap,
    permissions,
  };
}
