# DataSupportTool Automated Backup Guide

This document outlines the architecture, setup instructions, and restore process for the automated database and file backup system.

## 1. Overview
The backup system relies on a bash script (`scripts/backup.sh`) that performs the following:
1. **Database Export:** Uses `pg_dump` via Docker to dump the PostgreSQL database instance.
2. **File Archive:** Uses `tar` to compress the `data` directory (which contains uploaded audio, etc).
3. **Rotation:** Cleans up old local archives, maintaining exactly the 3 most recent backups.
4. **Cloud Sync:** Uses `rclone` to sync the local `backups` directory accurately onto a connected Google Drive.

## 2. Prerequisites & Assumptions
To run this in a new environment, make sure:
- The project is cloned to the appropriate `PROJECT_ROOT` path, and you've adjusted the path at the top of `scripts/backup.sh` if it's not `/home/tarcbda/DataSupportTool`.
- **Docker** and **Docker Compose** are installed and running the `dst-postgres` container.
- **Rclone** is installed on the host machine.

### Installing Rclone
If Rclone is not installed on the new environment, install it via:
```bash
sudo -v ; curl https://rclone.org/install.sh | sudo bash
```

## 3. Configuring Google Drive Sync (rclone)
Connecting an automated script to Google Drive requires a one-time OAuth authentication.
1. Run `rclone config`.
2. Press `n` to create a **New remote**.
3. Name it **`gdrive`**. (Important: The script specifically points to `gdrive:dst_backups`).
4. For Storage type, select `drive` (Google Drive).
5. Press Enter to leave `client_id` and `client_secret` blank.
6. For scope, choose `1` (Full access).
7. Press Enter for `service_account_file`.
8. When asked to "Edit advanced config", type `n`.
9. When asked to "Use auto config", type `y` if on a desktop, or `n` if you are on a headless server. (If you type `n`, you will have to run a command on your local PC browser to retrieve the token).
10. Confirm it's not a Team Drive (`n`), then accept and quit (`q`).

## 4. Setting Up Automated Scheduling (Cron)
To configure the script to run automatically (e.g., every 2 days at 2:00 AM):

1. Check that the script is executable:
   ```bash
   chmod +x /path/to/DataSupportTool/scripts/backup.sh
   ```
2. Open the cron editor:
   ```bash
   crontab -e
   ```
3. Add the following schedule at the bottom:
   ```bash
   0 2 */2 * * /path/to/DataSupportTool/scripts/backup.sh
   ```

## 5. How to Restore from a Backup

If you move to a new environment or experience data loss, you can easily restore your data by fetching the latest files from Google Drive (`rclone copy gdrive:dst_backups ./backups`).

### Restoring the Database
You can restore the `.sql` dump directly into the active Postgres container:
```bash
cat backups/db_backup_TIMESTAMP.sql | docker exec -i dst-postgres psql -U postgres -d data_pipeline
```
*(Make sure the container is actually running before executing this).*

### Restoring the Files
To restore the `data` directory:
```bash
# Navigate to project root
cd /path/to/DataSupportTool

# Extract the tar archive directly
tar -xzf backups/data_backup_TIMESTAMP.tar.gz
```
This will recreate the `data` folder exactly as it was when the backup ran.
