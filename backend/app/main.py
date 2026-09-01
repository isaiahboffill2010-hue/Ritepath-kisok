from __future__ import annotations

import json
import logging
import mimetypes
import hashlib
import platform
import re
import shutil
import socket
import subprocess
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

logger = logging.getLogger("ritepath")

APP_START = time.time()
BASE_DIR = Path(__file__).resolve().parent.parent
FILES_ROOT = (BASE_DIR / "storage" / "ritepath").resolve()
STORAGE_DIR = (BASE_DIR / "storage").resolve()
CUSTOM_APPS_FILE = (STORAGE_DIR / "custom_apps.json").resolve()


def ensure_storage_dir() -> None:
    """Ensure storage directory exists at startup."""
    try:
        STORAGE_DIR.mkdir(parents=True, exist_ok=True)
        logger.info(f"Storage directory ready: {STORAGE_DIR}")
    except Exception as e:
        logger.error(f"Failed to create storage directory {STORAGE_DIR}: {e}")
        # Continue anyway, will fail when trying to save


class VolumePayload(BaseModel):
    volume: int = Field(ge=0, le=100)


class WifiConnectPayload(BaseModel):
    ssid: str = Field(min_length=1, max_length=128)
    password: str = Field(default="", max_length=256)


class CustomAppPayload(BaseModel):
    url: str = Field(min_length=8, max_length=2048)
    backgroundColor: str = Field(min_length=7, max_length=7)  # #RRGGBB


class CustomApp(BaseModel):
    id: str
    url: str
    backgroundColor: str
    displayName: str


