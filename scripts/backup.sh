#!/bin/bash

# ==============================================================================
# DataSupportTool Automated Backup Script
# ==============================================================================
# This script performs the following:
# 1. Dumps the PostgreSQL database running in the 'dst-postgres' docker container
# 2. Archives the 'backend/data' directory (audio files, processed data)
# 3. Keeps only the 3 most recent backups locally (deletes the rest)
# 4. Syncs the backups to Google Drive via rclone
# ==============================================================================

# Script configurations
PROJECT_ROOT="/home/tarcbda/DataSupportTool"
BACKUP_DIR="${PROJECT_ROOT}/backups"
DATA_DIR="${PROJECT_ROOT}/data"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
MAX_BACKUPS=3
RCLONE_REMOTE="gdrive:dst_backups" # Ensure you've set up rclone config named 'gdrive'

# Docker DB configurations (from docker-compose.yml)
DB_CONTAINER="dst-postgres"
DB_USER="postgres"
DB_NAME="data_pipeline"

# Ensure backup directory exists
mkdir -p "$BACKUP_DIR"

echo "========================================"
echo "Starting Backup at $(date)"
echo "========================================"

# 1. PostgreSQL Database Backup
echo "[1/4] Backing up PostgreSQL Database..."
DB_BACKUP_FILE="${BACKUP_DIR}/db_backup_${TIMESTAMP}.sql"
# Execute pg_dump inside the docker container to avoid local postgres client dependency
if docker exec "$DB_CONTAINER" pg_dump -U "$DB_USER" -d "$DB_NAME" > "$DB_BACKUP_FILE"; then
    echo " > DB backup successful: $(basename "$DB_BACKUP_FILE")"
else
    echo " > ERROR: Failed to backup database!"
    exit 1
fi

# 2. Files Directory Backup
echo "[2/4] Backing up Data Directory (audio, processed files)..."
DATA_BACKUP_FILE="${BACKUP_DIR}/data_backup_${TIMESTAMP}.tar.gz"
# we compress the data directory using tar.gz
if tar -czf "$DATA_BACKUP_FILE" -C "${PROJECT_ROOT}" data; then
    echo " > Data directory backup successful: $(basename "$DATA_BACKUP_FILE")"
else
    echo " > ERROR: Failed to compress data directory!"
    exit 1
fi

# 3. Rotate Old Local Backups (Keep latest exactly $MAX_BACKUPS)
echo "[3/4] Cleaning up old local backups (Keeping last $MAX_BACKUPS)..."

# Delete DB backups
ls -t "${BACKUP_DIR}"/db_backup_*.sql 2>/dev/null | tail -n +$((MAX_BACKUPS + 1)) | xargs -r rm
echo " > Old database backups removed."

# Delete Data backups
ls -t "${BACKUP_DIR}"/data_backup_*.tar.gz 2>/dev/null | tail -n +$((MAX_BACKUPS + 1)) | xargs -r rm
echo " > Old data backups removed."

# 4. Sync to Google Drive
echo "[4/4] Syncing backups to Google Drive using rclone..."
# Check if rclone is installed
if ! command -v rclone &> /dev/null; then
    echo " > ERROR: rclone is not installed! Cannot sync to Google Drive."
    echo " > Install it via: sudo -v ; curl https://rclone.org/install.sh | sudo bash"
else
    # We use 'sync' rather than 'copy' so that deletions (older than 3 days) also mirror to GDrive
    if rclone sync "$BACKUP_DIR" "$RCLONE_REMOTE" -v; then
         echo " > Successfully synced backups to Google Drive!"
    else
         echo " > ERROR: rclone sync failed! Ensure you ran 'rclone config' to setup the 'gdrive' remote."
    fi
fi

echo "========================================"
echo "Backup Completed at $(date)"
echo "========================================"
