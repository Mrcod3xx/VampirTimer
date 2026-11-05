# Gehenna Boss Tracker — Azure VM & PM2 Deployment Guide

This guide documents the production deployment of **Gehenna Boss Tracker** (running under the project name `VampirTimer`) on a **Microsoft Azure Linux Virtual Machine** using **PM2** process management.

---

## 1. Hosting Architecture

| Parameter | Configuration |
|---|---|
| **Cloud Provider** | Microsoft Azure (Azure for Students) |
| **Virtual Machine** | `discord-bot-vm` |
| **Operating System** | Ubuntu Server 24.04 LTS (x64) |
| **Region** | **Japan East** (`japaneast`) |
| **VM Size** | `Standard_B2ats_v2` (2 vCPUs, 1 GiB RAM) |
| **OS Disk** | 64 GiB Premium SSD (P6 tier) |
| **Process Manager** | PM2 v5+ / systemd (`pm2-azureuser.service`) |
| **Node.js Runtime** | Node.js 24.x LTS (64-bit) |
| **Local App Directory** | `/home/azureuser/apps/VampirTimer` |
| **Database** | Persistent SQLite (`./data/boss-tracker.db`) in WAL mode |

---

## 2. Connecting to the Azure VM

From your Windows machine, open PowerShell and connect using your SSH private key:

```powershell
ssh -i "$env:USERPROFILE\Downloads\discord-bot-key.pem" azureuser@YOUR_AZURE_VM_PUBLIC_IP
```

> [!TIP]
> If you encounter `WARNING: UNPROTECTED PRIVATE KEY FILE!`, restrict Windows file permissions:
> ```powershell
> $key = "$env:USERPROFILE\Downloads\discord-bot-key.pem"
> icacls "$key" /inheritance:r
> icacls "$key" /grant:r "${env:USERNAME}:(R)"
> ```

---

## 3. Server Prerequisites & Tools

The following packages are installed on the Ubuntu VM:

```bash
# System updates & tools
sudo apt update && sudo apt upgrade -y
sudo apt install -y curl git ca-certificates build-essential

# Node.js 24 LTS via NodeSource
curl -fsSL https://deb.nodesource.com/setup_24.x -o nodesource_setup.sh
sudo -E bash nodesource_setup.sh
sudo apt install -y nodejs

# PM2 process supervisor
sudo npm install -g pm2
```

---

## 4. Environment Variables (`.env`)

Secrets must remain on the VM and never be committed to Git. In `/home/azureuser/apps/VampirTimer/.env`:

```env
DISCORD_TOKEN=your_private_bot_token_here
DISCORD_CLIENT_ID=your_discord_application_id_here
DATABASE_PATH=./data/boss-tracker.db
TZ=Asia/Manila
LOG_LEVEL=info
LATENESS_SECONDS=120
HISTORY_DAYS=30
```

Secure the `.env` file and create the data directory:

```bash
chmod 600 .env
mkdir -p data
```

---

## 5. Deployment & Update Workflow

Because the application code is maintained on GitHub, use this standard procedure to deploy updates to the Azure VM:

```bash
# 1. Navigate to the app directory
cd ~/apps/VampirTimer

# 2. Pull latest code from GitHub
git pull --ff-only

# 3. Install dependencies and compile TypeScript
npm ci
npm run build

# 4. (Optional) Sync slash commands if command definitions changed
npm run register

# 5. Restart the bot under PM2 with updated environment
pm2 restart VampirTimer --update-env

# 6. Check live status and recent logs
pm2 status
pm2 logs VampirTimer --lines 30

# 7. Save PM2 state for automatic reboot recovery
pm2 save
```

---

## 6. PM2 Process Management & Auto-Reboot

PM2 ensures the bot automatically restarts if it crashes or if the Azure VM is rebooted.

### Useful Commands

| Command | Action |
|---|---|
| `pm2 status` | View running status, CPU, memory, uptime, and restart count |
| `pm2 logs VampirTimer --lines 30` | View latest 30 lines of error and output logs |
| `pm2 monit` | Real-time terminal dashboard for CPU and memory usage |
| `pm2 restart VampirTimer --update-env` | Gracefully restart the bot and reload environment variables |
| `pm2 stop VampirTimer` | Stop the bot |
| `pm2 save` | Persist the active process list to `~/.pm2/dump.pm2` |
| `systemctl is-enabled pm2-azureuser` | Confirm systemd service is active (`enabled`) |

### Auto-Start on System Boot
The systemd service was registered via:
```bash
pm2 startup
# Followed by running the generated sudo command:
sudo env PATH=$PATH:/usr/bin /usr/lib/node_modules/pm2/bin/pm2 startup systemd -u azureuser --hp /home/azureuser
pm2 save
```

---

## 7. Database Backups & Off-Host Storage

### Creating a Snapshot
Admins can trigger an instant backup either:
1. In Discord via `/boss backup` or `/panel` ➔ ⚙️ **More** ➔ **Backup Database**.
2. Or on the VM via command line:
   ```bash
   cd ~/apps/VampirTimer
   node dist/maintenance.js backup
   ```

Backups are saved to `data/backups/boss-tracker.<timestamp>.db`.

### Downloading Backups to Your Computer
Backups are **never sent over Discord** for security. To download a snapshot to your Windows PC, run this command in **PowerShell on your Windows computer**:

```powershell
scp -i "$env:USERPROFILE\Downloads\discord-bot-key.pem" "azureuser@YOUR_VM_IP:/home/azureuser/apps/VampirTimer/data/backups/YOUR_BACKUP_FILENAME.db" "$env:USERPROFILE\Downloads\"
```

---

## 8. Discord Bot Configuration Checklist

1. **Intents:** Only standard non-privileged intents are required. **Message Content**, **Presence**, and **Server Members** intents remain **disabled** in the Discord Developer Portal.
2. **Bot Permissions:** In your Discord server, the bot requires:
   - View Channels
   - Send Messages
   - Embed Links
   - Read Message History
   - Manage Roles (only if using opt-in alert roles)
3. **Role Hierarchy:** If using alert roles, place the bot's highest role **above** all boss alert roles in Discord Server Settings ➔ Roles.
4. **Timezone:** All boss schedules and reminders follow **Philippine Time (UTC+8 / Asia/Manila)**. Dynamic timestamps `<t:timestamp:t>` adapt to each user's local device timezone.
