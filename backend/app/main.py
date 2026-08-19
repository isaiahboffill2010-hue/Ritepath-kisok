from __future__ import annotations

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

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

APP_START = time.time()
BASE_DIR = Path(__file__).resolve().parent.parent
FILES_ROOT = (BASE_DIR / "storage" / "ritepath").resolve()

app = FastAPI(title="RitePath Kiosk API", version="3.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


class VolumePayload(BaseModel):
    volume: int = Field(ge=0, le=100)


class WifiConnectPayload(BaseModel):
    ssid: str = Field(min_length=1, max_length=128)
    password: str = Field(default="", max_length=256)


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
    if shutil.which("pactl"):
        result = run_command(["pactl", "get-sink-volume", "@DEFAULT_SINK@"])
        if result.returncode == 0:
            match = re.search(r"(\d+)%", result.stdout)
            volume = int(match.group(1)) if match else 50
            muted = "yes" in result.stdout.lower()
            return {"volume": volume, "muted": muted}

    if shutil.which("amixer"):
        result = run_command(["amixer", "get", "Master"])
        if result.returncode == 0:
            matches = re.findall(r"\[(\d+)%\].*\[(on|off)\]", result.stdout, re.IGNORECASE)
            if matches:
                volume, mute_state = matches[-1]
                return {"volume": int(volume), "muted": mute_state.lower() == "off"}

    return {"volume": 50, "muted": False}


def set_volume_value(volume: int) -> dict[str, Any]:
    if shutil.which("pactl"):
        run_command(["pactl", "set-sink-volume", "@DEFAULT_SINK@", f"{volume}%"])
    elif shutil.which("amixer"):
        run_command(["amixer", "-q", "set", "Master", f"{volume}%"])
    return get_volume()


def get_wifi_info() -> dict[str, Any]:
    available = shutil.which("nmcli") is not None
    response: dict[str, Any] = {
        "connected": False,
        "ssid": None,
        "ip_address": None,
        "signal": None,
        "networks": [],
        "available": available,
        "error": None,
    }

    if not available:
        response["error"] = "nmcli not available"
        return response

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
                response["signal"] = int(signal) if signal.isdigit() else None
                break

    ip = run_command(["hostname", "-I"])
    if ip.returncode == 0:
        response["ip_address"] = ip.stdout.strip().split()[0] if ip.stdout.strip() else None

    scan = run_command(["nmcli", "-t", "-f", "SSID,SIGNAL,SECURITY,IN-USE", "dev", "wifi", "list"])
    if scan.returncode == 0:
        networks = []
        for line in scan.stdout.splitlines():
            parts = line.split(":")
            if len(parts) < 4:
                continue
            ssid, signal, security, in_use = parts[:4]
            networks.append(
                {
                    "ssid": ssid,
                    "signal": int(signal) if signal.isdigit() else None,
                    "security": security or None,
                    "connected": in_use.strip() == "*",
                }
            )
        response["networks"] = networks

    return response


def connect_wifi_network(ssid: str, password: str) -> dict[str, Any]:
    if shutil.which("nmcli") is None:
        raise HTTPException(status_code=503, detail="nmcli not available")

    command = ["nmcli", "dev", "wifi", "connect", ssid]
    if password:
        command.extend(["password", password])
    result = run_command(command)
    if result.returncode != 0:
        raise HTTPException(status_code=400, detail=result.stderr.strip() or "Unable to connect to Wi-Fi")
    return get_wifi_info()


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