app = FastAPI(title="RitePath Kiosk API", version="3.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Initialize storage directories at startup
ensure_storage_dir()


def ensure_files_root() -> None:
    FILES_ROOT.mkdir(parents=True, exist_ok=True)


def root_id_for_path(path: Path) -> str:
    digest = hashlib.sha1(str(path).encode("utf-8")).hexdigest()[:12]
    if path == FILES_ROOT:
        return "ritepath"
    return f"usb-{digest}"


def discover_usb_roots() -> list[Path]:
    roots: list[Path] = []
    for candidate in [Path("/media"), Path("/run/media"), Path("/mnt")]:
        if not candidate.exists():
            continue
        try:
            for child in candidate.iterdir():
                if child.is_dir():
                    if child == FILES_ROOT:
                        continue
                    roots.append(child.resolve())
        except PermissionError:
            continue
    return roots


def discover_files_roots() -> list[dict[str, Any]]:
    ensure_files_root()
    roots = [
        {"id": "ritepath", "label": "RitePath Files", "kind": "ritepath", "path": str(FILES_ROOT)},
    ]
    for usb_root in discover_usb_roots():
        roots.append(
            {
                "id": root_id_for_path(usb_root),
                "label": f"USB Drive - {usb_root.name}",
                "kind": "usb",
                "path": str(usb_root),
            }
        )
    return roots


def resolve_root(root_id: str) -> Path:
    for root in discover_files_roots():
        if root["id"] == root_id:
            return Path(root["path"]).resolve()
    raise HTTPException(status_code=404, detail="Unknown storage root")


def resolve_safe_path(root_id: str, relative_path: str) -> tuple[Path, Path, str]:
    base = resolve_root(root_id)
    safe_relative = relative_path.strip().lstrip("/\\")
    candidate = (base / safe_relative).resolve()
    if candidate != base and base not in candidate.parents:
        raise HTTPException(status_code=400, detail="Invalid path")
    return base, candidate, root_id


def run_command(command: list[str]) -> subprocess.CompletedProcess[str]:
    return subprocess.run(command, check=False, capture_output=True, text=True)


def get_volume() -> dict[str, Any]:
    try:
        if shutil.which("pactl"):
            result = run_command(["pactl", "get-sink-volume", "@DEFAULT_SINK@"])
            if result.returncode == 0:
                match = re.search(r"(\d+)%", result.stdout)
                volume = int(match.group(1)) if match else 50
                muted = "yes" in result.stdout.lower()
                logger.debug(f"Volume from pactl: {volume}%, muted: {muted}")
                return {"volume": volume, "muted": muted}
            else:
                logger.warning(f"pactl failed: {result.stderr}")

        if shutil.which("wpctl"):
            result = run_command(["wpctl", "get-volume", "@DEFAULT_AUDIO_SINK@"])
            if result.returncode == 0:
                match = re.search(r"Volume:\s+([\d.]+)", result.stdout)
                if match:
                    volume = int(float(match.group(1)) * 100)
                    muted = "[MUTED]" in result.stdout
                    logger.debug(f"Volume from wpctl: {volume}%, muted: {muted}")
                    return {"volume": volume, "muted": muted}
            else:
                logger.warning(f"wpctl failed: {result.stderr}")

        if shutil.which("amixer"):
            result = run_command(["amixer", "get", "Master"])
            if result.returncode == 0:
                matches = re.findall(r"\[(\d+)%\].*\[(on|off)\]", result.stdout, re.IGNORECASE)
                if matches:
                    volume, mute_state = matches[-1]
                    muted = mute_state.lower() == "off"
                    logger.debug(f"Volume from amixer: {volume}%, muted: {muted}")
                    return {"volume": int(volume), "muted": muted}
            else:
                logger.warning(f"amixer failed: {result.stderr}")

        logger.error("No audio control available (pactl/wpctl/amixer not found)")
        raise HTTPException(status_code=503, detail="Audio control unavailable")
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error reading volume: {e}")
        raise HTTPException(status_code=500, detail="Failed to read volume")


def set_volume_value(volume: int) -> dict[str, Any]:
    try:
        success = False

        if shutil.which("pactl"):
            result = run_command(["pactl", "set-sink-volume", "@DEFAULT_SINK@", f"{volume}%"])
            if result.returncode == 0:
                logger.info(f"Set volume to {volume}% via pactl")
                success = True
            else:
                logger.warning(f"pactl set-sink-volume failed: {result.stderr}")

        elif shutil.which("wpctl"):
            vol_fraction = volume / 100.0
            result = run_command(["wpctl", "set-volume", "@DEFAULT_AUDIO_SINK@", str(vol_fraction)])
            if result.returncode == 0:
                logger.info(f"Set volume to {volume}% via wpctl")
                success = True
            else:
                logger.warning(f"wpctl set-volume failed: {result.stderr}")

        elif shutil.which("amixer"):
            result = run_command(["amixer", "-q", "set", "Master", f"{volume}%"])
            if result.returncode == 0:
                logger.info(f"Set volume to {volume}% via amixer")
                success = True
            else:
                logger.warning(f"amixer set failed: {result.stderr}")
        else:
            logger.error("No audio control available for setting volume")
            raise HTTPException(status_code=503, detail="Audio control unavailable")

        if not success:
            raise HTTPException(status_code=500, detail="Failed to set volume")

        return get_volume()
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error setting volume: {e}")
        raise HTTPException(status_code=500, detail="Failed to set volume")


def get_wifi_info() -> dict[str, Any]:
    response: dict[str, Any] = {
        "connected": False,
        "ssid": None,
        "ip_address": None,
        "signal": None,
        "networks": [],
        "available": False,
        "error": None,
    }

    try:
        if shutil.which("nmcli"):
            return _get_wifi_nmcli(response)
        elif shutil.which("iw") or shutil.which("wpa_cli"):
            return _get_wifi_wpa(response)
        else:
            logger.warning("No Wi-Fi management tools available (nmcli, iw, or wpa_cli)")
            response["error"] = "Wi-Fi service unavailable"
            return response
    except Exception as e:
        logger.error(f"Error reading Wi-Fi info: {e}")
        response["error"] = "Wi-Fi service unavailable"
        return response


def _get_wifi_nmcli(response: dict[str, Any]) -> dict[str, Any]:
    response["available"] = True

    current = run_command(["nmcli", "-t", "-f", "ACTIVE,SSID,SIGNAL,DEVICE", "dev", "wifi"])
    if current.returncode == 0:
        for line in current.stdout.splitlines():
            parts = line.split(":")
            if len(parts) < 4:
                continue
            active, ssid, signal, _device = parts[:4]
            if active == "yes":
                response["connected"] = True
                response["ssid"] = ssid or None
                try:
                    response["signal"] = int(signal) if signal.isdigit() else None
                except ValueError:
                    response["signal"] = None
                break

    ip = run_command(["hostname", "-I"])
    if ip.returncode == 0:
        ips = ip.stdout.strip().split()
        response["ip_address"] = ips[0] if ips else None

    scan = run_command(["nmcli", "-t", "-f", "SSID,SIGNAL,SECURITY,IN-USE", "dev", "wifi", "list"])
    if scan.returncode == 0:
        networks = []
        seen = set()
        for line in scan.stdout.splitlines():
            parts = line.split(":")
            if len(parts) < 4:
                continue
            ssid, signal, security, in_use = parts[:4]
            if ssid and ssid not in seen:
                seen.add(ssid)
                try:
                    sig_int = int(signal) if signal.isdigit() else None
                except ValueError:
                    sig_int = None
                networks.append(
                    {
                        "ssid": ssid,
                        "signal": sig_int,
                        "security": security or None,
                        "connected": in_use.strip() == "*",
                    }
                )
        response["networks"] = networks

    logger.debug(f"Wi-Fi status: connected={response['connected']}, ssid={response['ssid']}, networks={len(response['networks'])}")
    return response


def _get_wifi_wpa(response: dict[str, Any]) -> dict[str, Any]:
    response["available"] = True

    try:
        ip = run_command(["hostname", "-I"])
        if ip.returncode == 0:
            ips = ip.stdout.strip().split()
            response["ip_address"] = ips[0] if ips else None
    except Exception:
        pass

    if shutil.which("wpa_cli"):
        status = run_command(["wpa_cli", "status"])
        if status.returncode == 0:
            for line in status.stdout.splitlines():
                if line.startswith("ssid="):
                    response["ssid"] = line.split("=", 1)[1] or None
                if line.startswith("wpa_state="):
                    state = line.split("=", 1)[1]
                    response["connected"] = state == "COMPLETED"

    networks = []
    if shutil.which("iw"):
        scan = run_command(["iw", "dev", "wlan0", "link"])
        if scan.returncode != 0:
            scan = run_command(["iw", "dev", "wlan1", "link"])

        if scan.returncode == 0 and response["ssid"]:
            match = re.search(r"signal:\s+(-?\d+)\s+dBm", scan.stdout)
            if match:
                try:
                    dbm = int(match.group(1))
                    response["signal"] = max(0, min(100, (dbm + 100) * 2))
                except ValueError:
                    pass

        scan_result = run_command(["iw", "dev", "wlan0", "scan"])
        if scan_result.returncode != 0:
            scan_result = run_command(["iw", "dev", "wlan1", "scan"])

        if scan_result.returncode == 0:
            for cell in re.finditer(r"SSID:\s+(.+?)(?:\n|$)|signal:\s+(-?\d+)\s+dBm", scan_result.stdout):
                if cell.group(1):
                    ssid = cell.group(1).strip()
                    if ssid and ssid not in [n["ssid"] for n in networks]:
                        networks.append({"ssid": ssid, "signal": None, "security": None, "connected": False})

    response["networks"] = networks
    logger.debug(f"Wi-Fi (wpa) status: connected={response['connected']}, ssid={response['ssid']}, networks={len(response['networks'])}")
    return response


def connect_wifi_network(ssid: str, password: str) -> dict[str, Any]:
    logger.info(f"Attempting to connect to Wi-Fi network: {ssid}")

    if shutil.which("nmcli"):
        command = ["nmcli", "dev", "wifi", "connect", ssid]
        if password:
            command.extend(["password", password])

        result = run_command(command)
        if result.returncode != 0:
            error_msg = result.stderr.strip() or "Failed to connect to Wi-Fi network"
            logger.error(f"nmcli connection failed: {error_msg}")
            raise HTTPException(status_code=400, detail=error_msg)

        logger.info(f"Successfully connected via nmcli: {ssid}")
        return get_wifi_info()

    elif shutil.which("wpa_cli"):
        result = run_command(["wpa_cli", "add_network"])
        if result.returncode != 0:
            logger.error(f"wpa_cli add_network failed: {result.stderr}")
            raise HTTPException(status_code=400, detail="Failed to add Wi-Fi network")

        net_id = result.stdout.strip()
        if not net_id.isdigit():
            logger.error(f"wpa_cli add_network returned invalid ID: {net_id}")
            raise HTTPException(status_code=400, detail="Failed to add Wi-Fi network")

        run_command(["wpa_cli", "set_network", net_id, "ssid", f'"{ssid}"'])
        if password:
            run_command(["wpa_cli", "set_network", net_id, "psk", f'"{password}"'])
        else:
            run_command(["wpa_cli", "set_network", net_id, "key_mgmt", "NONE"])

        result = run_command(["wpa_cli", "enable_network", net_id])
        if result.returncode != 0:
            logger.error(f"wpa_cli enable_network failed: {result.stderr}")
            run_command(["wpa_cli", "remove_network", net_id])
            raise HTTPException(status_code=400, detail="Failed to enable Wi-Fi network")

        result = run_command(["wpa_cli", "save_config"])
        if result.returncode != 0:
            logger.warning(f"wpa_cli save_config failed: {result.stderr}")

        logger.info(f"Successfully connected via wpa_cli: {ssid}")
        return get_wifi_info()

    else:
        logger.error("No Wi-Fi management tools available (nmcli or wpa_cli)")
        raise HTTPException(status_code=503, detail="Wi-Fi service unavailable")


def get_domain_name(url: str) -> str:
    """Extract domain name from URL for automatic app naming."""
    try:
        parsed = urlparse(url)
        domain = parsed.netloc.replace("www.", "")

        # Generate display name from domain
        parts = domain.split(".")
        if len(parts) > 1:
            name = parts[0].capitalize()
        else:
            name = domain.capitalize()

        return name
    except Exception:
        return "Custom App"


def load_custom_apps() -> dict[str, Any]:
    """Load custom apps from storage."""
    if not CUSTOM_APPS_FILE.exists():
        return {}

    try:
        with open(CUSTOM_APPS_FILE, "r") as f:
            return json.load(f)
    except Exception as e:
        logger.error(f"Error loading custom apps: {e}")
        return {}


def save_custom_apps(apps: dict[str, Any]) -> None:
    """Save custom apps to storage."""
    try:
        # Ensure storage directory exists
        try:
            STORAGE_DIR.mkdir(parents=True, exist_ok=True)
        except PermissionError as e:
            logger.error(f"Permission denied creating storage directory {STORAGE_DIR}: {e}")
            raise HTTPException(status_code=500, detail="Storage directory permission denied")
        except Exception as e:
            logger.error(f"Failed to create storage directory {STORAGE_DIR}: {e}")
            raise HTTPException(status_code=500, detail="Failed to create storage directory")

        # Write to temporary file first for atomicity
        temp_file = CUSTOM_APPS_FILE.with_suffix('.json.tmp')
        try:
            with open(temp_file, "w") as f:
                json.dump(apps, f, indent=2)
        except PermissionError as e:
            logger.error(f"Permission denied writing to {temp_file}: {e}")
            raise HTTPException(status_code=500, detail="Storage write permission denied")
        except Exception as e:
            logger.error(f"Failed to write to {temp_file}: {e}")
            raise HTTPException(status_code=500, detail=f"Failed to write storage file: {str(e)}")

        # Atomically replace original file
        try:
            temp_file.replace(CUSTOM_APPS_FILE)
        except Exception as e:
            logger.error(f"Failed to move {temp_file} to {CUSTOM_APPS_FILE}: {e}")
            # Attempt cleanup
            try:
                temp_file.unlink()
            except:
                pass
            raise HTTPException(status_code=500, detail="Failed to finalize storage file")

        logger.info(f"Saved custom apps to {CUSTOM_APPS_FILE}")
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Unexpected error saving custom apps: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to save app: {str(e)}")


def file_entry(path: Path, root_id: str) -> dict[str, Any]:
    stat = path.stat()
    mime_type, _ = mimetypes.guess_type(path.name)
    is_dir = path.is_dir()
    previewable = bool(
        not is_dir and (((mime_type or "").startswith(("text/", "image/"))) or mime_type == "application/pdf")
    )
    base = resolve_root(root_id)
    relative_path = str(path.relative_to(base)).replace("\\", "/")
    return {
        "name": path.name,
        "path": relative_path,
        "is_dir": is_dir,
        "size": None if is_dir else stat.st_size,
        "modified": datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc).isoformat(),
        "mime_type": mime_type,
        "previewable": previewable,
        "content_url": None if is_dir else f"/api/files/content?root={root_id}&path={relative_path}",
    }


