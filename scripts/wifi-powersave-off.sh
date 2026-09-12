#!/bin/bash
# Disable WiFi power management. The Pi's onboard WiFi chip going to sleep and
# never waking back up (until a hard power cycle) is one of the most common
# causes of a Pi silently dropping off the network. Idempotent — safe to run
# repeatedly, which wifi-powersave-off.timer does in case something (a
# reconnect, a NetworkManager event) turns it back on.
set -uo pipefail

iface=$(iw dev 2>/dev/null | awk '$1=="Interface"{print $2; exit}')
iface=${iface:-wlan0}

iw dev "$iface" set power_save off 2>&1 | logger -t wifi-powersave-off
logger -t wifi-powersave-off "iface=$iface state=$(iw dev "$iface" get power_save 2>&1)"
