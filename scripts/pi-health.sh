#!/bin/bash
# Flight recorder: logs a one-line health snapshot to the journal every minute
# (via the pi-health.timer). When the Pi hangs and needs a hard reboot, this
# gives us the last few minutes of vitals right up to the freeze —
# `journalctl -t pi-health -b -1 -n 30` after the reboot.
set -euo pipefail

throttled=$(vcgencmd get_throttled 2>/dev/null || echo "n/a")
temp=$(vcgencmd measure_temp 2>/dev/null || echo "n/a")
mem=$(free -m | awk '/^Mem:/ {print "mem="$3"/"$2"MB"}')
swap=$(free -m | awk '/^Swap:/ {print "swap="$3"/"$2"MB"}')
load=$(cut -d' ' -f1-3 /proc/loadavg)
disk=$(df -h / | awk 'NR==2 {print "root="$5}')

logger -t pi-health "$throttled $temp $mem $swap load=$load $disk"