@app.get("/api/system/status")
def system_status() -> dict[str, Any]:
    ensure_files_root()
    return {
        "hostname": socket.gethostname(),
        "platform": platform.platform(),
        "kernel": platform.release(),
        "uptime_seconds": int(time.time() - APP_START),
        "backend_time": datetime.now(timezone.utc).isoformat(),
        "safe_files_root": str(FILES_ROOT),
    }


@app.get("/api/system/diagnostics")
def system_diagnostics() -> dict[str, Any]:
    audio_tools = {
        "pactl": shutil.which("pactl") is not None,
        "amixer": shutil.which("amixer") is not None,
        "wpctl": shutil.which("wpctl") is not None,
    }

    wifi_tools = {
        "nmcli": shutil.which("nmcli") is not None,
        "iw": shutil.which("iw") is not None,
        "iwconfig": shutil.which("iwconfig") is not None,
        "wpa_cli": shutil.which("wpa_cli") is not None,
    }

    services = {}
    for service in ["NetworkManager", "pipewire", "pulseaudio", "alsa-utils"]:
        check = run_command(["systemctl", "is-active", "--quiet", service])
        services[service] = check.returncode == 0

    volume_status = get_volume() if audio_tools.get("pactl") or audio_tools.get("amixer") else {"error": "No audio tools available"}
    wifi_status = get_wifi_info()

    return {
        "audio": {
            "tools": audio_tools,
            "current_volume": volume_status,
        },
        "wifi": {
            "tools": wifi_tools,
            "current_status": wifi_status,
        },
        "services": services,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }


