import { Client, GatewayIntentBits, Options } from "discord.js";
export function createClient() {
    return new Client({
        intents: [GatewayIntentBits.Guilds],
        makeCache: Options.cacheWithLimits({
            ...Options.DefaultMakeCacheSettings,
            MessageManager: 0,
            PresenceManager: 0,
            GuildMemberManager: {
                maxSize: 1,
                keepOverLimit: (member) => member.id === member.client.user?.id,
            },
            ReactionManager: 0,
            ReactionUserManager: 0,
            VoiceStateManager: 0,
            GuildScheduledEventManager: 0,
        }),
        rest: { retries: 0, timeout: 15_000, rejectOnRateLimit: () => true },
        allowedMentions: { parse: [], repliedUser: false },
    });
}
//# sourceMappingURL=client.js.map