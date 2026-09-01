# RitePath Kiosk Settings Controls - Testing Guide

## Overview

This document explains the improvements made to the Volume and Wi-Fi controls and how to test them on the Raspberry Pi.

## Changes Made

### Backend (backend/app/main.py)

1. **Logging & Diagnostics**
   - Added comprehensive logging to track volume and Wi-Fi operations
   - New endpoint: `GET /api/system/diagnostics` - shows what tools are available
   - Proper error messages instead of silent failures

2. **Volume Control Improvements**
   - Now supports: PulseAudio (pactl), PipeWire (wpctl), and ALSA (amixer)
   - Returns proper HTTP 503 error if no audio control is available
   - Logs which tool succeeded or failed
   - Each tool is tried in order of preference

3. **Wi-Fi Control Improvements**
   - Primary: NetworkManager (nmcli) - full feature support
   - Fallback: wpa_supplicant (wpa_cli) + iw tools
   - Returns clear error messages when no tools available
   - Logs connection attempts and results
   - Supports both Raspberry Pi OS standard and NetworkManager setups

4. **Frontend Improvements (frontend/src/)**
   - Better error handling from backend responses
   - Shows backend error messages to user
   - Displays Wi-Fi status errors properly

## Testing on Raspberry Pi

### Step 1: Check Available Tools

```bash
# Check audio tools
which pactl       # PulseAudio
which wpctl       # PipeWire
which amixer      # ALSA

# Check Wi-Fi tools
which nmcli       # NetworkManager
which wpa_cli     # wpa_supplicant
which iw          # iw utility
```

### Step 2: Check System Status via API

Once the kiosk is running, call the diagnostics endpoint:

```bash
curl http://127.0.0.1:8000/api/system/diagnostics | jq .
```

This will show:
- Which audio tools are available
- Which Wi-Fi tools are available
- Current system services status
- Current volume and Wi-Fi status

### Step 3: Test Volume Control

#### Via Command Line

```bash
# Test current volume (using available tool)
curl http://127.0.0.1:8000/api/volume

# Test setting volume to 75%
curl -X POST http://127.0.0.1:8000/api/volume \
  -H "Content-Type: application/json" \
  -d '{"volume": 75}'

# Verify it changed
curl http://127.0.0.1:8000/api/volume
```

#### Via UI

1. Open Settings
2. Look at Volume control
3. Move the slider to different positions
4. Check that the system volume actually changes (test with audio)
5. Verify percentage displayed matches the slider

### Step 4: Test Wi-Fi Control

#### Via Command Line

```bash
# Get Wi-Fi status
curl http://127.0.0.1:8000/api/wifi

# Attempt to connect (replace SSID and PASSWORD)
curl -X POST http://127.0.0.1:8000/api/wifi/connect \
  -H "Content-Type: application/json" \
  -d '{"ssid": "MyNetwork", "password": "MyPassword"}'
```

#### Via UI

1. Open Settings
2. Check Wi-Fi status:
   - If connected: shows network name and signal strength
   - If not connected: shows "Not connected"
   - If unavailable: shows error message
3. Enter a network name and password
4. Click "Connect"
5. Wait for status to update
6. Verify actual Wi-Fi connection changed
7. Check IP address with `hostname -I`

### Step 5: Check Logs

To see what the backend is doing:

```bash
# If running in terminal
# Look at the console output for:
# - Audio control messages
# - Wi-Fi connection attempts
# - Any errors

# If running as service
sudo journalctl -u ritepath -f  # if systemd service
sudo systemctl status ritepath   # check service status
```

## Troubleshooting

### Volume Not Working

1. **Check Available Tools**
   ```bash
   which pactl amixer wpctl
   ```

2. **Test Directly**
   ```bash
   # PulseAudio
   pactl get-sink-volume @DEFAULT_SINK@
   pactl set-sink-volume @DEFAULT_SINK@ 75%

   # ALSA
   amixer get Master
   amixer set Master 75%

   # PipeWire
   wpctl get-volume @DEFAULT_AUDIO_SINK@
   wpctl set-volume @DEFAULT_AUDIO_SINK@ 0.75
   ```

3. **Check API Response**
   ```bash
   curl -v http://127.0.0.1:8000/api/volume
   # Status should be 200 with volume data, or 503 if unavailable
   ```

4. **Permissions**
   - Make sure the user running RitePath has audio permissions
   - Check if there's a default audio device:
   ```bash
   pactl list short sinks
   amixer scontrols
   ```

### Wi-Fi Not Working

1. **Check Available Tools**
   ```bash
   which nmcli wpa_cli iw
   ```

2. **Test NetworkManager (if available)**
   ```bash
   nmcli device wifi list      # List networks
   nmcli device wifi connect SSID password PASSWORD
   ```

3. **Test wpa_supplicant (if available)**
   ```bash
   wpa_cli status              # Check current status
   wpa_cli scan                # Scan networks
   iw dev wlan0 link           # Check connection
   ```

4. **Check API Response**
   ```bash
   curl http://127.0.0.1:8000/api/wifi
   # Should show available: true, or error message
   ```

5. **Check if services are running**
   ```bash
   sudo systemctl status NetworkManager
   sudo systemctl status wpa_supplicant
   ```

6. **Permissions**
   - wpa_cli might need sudo
   - Check if user is in `netdev` group:
   ```bash
   groups $USER
   # Should include 'netdev'
   ```

## What Tool Should Be Installed?

### Recommended for Raspberry Pi OS

**Audio:**
- ALSA (amixer) - included by default ✓
- PulseAudio (pactl) - optional, requires: `sudo apt install pulseaudio`

**Wi-Fi:**
- Default dhcpcd + wpa_supplicant - included ✓
- OR NetworkManager: `sudo apt install network-manager`

### Recommended for Development/Headless

**Audio:**
```bash
sudo apt install alsa-utils    # For amixer
sudo apt install pulseaudio    # For pactl
```

**Wi-Fi:**
```bash
sudo apt install network-manager  # For nmcli (recommended)
```

## Expected API Responses

### Successful Volume Control

```json
{
  "volume": 75,
  "muted": false
}
```

### Successful Wi-Fi Status

```json
{
  "connected": true,
  "ssid": "MyNetwork",
  "ip_address": "192.168.1.100",
  "signal": 75,
  "networks": [
    {
      "ssid": "MyNetwork",
      "signal": 75,
      "security": "WPA2",
      "connected": true
    }
  ],
  "available": true,
  "error": null
}
```

### Error Response (503 Audio Unavailable)

```json
{
  "detail": "Audio control unavailable"
}
```

HTTP Status Code: 503 Service Unavailable

## Known Issues & Workarounds

1. **ALSA volume control**
   - Only works with "Master" control
   - Some systems might use different control names
   - Workaround: Install PulseAudio

2. **wpa_cli connection issues**
   - Might require sudo/elevated permissions
   - Some networks might need additional parameters
   - Workaround: Use NetworkManager instead

3. **Signal strength on wpa_supplicant**
   - Might not be available or accurate
   - Workaround: Use NetworkManager for better info

## File Changes Summary

### Backend
- `backend/app/main.py` - Added comprehensive audio/Wi-Fi support

### Frontend
- `frontend/src/screens/SettingsScreen.tsx` - Improved error handling
- `frontend/src/lib/api.ts` - Better error message extraction

## Next Steps

1. Deploy to Raspberry Pi
2. Run diagnostics: `curl http://127.0.0.1:8000/api/system/diagnostics`
3. Test volume and Wi-Fi via the Settings UI
4. Verify actual system changes (test audio, check Wi-Fi connection)
5. Check logs for any issues
6. Report results with diagnostics output