@app.get("/api/files/roots")
def file_roots() -> dict[str, Any]:
    return {"roots": discover_files_roots()}


@app.get("/api/volume")
def read_volume() -> dict[str, Any]:
    return get_volume()


@app.post("/api/volume")
def write_volume(payload: VolumePayload) -> dict[str, Any]:
    return set_volume_value(payload.volume)


@app.get("/api/wifi")
def read_wifi() -> dict[str, Any]:
    return get_wifi_info()


@app.post("/api/wifi/connect")
def wifi_connect(payload: WifiConnectPayload) -> dict[str, Any]:
    return connect_wifi_network(payload.ssid, payload.password)


@app.get("/api/custom-apps")
def get_custom_apps() -> dict[str, Any]:
    apps = load_custom_apps()
    return {"apps": list(apps.values())}


@app.get("/api/storage/health")
def storage_health() -> dict[str, Any]:
    """Health check endpoint to verify storage is working."""
    health = {
        "storage_dir_exists": STORAGE_DIR.exists(),
        "storage_dir_writable": False,
        "custom_apps_file_exists": CUSTOM_APPS_FILE.exists(),
        "storage_dir_path": str(STORAGE_DIR),
        "base_dir_path": str(BASE_DIR),
    }

    # Test write capability
    test_file = STORAGE_DIR / ".health_check"
    try:
        test_file.write_text("ok")
        health["storage_dir_writable"] = True
        test_file.unlink()
    except Exception as e:
        health["storage_write_error"] = str(e)
        logger.warning(f"Storage write test failed: {e}")

    return health


