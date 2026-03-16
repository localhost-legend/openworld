#!/bin/bash
# OpenWorld — One-command deploy to Oracle Cloud
# Usage: ./deploy/deploy.sh ubuntu@YOUR_ORACLE_IP
#
# Prereqs:
#   1. Oracle Cloud instance created (Ampere A1, 4 OCPU, 24GB RAM)
#   2. SSH key added
#   3. Security List: open ports 25565, 3001, 3007, 8200

set -e

if [ -z "$1" ]; then
  echo "Usage: ./deploy/deploy.sh user@host"
  echo "Example: ./deploy/deploy.sh ubuntu@129.151.xxx.xxx"
  exit 1
fi

HOST=$1
REMOTE_DIR="/opt/openworld"

echo "=== OpenWorld Deploy to $HOST ==="

# 1. Run setup on remote (Docker, firewall, etc.)
echo "[1/5] Running setup on remote..."
ssh $HOST 'bash -s' < deploy/setup.sh

# 2. Create remote directory
echo "[2/5] Creating remote directory..."
ssh $HOST "sudo mkdir -p $REMOTE_DIR && sudo chown \$USER:\$USER $REMOTE_DIR"

# 3. Copy files
echo "[3/5] Copying project files..."
rsync -avz --exclude='node_modules' --exclude='mc-data' --exclude='data/*.db' \
  --exclude='.git' --exclude='deploy' \
  ./ $HOST:$REMOTE_DIR/

# Copy SKILL.md
scp ../skill/SKILL.md $HOST:$REMOTE_DIR/SKILL.md

# 4. Build and start on remote
echo "[4/5] Building and starting services..."
ssh $HOST "cd $REMOTE_DIR && docker compose -f docker-compose.prod.yml up -d --build"

# 5. Wait for MC server
echo "[5/5] Waiting for Minecraft server..."
ssh $HOST "for i in \$(seq 1 30); do docker logs openworld-mc 2>&1 | grep -q 'Done' && echo 'MC server ready!' && break || echo 'Waiting...' && sleep 10; done"

# Get public IP
PUBLIC_IP=$(ssh $HOST "curl -s ifconfig.me")

echo ""
echo "========================================"
echo " OpenWorld is LIVE!"
echo "========================================"
echo ""
echo " API:        http://$PUBLIC_IP:3001"
echo " SKILL.md:   http://$PUBLIC_IP:3001/skill.md"
echo " 3D Viewer:  http://$PUBLIC_IP:3007"
echo " BlueMap:    http://$PUBLIC_IP:8200"
echo " Minecraft:  $PUBLIC_IP:25565"
echo ""
echo " People can connect OpenClaws by pointing to:"
echo " http://$PUBLIC_IP:3001/skill.md"
echo "========================================"
