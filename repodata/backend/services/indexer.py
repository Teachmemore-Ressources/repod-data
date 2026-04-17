"""
Gestion de l'index central index.json.
Catalogue immuable de tous les artefacts validés dans le dépôt.
"""
import json
import os
from datetime import datetime, timezone
from pathlib import Path
from threading import Lock

INDEX_PATH = Path(os.getenv("INDEX_PATH", "/repos/manifests/index.json"))
INDEX_PATH.parent.mkdir(parents=True, exist_ok=True)

_lock = Lock()


def _load_index() -> dict:
    if not INDEX_PATH.exists():
        return {"version": "1.0", "updated_at": None, "packages": {}}
    with open(INDEX_PATH) as f:
        return json.load(f)


def _save_index(index: dict):
    index["updated_at"] = datetime.now(timezone.utc).isoformat()
    with open(INDEX_PATH, "w") as f:
        json.dump(index, f, indent=2, ensure_ascii=False)


def add_to_index(manifest: dict):
    """Ajoute ou met à jour un artefact dans l'index."""
    with _lock:
        index = _load_index()
        name = manifest["name"]

        if name not in index["packages"]:
            index["packages"][name] = {"versions": {}}

        version = manifest["version"]
        index["packages"][name]["versions"][version] = {
            "arch": manifest.get("arch", "unknown"),
            "filename": manifest.get("filename"),
            "sha256": manifest["integrity"]["sha256"],
            "size_bytes": manifest.get("file_size_bytes", 0),
            "imported_at": manifest["source"]["imported_at"],
            "imported_by": manifest["source"]["imported_by"],
            "status": manifest.get("status", "validated"),
            "distribution": manifest.get("distribution", "jammy"),
            "deps_missing": [
                d["name"] for d in manifest.get("dependencies", [])
                if not d.get("available_internally", True)
            ],
        }

        # Mettre à jour la version "latest"
        versions = index["packages"][name]["versions"]
        index["packages"][name]["latest"] = sorted(versions.keys())[-1]
        index["packages"][name]["description"] = manifest.get("description", "")
        index["packages"][name]["section"] = manifest.get("section", "")

        _save_index(index)


def remove_from_index(name: str, version: str | None = None):
    """Supprime un artefact ou une version spécifique de l'index."""
    with _lock:
        index = _load_index()
        if name not in index["packages"]:
            return

        if version:
            index["packages"][name]["versions"].pop(version, None)
            if not index["packages"][name]["versions"]:
                del index["packages"][name]
            else:
                remaining = list(index["packages"][name]["versions"].keys())
                index["packages"][name]["latest"] = sorted(remaining)[-1]
        else:
            del index["packages"][name]

        _save_index(index)


def get_index() -> dict:
    with _lock:
        return _load_index()


def get_package_info(name: str) -> dict | None:
    with _lock:
        index = _load_index()
        return index["packages"].get(name)


def list_packages_from_index() -> list[dict]:
    """Retourne la liste enrichie des paquets depuis l'index.
    deps_missing est recalculé dynamiquement à chaque appel."""
    with _lock:
        index = _load_index()
        known_packages = set(index["packages"].keys())
        packages = []
        for name, info in index["packages"].items():
            latest = info.get("latest")
            latest_info = info["versions"].get(latest, {})
            # Recalcul en temps réel : dep manquante = déclarée manquante ET toujours absente de l'index
            stored_missing = latest_info.get("deps_missing", [])
            deps_missing = [dep for dep in stored_missing if dep not in known_packages]
            packages.append({
                "name": name,
                "latest_version": latest,
                "versions": list(info["versions"].keys()),
                "arch": latest_info.get("arch", "unknown"),
                "sha256": latest_info.get("sha256", ""),
                "size_bytes": latest_info.get("size_bytes", 0),
                "imported_at": latest_info.get("imported_at", ""),
                "imported_by": latest_info.get("imported_by", ""),
                "status": latest_info.get("status", "validated"),
                "distribution": latest_info.get("distribution", "jammy"),
                "deps_missing": deps_missing,
                "description": info.get("description", ""),
                "section": info.get("section", ""),
            })
        return packages


def sync_index_from_pool():
    """
    Resynchronise l'index depuis les fichiers manifests existants.
    Utile pour reconstruire l'index après un import manuel.
    """
    from services.manifest import list_manifests
    with _lock:
        index = {"version": "1.0", "updated_at": None, "packages": {}}
        for manifest in list_manifests():
            name = manifest["name"]
            version = manifest["version"]
            if name not in index["packages"]:
                index["packages"][name] = {"versions": {}}
            index["packages"][name]["versions"][version] = {
                "arch": manifest.get("arch", "unknown"),
                "filename": manifest.get("filename"),
                "sha256": manifest["integrity"]["sha256"],
                "size_bytes": manifest.get("file_size_bytes", 0),
                "imported_at": manifest["source"]["imported_at"],
                "imported_by": manifest["source"]["imported_by"],
                "status": manifest.get("status", "validated"),
                "distribution": manifest.get("distribution", "jammy"),
                "deps_missing": [
                    d["name"] for d in manifest.get("dependencies", [])
                    if not d.get("available_internally", True)
                ],
            }
            versions = index["packages"][name]["versions"]
            index["packages"][name]["latest"] = sorted(versions.keys())[-1]
            index["packages"][name]["description"] = manifest.get("description", "")
            index["packages"][name]["section"] = manifest.get("section", "")
        _save_index(index)
        return len(index["packages"])
