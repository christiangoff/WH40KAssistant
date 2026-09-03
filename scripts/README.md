# Backups

`backup-db.mjs` writes a consistent snapshot of `data/warhammer.db` plus a
tarball of `data/uploads/` to an external drive, and prunes anything older than
`BACKUP_RETAIN_DAYS` (default 30). It uses SQLite's online-backup API, so it is
safe to run while the app is live. It refuses to run unless a `.backup-drive`
marker file is present at the root of the backup drive — so an unplugged USB
drive can never cause snapshots to pile up on the SD card.

## One-time setup on the Pi

1. **Plug in the USB drive.** Find it:

   ```bash
   lsblk -f
   ```

   Say it's `/dev/sda1`.

2. **Format it ext4** (skips if it already has data you want to keep — check
   first, this wipes the partition):

   ```bash
   sudo mkfs.ext4 -L warhammer-backup /dev/sda1
   ```

3. **Mount it at `/mnt/backup` and make that permanent:**

   ```bash
   sudo mkdir -p /mnt/backup
   UUID=$(sudo blkid -s UUID -o value /dev/sda1)
   echo "UUID=$UUID /mnt/backup ext4 defaults,nofail,x-systemd.device-timeout=10 0 2" | sudo tee -a /etc/fstab
   sudo systemctl daemon-reload
   sudo mount /mnt/backup
   ```

   `nofail` means the Pi still boots if the drive is missing.

4. **Give your user ownership and drop the marker file:**

   ```bash
   sudo chown -R christiangoff:christiangoff /mnt/backup
   touch /mnt/backup/.backup-drive
   ```

5. **Install the systemd timer:**

   ```bash
   cd ~/warhammer
   sudo cp scripts/warhammer-backup.service scripts/warhammer-backup.timer /etc/systemd/system/
   sudo systemctl daemon-reload
   sudo systemctl enable --now warhammer-backup.timer
   ```

6. **Run it once now and check the output:**

   ```bash
   sudo systemctl start warhammer-backup.service
   journalctl -u warhammer-backup.service -n 20 --no-pager
   ls -la /mnt/backup/warhammer
   ```

## Everyday commands

```bash
systemctl list-timers warhammer-backup.timer      # when it next runs
journalctl -u warhammer-backup.service --since today
ls -lah /mnt/backup/warhammer                     # the snapshots
```

## Restore

```bash
sudo systemctl stop warhammer
node scripts/restore-db.mjs /mnt/backup/warhammer/warhammer-<stamp>.db.gz
# uploaded files, if you also lost those:
tar xzf /mnt/backup/warhammer/uploads-<stamp>.tar.gz -C ~/warhammer
sudo systemctl start warhammer
```

`restore-db.mjs` moves the current DB aside (`warhammer.db.pre-restore-*`)
before writing, so a bad restore is reversible.

## Off-site copy (recommended)

The USB drive covers SD-card death and a dead Pi, but not fire / theft / a
power surge through the USB bus. Add a second destination — e.g. a weekly
`rclone copy /mnt/backup/warhammer <remote>:warhammer-backups` on its own timer,
or a second drive you swap and keep in another room.
