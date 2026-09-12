# WiFi power management (fixes most "Pi drops off the network" hangs)

The Pi's onboard WiFi chip going into power-save and never waking back up is
the single most common cause of a Pi becoming fully unreachable until a hard
power cycle. Disable it.

**Do it now** (effective immediately, doesn't survive a reboot on its own):

```bash
sudo iw dev wlan0 set power_save off
iw dev wlan0 get power_save     # confirm: "Power save: off"
```

**Make it permanent:**

```bash
cd ~/warhammer && git pull
chmod +x scripts/wifi-powersave-off.sh
sudo cp scripts/wifi-powersave-off.service scripts/wifi-powersave-off.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now wifi-powersave-off.timer
journalctl -t wifi-powersave-off -n 5 --no-pager    # confirm it ran
```

The timer re-applies it every 5 minutes (some setups quietly turn it back on
after a reconnect), so this survives reboots and reconnections both.

If it's still happening after this, the next real step is a wired Ethernet
connection — it removes the WiFi chip from the picture entirely and is the
only way to be certain for a box meant to run unattended 24/7.

# Pi health logging (diagnosing hangs)

If the Pi goes fully unreachable (drops off the network, needs a hard power
cycle) there's normally zero evidence — the in-memory journal dies with it.
`pi-health.sh` logs a one-line vitals snapshot (under-voltage/throttle state,
temp, memory, swap, load, disk) every minute via `pi-health.timer`, and making
the journal persistent means it survives the hard reboot. Together, the next
hang leaves a trail ending right at the freeze.

## One-time setup

1. **Make the journal persist to disk** (default on most Pi OS images is
   RAM-only, i.e. wiped on every reboot — including a forced one):

   ```bash
   sudo mkdir -p /var/log/journal
   sudo systemctl restart systemd-journald
   ```

2. **Install the health-check timer:**

   ```bash
   cd ~/warhammer
   chmod +x scripts/pi-health.sh
   sudo cp scripts/pi-health.service scripts/pi-health.timer /etc/systemd/system/
   sudo systemctl daemon-reload
   sudo systemctl enable --now pi-health.timer
   ```

3. **Check it's logging:**

   ```bash
   sudo systemctl start pi-health.service
   journalctl -t pi-health -n 5 --no-pager
   ```

   You want a line like `throttled=0x0 temp=52.1'C mem=310/1837MB swap=0/1024MB load=0.12 0.08 0.03 root=41%`.

## After the next hang

Power-cycle as usual, then once it's back up:

```bash
journalctl -t pi-health -b -1 -n 30 --no-pager   # the minute-by-minute lead-up to the freeze, previous boot
journalctl -b -1 -n 300 --no-pager               # everything else the system logged right before it died
```

What to look for:
- **`throttled` gains bit `0x50000`/similar** in the last entries → under-voltage — power supply/cable.
- **`temp` climbing toward 80-85°C** → thermal throttling/shutdown — needs cooling.
- **`mem`/`swap` maxed out just before the gap** → OOM/thrashing — something (a build, an admin "sync all"/"refresh all stats" job, the backup) is too heavy for the Pi's RAM.
- **Log just stops with nothing unusual, no kernel messages at all** → points at a network-layer hang (WiFi driver, in particular) rather than the whole OS — worth switching to Ethernet or checking `iwconfig wlan0` power management if on WiFi.
- **`root` disk usage near 100%** → full SD card, which can wedge all kinds of things.

Paste the output here and it'll usually be obvious which one it is.

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

5. **Make `node` reachable from systemd.** The app runs under nvm, whose node
   lives at `~/.nvm/versions/node/<ver>/bin/node` — not on systemd's PATH, and
   the version changes. Create a stable symlink the unit can rely on:

   ```bash
   sudo ln -sf "$(readlink -f "$(which node)")" /usr/local/bin/node
   ```

   Re-run that one line after any `nvm install` that changes your node version.

6. **Install the systemd timer:**

   ```bash
   cd ~/warhammer
   sudo cp scripts/warhammer-backup.service scripts/warhammer-backup.timer /etc/systemd/system/
   sudo systemctl daemon-reload
   sudo systemctl enable --now warhammer-backup.timer
   ```

7. **Run it once now and check the output:**

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
