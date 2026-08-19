# RitePath Raspberry Pi Kiosk Startup

This setup starts RitePath automatically on boot in a dedicated kiosk session:

- no Raspberry Pi desktop
- no terminal window
- automatic restart if the app crashes
- backend, Vite, and Electron start in the existing order

## Prerequisites

Install the system packages RitePath needs on the Pi:

```bash
sudo apt update
sudo apt install -y nodejs npm python3 python3-pip xinit xserver-xorg x11-xserver-utils
```

Install the app dependencies from the repo root:

```bash
cd ~/Ritepath-kisok
npm install
npm --prefix frontend install
python3 -m pip install --user -r backend/requirements.txt
```

## Install The Kiosk Service

Copy the included systemd template into place:

```bash
sudo cp ~/Ritepath-kisok/linux/ritepath-kiosk@.service /etc/systemd/system/
sudo systemctl daemon-reload
```

## Disable The Desktop

To keep the Raspberry Pi desktop from appearing, boot to the console instead of the desktop:

```bash
sudo systemctl set-default multi-user.target
sudo systemctl disable --now lightdm
sudo systemctl mask getty@tty1.service
```

If your Pi uses a different display manager, disable that one instead of `lightdm`.

## Enable RitePath At Boot

Enable the service for your Pi user account. Replace `ritepath` with your actual username if needed:

```bash
sudo systemctl enable ritepath-kiosk@ritepath.service
sudo systemctl start ritepath-kiosk@ritepath.service
```

## Check Status

```bash
sudo systemctl status ritepath-kiosk@ritepath.service
```

## Reboot Test

```bash
sudo reboot
```

After reboot, the Pi should start straight into the RitePath kiosk session.

## How It Works

- `linux/ritepath-kiosk-session.sh` changes into the repo and runs `npm run desktop:dev`
- `desktop/dev.mjs` starts the Python backend, then Vite, then Electron
- systemd restarts the whole kiosk automatically if the process exits unexpectedly
