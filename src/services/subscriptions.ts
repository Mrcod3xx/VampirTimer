import type { Guild } from "discord.js";
import type { Store } from "../database/store.js";
import { manageableRole } from "../utils/permissions.js";
import { UserError } from "../utils/logger.js";
export interface Subscription {
  scope: number;
  role_id: string;
}
export class Subscriptions {
  private locks = new Map<string, Promise<unknown>>();
  constructor(readonly store: Store) {}
  receipts(guild: string, user: string) {
    return this.store.db
      .prepare(
        "SELECT scope,role_id FROM member_subscriptions WHERE guild_id=? AND user_id=?",
      )
      .all(guild, user) as Subscription[];
  }
  async serialized<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const previous = this.locks.get(key) ?? Promise.resolve();
    const task = previous.catch(() => {}).then(fn);
    this.locks.set(key, task);
    try {
      return await task;
    } finally {
      if (this.locks.get(key) === task) this.locks.delete(key);
    }
  }
  async configure(guild: Guild, scope: number, roleId: string) {
    return this.serialized(guild.id, async () => {
      await manageableRole(guild, roleId);
      const s = this.store.settings(guild.id);
      const existing =
        scope === 0
          ? s.global_alert_role_id
          : this.store.boss(guild.id, scope).role_id;
      const inUse = this.store.db
        .prepare(
          "SELECT 1 FROM member_subscriptions WHERE guild_id=? AND scope=? LIMIT 1",
        )
        .get(guild.id, scope);
      if (existing !== roleId && inUse)
        throw new UserError(
          "Members still subscribe to the existing role. Ask them to disable alerts before replacing it.",
        );
      if (
        (scope !== 0 && s.global_alert_role_id === roleId) ||
        this.store
          .bosses(guild.id)
          .some((b) => b.id !== scope && b.role_id === roleId)
      )
        throw new UserError(
          "Each subscription scope must use a different role.",
        );
      if (scope === 0)
        this.store.updateSettings(guild.id, { global_alert_role_id: roleId });
      else
        this.store.db
          .prepare(
            "INSERT INTO boss_alert_roles(guild_id,boss_id,role_id) VALUES (?,?,?) ON CONFLICT(guild_id,boss_id) DO UPDATE SET role_id=excluded.role_id",
          )
          .run(guild.id, scope, roleId);
    });
  }
  async set(
    guild: Guild,
    user: string,
    scope: number | null,
    enabled: boolean,
  ) {
    return this.serialized(guild.id, async () => {
      const member = await guild.members.fetch({ user, force: true });
      const s = this.store.settings(guild.id);
      const receipts = this.receipts(guild.id, user);
      const current = new Map<number, string>();
      if (s.global_alert_role_id) current.set(0, s.global_alert_role_id);
      for (const b of this.store.bosses(guild.id))
        if (b.role_id) current.set(b.id, b.role_id);
      for (const receipt of receipts)
        if (!current.has(receipt.scope))
          current.set(receipt.scope, receipt.role_id);
      const target = scope === null ? null : current.get(scope);
      if (enabled && !target)
        throw new UserError(
          "An administrator must configure an alert role for this selection first.",
        );
      if (enabled) await manageableRole(guild, target!);
      // All-boss and individual subscriptions are mutually exclusive.
      const removals = [...current].filter(([id]) =>
        !enabled
          ? scope === null || id === scope
          : scope === 0
            ? id !== 0
            : id === 0,
      );
      for (const [id, roleId] of removals) {
        if (member.roles.cache.has(roleId)) {
          await manageableRole(guild, roleId, true);
          await member.roles.remove(roleId, "Member opted out of boss alerts");
        }
        this.store.db
          .prepare(
            "DELETE FROM member_subscriptions WHERE guild_id=? AND user_id=? AND scope=?",
          )
          .run(guild.id, user, id);
      }
      if (enabled) {
        await member.roles.add(target!, "Member opted into boss alerts");
        this.store.db
          .prepare(
            "INSERT INTO member_subscriptions(guild_id,user_id,scope,role_id,created_at) VALUES (?,?,?,?,?) ON CONFLICT(guild_id,user_id,scope) DO UPDATE SET role_id=excluded.role_id",
          )
          .run(guild.id, user, scope, target, Date.now());
      }
    });
  }
}
