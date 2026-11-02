const migrations = [
    String.raw `
CREATE TABLE guild_settings (
 guild_id TEXT PRIMARY KEY, notification_channel_id TEXT, global_alert_role_id TEXT,
 notifications_enabled INTEGER NOT NULL DEFAULT 1, reminder_30_enabled INTEGER NOT NULL DEFAULT 1,
 reminder_10_enabled INTEGER NOT NULL DEFAULT 1, spawn_notification_enabled INTEGER NOT NULL DEFAULT 1,
 combine_notifications INTEGER NOT NULL DEFAULT 1, role_mentions_enabled INTEGER NOT NULL DEFAULT 1,
 reminder_minutes TEXT NOT NULL DEFAULT '[30,10]', daily_enabled INTEGER NOT NULL DEFAULT 1,
 daily_time TEXT NOT NULL DEFAULT '08:00', defaults_initialized INTEGER NOT NULL DEFAULT 0,
 panel_channel_id TEXT, panel_message_id TEXT, last_reconciled INTEGER,
 created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE TABLE bosses (
 id INTEGER PRIMARY KEY AUTOINCREMENT, guild_id TEXT NOT NULL REFERENCES guild_settings(guild_id),
 name TEXT NOT NULL, name_key TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
 enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)),
 created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
 UNIQUE(guild_id,name_key), UNIQUE(guild_id,id)
);
CREATE TABLE boss_spawn_times (
 boss_id INTEGER NOT NULL REFERENCES bosses(id) ON DELETE CASCADE,
 spawn_time TEXT NOT NULL CHECK(length(spawn_time)=5), timezone TEXT NOT NULL DEFAULT 'Asia/Manila',
 PRIMARY KEY(boss_id,spawn_time)
);
CREATE TABLE boss_alert_roles (
 guild_id TEXT NOT NULL, boss_id INTEGER NOT NULL, role_id TEXT NOT NULL,
 PRIMARY KEY(guild_id,boss_id), UNIQUE(guild_id,role_id),
 FOREIGN KEY(guild_id,boss_id) REFERENCES bosses(guild_id,id) ON DELETE CASCADE
);
CREATE TABLE member_subscriptions (
 guild_id TEXT NOT NULL REFERENCES guild_settings(guild_id), user_id TEXT NOT NULL,
 scope INTEGER NOT NULL, role_id TEXT NOT NULL, created_at INTEGER NOT NULL,
 PRIMARY KEY(guild_id,user_id,scope)
);
CREATE TABLE notification_logs (
 event_key TEXT PRIMARY KEY, guild_id TEXT NOT NULL REFERENCES guild_settings(guild_id),
 boss_id INTEGER NOT NULL, spawn_at INTEGER NOT NULL, minutes INTEGER NOT NULL,
 scheduled_at INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'pending'
 CHECK(status IN ('pending','sending','sent','missed','cancelled','uncertain')),
 attempts INTEGER NOT NULL DEFAULT 0, retry_at INTEGER NOT NULL DEFAULT 0,
 channel_id TEXT, message_id TEXT, sent_at INTEGER, error_message TEXT
);
CREATE INDEX due_events ON notification_logs(status,scheduled_at,retry_at);
CREATE INDEX guild_events ON notification_logs(guild_id,spawn_at);
CREATE INDEX boss_guild ON bosses(guild_id,id);
CREATE INDEX subscription_role ON member_subscriptions(guild_id,role_id);
CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
`,
    String.raw `
ALTER TABLE bosses ADD COLUMN schedule_type TEXT NOT NULL DEFAULT 'daily' CHECK(schedule_type IN ('daily','weekly','event','interval'));
ALTER TABLE bosses ADD COLUMN timezone TEXT NOT NULL DEFAULT 'Asia/Manila';
ALTER TABLE bosses ADD COLUMN recurrence_days TEXT;
ALTER TABLE bosses ADD COLUMN event_date TEXT;
ALTER TABLE bosses ADD COLUMN respawn_interval_minutes INTEGER;
ALTER TABLE bosses ADD COLUMN respawn_trigger_type TEXT DEFAULT 'defeat';

CREATE TABLE audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id TEXT NOT NULL REFERENCES guild_settings(guild_id),
  user_id TEXT NOT NULL,
  action_type TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT,
  previous_value TEXT,
  new_value TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX audit_guild_time ON audit_logs(guild_id, created_at DESC);
CREATE INDEX audit_action ON audit_logs(guild_id, action_type);

CREATE TABLE boss_kill_reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id TEXT NOT NULL REFERENCES guild_settings(guild_id),
  boss_id INTEGER NOT NULL REFERENCES bosses(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  report_type TEXT NOT NULL CHECK(report_type IN ('defeat', 'alive', 'correction')),
  reported_at INTEGER NOT NULL,
  submitted_at INTEGER NOT NULL,
  notes TEXT
);
CREATE INDEX kill_reports_boss ON boss_kill_reports(guild_id, boss_id, reported_at DESC);

ALTER TABLE guild_settings ADD COLUMN interval_respawn_tracking_enabled INTEGER NOT NULL DEFAULT 0;
`,
];
export function migrate(db) {
    db.exec("CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL)");
    const current = db
        .prepare("SELECT COALESCE(MAX(version),0) AS version FROM schema_migrations")
        .get().version;
    if (current > migrations.length)
        throw new Error("Database was created by a newer bot version. Restore matching application code.");
    migrations.forEach((sql, index) => {
        if (index < current)
            return;
        db.transaction(() => {
            db.exec(sql);
            db.prepare("INSERT INTO schema_migrations VALUES (?,?)").run(index + 1, Date.now());
        })();
    });
}
//# sourceMappingURL=migrations.js.map