@app.post("/api/custom-apps")
def create_custom_app(payload: CustomAppPayload) -> dict[str, Any]:
    try:
        # Validate URL
        try:
            parsed = urlparse(payload.url)
            if parsed.scheme not in ["http", "https"]:
                raise HTTPException(status_code=400, detail="Only HTTPS URLs are allowed")
            if parsed.scheme != "https":
                raise HTTPException(status_code=400, detail="Only HTTPS URLs are allowed")
        except HTTPException:
            raise
        except Exception as e:
            logger.error(f"URL parse error: {e}")
            raise HTTPException(status_code=400, detail="Invalid URL")

        # Validate color format
        if not payload.backgroundColor.startswith("#") or len(payload.backgroundColor) != 7:
            raise HTTPException(status_code=400, detail="Invalid color format")

        # Generate app ID and display name
        app_id = hashlib.md5(payload.url.encode()).hexdigest()[:12]
        display_name = get_domain_name(payload.url)

        # Load existing apps
        apps = load_custom_apps()

        # Check for duplicates
        for existing_app in apps.values():
            if existing_app.get("url") == payload.url:
                raise HTTPException(status_code=400, detail="This URL is already added")

        # Create new app
        new_app = {
            "id": app_id,
            "url": payload.url,
            "backgroundColor": payload.backgroundColor,
            "displayName": display_name,
        }

        apps[app_id] = new_app
        save_custom_apps(apps)

        logger.info(f"Created custom app: {app_id} ({display_name}) -> {payload.url}")
        return new_app
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error creating custom app: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to create app: {str(e)}")


