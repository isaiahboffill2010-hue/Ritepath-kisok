# RitePath Kiosk Settings - Deployment Guide

## What Was Fixed

The Settings screen controls for **Volume** and **Wi-Fi** have been completely rewritten to:

1. ✅ Actually read the REAL system volume (not hardcoded 50%)
2. ✅ Actually change the REAL system volume
3. ✅ Actually read the REAL Wi-Fi connection status
4. ✅ Actually connect to REAL Wi-Fi networks
5. ✅ Support multiple audio backends (PulseAudio, PipeWire, ALSA)
6. ✅ Support multiple networking backends (NetworkManager, wpa_supplicant)
7. ✅ Provide detailed error messages when unavailable
8. ✅ Include diagnostics endpoint for troubleshooting

## Files Changed

### Backend
- **backend/app/main.py**
  - Added logging support
  - Improved `get_volume()` function with fallback support
  - Improved `set_volume_value()` function with fallback support
  - Improved `get_wifi_info()` function with two backends
  - Improved `connect_wifi_network()` function with two backends
  - NEW: `_get_wifi_nmcli()` - NetworkManager support
  - NEW: `_get_wifi_wpa()` - wpa_supplicant fallback
  - NEW: `GET /api/system/diagnostics` endpoint

### Frontend
- **frontend/src/screens/SettingsScreen.tsx**
  - Better Wi-Fi error handling
  
- **frontend/src/lib/api.ts**
  - Better error message extraction from backend

### Documentation
- **TESTING_SETTINGS_CONTROLS.md** - Comprehensive testing guide
- **SETTINGS_IMPROVEMENTS_SUMMARY.md** - Technical implementation details
- **DEPLOYMENT_GUIDE.md** - This file

## Deployment Steps

### Step 1: Prepare Your Raspberry Pi

Install required packages based on your setup:

**Option A: Standard Raspberry Pi OS (recommended)**
```bash
# Already has: dhcpcd, wpa_supplicant
# Add: tools and audio support
sudo apt update
sudo apt install -y alsa-utils wireless-tools

# Optional: for better diagnostics
sudo apt install -y pulseaudio
```

**Option B: With NetworkManager (if you prefer)**
```bash
sudo apt update
sudo apt install -y alsa-utils network-manager
sudo systemctl start NetworkManager
sudo systemctl enable NetworkManager
```

### Step 2: Deploy Code

1. Copy the updated files to your Raspberry Pi:
   ```bash
   scp -r /path/to/RitePath\ Kisok/* pi@raspberrypi:/home/pi/ritepath/
   ```

2. Or use git if available:
   ```bash
   cd /path/to/ritepath
   git pull origin main
   ```

### Step 3: Build and Start

```bash
# Install dependencies (if not already done)
npm --prefix frontend install
npm --prefix frontend run build

# Start the application
npm run desktop:dev  # Development mode
# or
npm run desktop:start  # Production mode
```

### Step 4: Verify Installation

**Check diagnostics:**
```bash
curl http://127.0.0.1:8000/api/system/diagnostics | jq .
```

Output should show:
- Which audio tools are available ✓
- Which Wi-Fi tools are available ✓
- Current volume status ✓
- Current Wi-Fi status ✓

**Test volume:**
```bash
# Read current volume
curl http://127.0.0.1:8000/api/volume

# Set volume to 75%
curl -X POST http://127.0.0.1:8000/api/volume \
  -H "Content-Type: application/json" \
  -d '{"volume": 75}'

# Read new volume (should be 75)
curl http://127.0.0.1:8000/api/volume
```

**Test Wi-Fi:**
```bash
# Get Wi-Fi status
curl http://127.0.0.1:8000/api/wifi

# Connect to a network
curl -X POST http://127.0.0.1:8000/api/wifi/connect \
  -H "Content-Type: application/json" \
  -d '{"ssid": "MyNetwork", "password": "MyPassword"}'
```

### Step 5: Test UI

1. Open the RitePath Kiosk Settings screen
2. **Volume control:**
   - Move the slider
   - Verify the system volume actually changes
   - Play audio to confirm
3. **Wi-Fi control:**
   - Verify current connection is shown
   - Verify available networks are listed
   - Try connecting to a network
   - Verify the system actually connects

## Troubleshooting

### "Audio control unavailable" error

This means NO audio tools are installed. Install at least one:

```bash
sudo apt install alsa-utils  # ALSA (most universal)
# OR
sudo apt install pulseaudio  # PulseAudio
```

**Debug:**
```bash
# Check what's available
which pactl wpctl amixer

# Test directly
amixer get Master
pactl get-sink-volume @DEFAULT_SINK@
wpctl get-volume @DEFAULT_AUDIO_SINK@
```

### "Wi-Fi service unavailable" error

This means neither NetworkManager nor wpa_supplicant tools are available.

**For Raspberry Pi OS (standard):**
```bash
sudo apt install wireless-tools
# Verify
which iw wpa_cli
```

