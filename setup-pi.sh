#!/bin/bash
set -e

echo "==> Boosting swap to 1GB..."
if command -v dphys-swapfile &>/dev/null; then
  sudo dphys-swapfile swapoff
  sudo sed -i 's/CONF_SWAPSIZE=.*/CONF_SWAPSIZE=1024/' /etc/dphys-swapfile
  sudo dphys-swapfile setup
  sudo dphys-swapfile swapon
elif [ ! -f /swapfile ]; then
  sudo fallocate -l 1G /swapfile
  sudo chmod 600 /swapfile
  sudo mkswap /swapfile
  sudo swapon /swapfile
else
  echo "Swap file already exists, skipping."
fi

echo "==> Installing Node.js 20 + build tools..."
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs build-essential python3

echo "==> Node version: $(node --version)"

echo "==> Installing npm dependencies (compiling native modules for ARM)..."
cd ~/warhammer
npm install

echo "==> Building Next.js app (this takes ~10 min on Pi 3)..."
npm run build

echo "==> Setting up systemd service..."
sudo tee /etc/systemd/system/warhammer.service > /dev/null << 'EOF'
[Unit]
Description=Warhammer 40K App
After=network.target

[Service]
Type=simple
User=christiangoff
WorkingDirectory=/home/christiangoff/warhammer
ExecStart=npm start
Restart=on-failure
RestartSec=5
Environment=NODE_ENV=production
Environment=PORT=3002

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable warhammer
sudo systemctl start warhammer

echo ""
echo "==> Done! App running at http://192.168.68.140:3002"
sudo systemctl status warhammer --no-pager
