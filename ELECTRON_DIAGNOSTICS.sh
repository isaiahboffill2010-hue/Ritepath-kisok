#!/bin/bash
# RitePath Kiosk - Electron Crash Diagnostics Script
# Run this on the Raspberry Pi to diagnose the SIGSEGV crash

set -e

echo "========================================"
echo "RitePath Electron Crash Diagnostics"
echo "========================================"
echo ""

echo "=== STEP 1: System Environment ==="
echo "Uname output:"
uname -a
echo ""

echo "Machine architecture:"
uname -m
echo ""

echo "OS Release:"
cat /etc/os-release
echo ""

echo "CPU info:"
lscpu | head -20
echo ""

echo "Memory:"
free -h
echo ""

echo "=== STEP 2: Node/NPM/Electron Versions ==="
echo "Node version:"
node -v
echo ""

echo "NPM version:"
npm -v
echo ""

echo "Electron version (from CLI):"
npx electron --version 2>/dev/null || echo "ERROR: npx electron failed"
echo ""

echo "Installed Electron package:"
npm ls electron
echo ""

echo "=== STEP 3: Electron Binary Architecture ==="
echo "Electron binary file type:"
file node_modules/electron/dist/electron
echo ""

echo "Node binary file type:"
file "$(which node)"
echo ""

echo "=== STEP 4: Display Environment ==="
echo "DISPLAY variable:"
echo "$DISPLAY"
echo ""

echo "WAYLAND_DISPLAY variable:"
echo "$WAYLAND_DISPLAY"
echo ""

echo "XDG_SESSION_TYPE:"
echo "$XDG_SESSION_TYPE"
echo ""

echo "XDG_CURRENT_DESKTOP:"
echo "$XDG_CURRENT_DESKTOP"
echo ""

echo "Loginctl sessions:"
loginctl list-sessions 2>/dev/null || echo "loginctl not available"
echo ""

echo "=== STEP 5: Electron Binary Dependencies ==="
echo "Full ldd output:"
ldd node_modules/electron/dist/electron 2>&1 | head -50
echo ""

echo "Missing dependencies (if any):"
ldd node_modules/electron/dist/electron 2>&1 | grep "not found" || echo "No missing dependencies found"
echo ""

echo "=== STEP 6: Test Electron Directly ==="
echo "Testing electron --version:"
./node_modules/.bin/electron --version 2>&1 || echo "FAILED: electron --version"
echo ""

echo "=== STEP 7: Pre-crash system state ==="
echo "Current date/time:"
date
echo ""

echo "Checking dmesg buffer (will capture after crash):"
dmesg | tail -5
echo ""

echo "========================================"
echo "Diagnostics complete. Now reproduce the crash:"
echo "1. Run: npm run desktop:dev"
echo "2. Wait for the SIGSEGV"
echo "3. Then run:"
echo "   dmesg | tail -100 > dmesg_output.txt"
echo "   journalctl -xe --no-pager -n 200 > journalctl_output.txt"
echo "4. Share all output files"
echo "========================================"