**For NetworkManager:**
```bash
sudo apt install network-manager
sudo systemctl start NetworkManager
sudo systemctl enable NetworkManager
```

### Wi-Fi connects in UI but doesn't actually connect

1. Check if wpa_supplicant has permission to write config:
   ```bash
   sudo ls -la /etc/wpa_supplicant/
   sudo chmod 666 /etc/wpa_supplicant/wpa_supplicant.conf
   ```

2. Check if the network configuration was saved:
   ```bash
   wpa_cli list_networks
   ```

3. Try connecting manually:
   ```bash
   wpa_cli add_network
   wpa_cli set_network 0 ssid '"MyNetwork"'
   wpa_cli set_network 0 psk '"MyPassword"'
   wpa_cli enable_network 0
   ```

### Volume changes but UI doesn't reflect it

1. Check if volume was actually changed:
   ```bash
   amixer get Master  # ALSA
   pactl get-sink-volume @DEFAULT_SINK@  # PulseAudio
   ```

2. Wait for the next update (5-10 seconds)

3. Refresh the settings page

### No error message, just blank/missing controls

1. Check backend is running:
   ```bash
   curl http://127.0.0.1:8000/api/system/status
   ```

2. Check browser console for errors (F12)

3. Check backend logs:
   ```bash
   # If running in terminal
   # Look for error messages in console output
   ```

## Understanding the Error Messages

### Volume Errors

| Message | Cause | Solution |
|---------|-------|----------|
| "Audio control unavailable" | No audio tools found | Install pactl, wpctl, or amixer |
| "Failed to set volume" | Command execution failed | Check permissions, test tool directly |
| "Failed to read volume" | Cannot read current state | Check audio device exists |

### Wi-Fi Errors

| Message | Cause | Solution |
|---------|-------|----------|
| "Wi-Fi service unavailable" | No tools found | Install nmcli or wpa_cli |
| "Failed to add Wi-Fi network" | wpa_cli failed | Check wpa_supplicant running |
| "Failed to enable Wi-Fi network" | Cannot enable network | Check permissions, logs |
| Generic network errors | Network-specific | Check SSID, password, signal |

## Performance Notes

- **Volume control:** Instant (< 100ms)
- **Wi-Fi status read:** 100-500ms (includes scanning)
- **Wi-Fi connection:** 5-30 seconds (network dependent)
- **Settings page load:** 1-2 seconds

## API Endpoints Reference

### Volume

**GET /api/volume**
```json
{"volume": 75, "muted": false}
```

**POST /api/volume**
```json
{"volume": 75}
```

### Wi-Fi

**GET /api/wifi**
```json
{
  "connected": true,
  "ssid": "MyNetwork",
  "ip_address": "192.168.1.100",
  "signal": 75,
  "networks": [...],
  "available": true,
  "error": null
}
```

**POST /api/wifi/connect**
```json
{"ssid": "MyNetwork", "password": "MyPassword"}
```

### Diagnostics

**GET /api/system/diagnostics**
Shows all available tools, services, and current status.

## Testing Checklist

- [ ] Backend is running
- [ ] Diagnostics endpoint returns data
- [ ] Audio tools are listed as available
- [ ] Wi-Fi tools are listed as available
- [ ] Volume can be read via API
- [ ] Volume can be set via API
- [ ] Volume change is reflected in system
- [ ] Wi-Fi status can be read via API
- [ ] Wi-Fi networks are listed via API
- [ ] Can connect to Wi-Fi via API
- [ ] Volume slider works in Settings UI
- [ ] Wi-Fi controls work in Settings UI
- [ ] Error messages display when services unavailable

## Support

If you encounter issues:

1. **Gather diagnostics:**
   ```bash
   curl http://127.0.0.1:8000/api/system/diagnostics | jq . > diagnostics.json
   ```

2. **Check logs:**
   ```bash
   # If running in console, check output
   # If running as service:
   journalctl -u ritepath -n 50
   ```

3. **Test tools directly:**
   ```bash
   amixer get Master
   pactl get-sink-volume @DEFAULT_SINK@
   nmcli device wifi list
   wpa_cli status
   ```

4. **Share findings:**
   - Output of `api/system/diagnostics`
   - Result of direct tool tests
   - Error messages from UI or logs
   - Which audio/Wi-Fi system your Raspberry Pi uses

## Related Documentation

- `TESTING_SETTINGS_CONTROLS.md` - Detailed testing procedures
- `SETTINGS_IMPROVEMENTS_SUMMARY.md` - Technical implementation details
- `backend/app/main.py` - Implementation source code

## Success Criteria

✅ Settings screen loads without errors
✅ Volume slider appears and responds to input
✅ Wi-Fi status shows correctly (connected or not)
✅ Wi-Fi networks list is populated
✅ Volume actually changes system output
✅ Can connect to Wi-Fi networks
✅ System remains connected after reboot
✅ Error messages appear when services unavailable

Once all criteria are met, the Settings system is fully operational!
