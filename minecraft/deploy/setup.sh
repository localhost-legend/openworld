#!/bin/bash
# OpenWorld Minecraft — Oracle Cloud Setup Script
# Run on a fresh Ubuntu 22.04/24.04 ARM instance (Ampere A1)
# Usage: ssh ubuntu@YOUR_IP 'bash -s' < setup.sh

set -e

echo "=== OpenWorld Minecraft — Oracle Cloud Setup ==="

# 1. System updates
echo "[1/6] Updating system..."
sudo apt-get update -y && sudo apt-get upgrade -y

# 2. Install Docker
echo "[2/6] Installing Docker..."
if ! command -v docker &> /dev/null; then
  curl -fsSL https://get.docker.com | sudo sh
  sudo usermod -aG docker $USER
  sudo systemctl enable docker
  sudo systemctl start docker
  echo "Docker installed. You may need to logout/login for group changes."
fi

# 3. Install Docker Compose plugin
echo "[3/6] Installing Docker Compose..."
if ! docker compose version &> /dev/null; then
  sudo apt-get install -y docker-compose-plugin
fi

# 4. Open firewall ports (Oracle uses iptables)
echo "[4/6] Configuring firewall..."
sudo iptables -I INPUT -p tcp --dport 25565 -j ACCEPT  # Minecraft
sudo iptables -I INPUT -p tcp --dport 3001 -j ACCEPT   # Bridge API
sudo iptables -I INPUT -p tcp --dport 3007 -j ACCEPT   # Prismarine viewer
sudo iptables -I INPUT -p tcp --dport 8200 -j ACCEPT   # BlueMap
sudo iptables -I INPUT -p tcp --dport 80 -j ACCEPT     # HTTP (future)
sudo iptables -I INPUT -p tcp --dport 443 -j ACCEPT    # HTTPS (future)

# Persist iptables
sudo apt-get install -y iptables-persistent
sudo netfilter-persistent save

# 5. Create project directory
echo "[5/6] Setting up project..."
sudo mkdir -p /opt/openworld
sudo chown $USER:$USER /opt/openworld

# 6. Done
echo "[6/6] Setup complete!"
echo ""
echo "Next steps:"
echo "  1. Copy project files: scp -r minecraft/* ubuntu@YOUR_IP:/opt/openworld/"
echo "  2. SSH in: ssh ubuntu@YOUR_IP"
echo "  3. cd /opt/openworld && docker compose up -d"
echo "  4. Wait ~2 min for MC server to start"
echo ""
echo "Ports to open in Oracle Cloud Security List:"
echo "  25565/TCP — Minecraft"
echo "  3001/TCP  — Bridge API"
echo "  3007/TCP  — 3D Viewer"
echo "  8200/TCP  — BlueMap"
