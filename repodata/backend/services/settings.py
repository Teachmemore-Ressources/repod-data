"""
Service de persistance des paramètres de l'application.
Stockage : /repos/settings.json (volume Docker partagé → survit aux restarts).

Structure complète avec valeurs par défaut :
{
  "sync": { "enabled": true, "hour": 3, "minute": 0 },
  "sources": { "ubuntu-jammy": true, ... },
  "notifications": { "webhook_url": "", "webhook_enabled": false, "webhook_min_packages": 1 },
  "retention": { "audit_days": 90, "import_cleanup_days": 30 },
  "validation": { "sha256_check": true, "clamav_scan": true, "max_upload_size_mb": 500 }
}
"""

import copy
import json
import os
from pathlib import Path
from threading import Lock

SETTINGS_PATH = Path(os.getenv("SETTINGS_PATH", "/repos/settings.json"))

_lock = Lock()

DEFAULT_SETTINGS: dict = {
    "sync": {
        "enabled": True,
        "hour": 3,
        "minute": 0,
    },
    "sources": {
        "ubuntu-jammy": True,
        "ubuntu-jammy-updates": True,
        "ubuntu-noble": True,
        "ubuntu-focal": True,
        "debian-bookworm": True,
        "ubuntu-jammy-security": True,
        "ubuntu-noble-security": True,
        "ubuntu-focal-security": True,
        "debian-bookworm-security": True,
    },
    "notifications": {
        "webhook_url": "",
        "webhook_enabled": False,
        "webhook_min_packages": 1,
    },
    "retention": {
        "audit_days": 90,
        "import_cleanup_days": 30,
    },
    "validation": {
        "sha256_check": True,
        "clamav_scan": True,
        "max_upload_size_mb": 500,
    },
}


def _deep_merge(base: dict, override: dict) -> dict:
    """Fusion profonde : override écrase base, les clés absentes de override restent intactes."""
    result = copy.deepcopy(base)
    for key, value in override.items():
        if key in result and isinstance(result[key], dict) and isinstance(value, dict):
            result[key] = _deep_merge(result[key], value)
        else:
            result[key] = value
    return result


def get_settings() -> dict:
    """
    Charge les paramètres depuis settings.json.
    Si le fichier est absent ou corrompu, retourne les valeurs par défaut.
    Fusionne toujours avec DEFAULT_SETTINGS pour garantir les nouvelles clés.
    """
    with _lock:
        if not SETTINGS_PATH.exists():
            return copy.deepcopy(DEFAULT_SETTINGS)
        try:
            with open(SETTINGS_PATH, "r", encoding="utf-8") as f:
                stored = json.load(f)
            return _deep_merge(DEFAULT_SETTINGS, stored)
        except Exception:
            return copy.deepcopy(DEFAULT_SETTINGS)


def update_settings(partial: dict) -> dict:
    """
    Met à jour les paramètres en fusionnant avec les valeurs existantes.
    Écrit immédiatement sur disque.
    Retourne les paramètres complets mis à jour.
    """
    with _lock:
        current = get_settings()
        merged = _deep_merge(current, partial)
        SETTINGS_PATH.parent.mkdir(parents=True, exist_ok=True)
        with open(SETTINGS_PATH, "w", encoding="utf-8") as f:
            json.dump(merged, f, indent=2, ensure_ascii=False)
        return merged


def is_source_enabled(source_id: str) -> bool:
    """Retourne True si la source APT est activée dans les paramètres."""
    settings = get_settings()
    return settings["sources"].get(source_id, True)