@app.delete("/api/custom-apps/{app_id}")
def delete_custom_app(app_id: str) -> dict[str, Any]:
    apps = load_custom_apps()

    if app_id not in apps:
        raise HTTPException(status_code=404, detail="App not found")

    app_name = apps[app_id].get("displayName", app_id)
    del apps[app_id]
    save_custom_apps(apps)

    logger.info(f"Deleted custom app: {app_id} ({app_name})")
    return {"message": "App deleted successfully"}


@app.get("/api/files")
def list_files(root: str = Query(default="ritepath"), path: str = Query(default="")) -> dict[str, Any]:
    base, target, root_id = resolve_safe_path(root, path)
    if not target.exists():
        raise HTTPException(status_code=404, detail="Folder not found")
    if not target.is_dir():
        raise HTTPException(status_code=400, detail="Path is not a folder")

    items = sorted(target.iterdir(), key=lambda item: (not item.is_dir(), item.name.lower()))
    parent_path = None
    if target != base:
        parent_path = str(target.parent.relative_to(base)).replace("\\", "/")
        if parent_path == ".":
            parent_path = ""

    return {
        "root_id": root_id,
        "root_label": next((entry["label"] for entry in discover_files_roots() if entry["id"] == root_id), "RitePath Files"),
        "current_path": "" if target == base else str(target.relative_to(base)).replace("\\", "/"),
        "parent_path": parent_path,
        "roots": discover_files_roots(),
        "items": [file_entry(item, root_id) for item in items],
    }


@app.get("/api/files/content")
def file_content(root: str = Query(default="ritepath"), path: str = Query(...)) -> FileResponse:
    _, target, _ = resolve_safe_path(root, path)
    if not target.exists() or target.is_dir():
        raise HTTPException(status_code=404, detail="File not found")
    return FileResponse(target)
