import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { UserError } from "../utils/logger.js";
export class Components {
    now;
    secret;
    constructor(store, now = Date.now) {
        this.now = now;
        store.db
            .prepare("INSERT OR IGNORE INTO metadata(key,value) VALUES (?,?)")
            .run("component_secret", randomBytes(32).toString("hex"));
        this.secret = store.db
            .prepare("SELECT value FROM metadata WHERE key='component_secret'")
            .get().value;
    }
    mac(guild, data) {
        return createHmac("sha256", this.secret)
            .update(`${guild}|${data}`)
            .digest("base64url")
            .slice(0, 12);
    }
    id(guild, owner, action, arg = "", permanent = false) {
        const body = `bt|${action}|${arg}|${owner}|${permanent ? "0" : Math.floor(this.now() / 1000 + 900).toString(36)}`;
        const result = `${body}|${this.mac(guild, body)}`;
        if (result.length > 100)
            throw new Error("Component ID exceeds Discord limit");
        return result;
    }
    decode(id, guild, user) {
        const parts = id.split("|");
        if (parts.length !== 6 || parts[0] !== "bt")
            throw new UserError("Unknown control. Open /panel again.");
        const [prefix, action, arg, owner, expires, signature] = parts;
        const expected = this.mac(guild, [prefix, action, arg, owner, expires].join("|"));
        if (signature.length !== expected.length ||
            !timingSafeEqual(Buffer.from(signature), Buffer.from(expected)))
            throw new UserError("Invalid control. Open /panel again.");
        if (owner !== "0" && owner !== user)
            throw new UserError("This private panel belongs to someone else. Open /panel.");
        if (expires !== "0" && parseInt(expires, 36) < this.now() / 1000)
            throw new UserError("This panel expired. Open /panel again.");
        if (owner === "0" &&
            !["next", "schedule", "alerts", "refresh", "defeated"].includes(action))
            throw new UserError("Invalid public control.");
        return { action, arg };
    }
}
//# sourceMappingURL=components.js.map