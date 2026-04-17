"""
Génération et lecture des manifests d'artefacts.
Chaque artefact .deb a un manifest JSON associé stocké dans /repos/manifests/.
"""
import json
import hashlib
import subprocess
import os
from datetime import datetime, timezone
from pathlib import Path

MANIFEST_DIR = Path(os.getenv("MANIFEST_DIR", "/repos/manifests"))
MANIFEST_DIR.mkdir(parents=True, exist_ok=True)


def compute_sha256(file_path: str) -> str:
    h = hashlib.sha256()
    with open(file_path, "rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


def compute_sha512(file_path: str) -> str:
    h = hashlib.sha512()
    with open(file_path, "rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


def parse_deb_info(deb_path: str) -> dict:
    """Extrait les métadonnées d'un .deb via dpkg-deb."""
    result = subprocess.run(
        ["dpkg-deb", "--info", deb_path],
        capture_output=True, text=True
    )
    info = {}
    for line in result.stdout.splitlines():
        if ":" in line:
            key, _, value = line.partition(":")
            info[key.strip().lower()] = value.strip()
    return info


def parse_deb_fields(deb_path: str) -> dict:
    """Extrait les champs de contrôle d'un .deb."""
    fields = {}
    for field in ["Package", "Version", "Architecture", "Depends",
                  "Description", "Maintainer", "Installed-Size", "Section"]:
        result = subprocess.run(
            ["dpkg-deb", "-f", deb_path, field],
            capture_output=True, text=True
        )
        val = result.stdout.strip()
        if val:
            fields[field.lower().replace("-", "_")] = val
    return fields


def parse_dependencies(depends_str: str) -> list[dict]:
    """Parse la chaîne Depends d'un .deb en liste structurée."""
    if not depends_str:
        return []
    deps = []
    for dep in depends_str.split(","):
        dep = dep.strip()
        if not dep:
            continue
        # Gérer les alternatives (a | b) — on prend la première
        dep = dep.split("|")[0].strip()
        if "(" in dep:
            name = dep[:dep.index("(")].strip()
            version_constraint = dep[dep.index("(")+1:dep.index(")")].strip()
        else:
            name = dep.strip()
            version_constraint = None
        if name:
            entry = {"name": name}
            if version_constraint:
                entry["version_constraint"] = version_constraint
            deps.append(entry)
    return deps


def generate_manifest(
    deb_path: str,
    imported_by: str = "system",
    import_method: str = "upload",
    validated_deps: list[dict] | None = None,
    import_group: str | None = None,
    validation_steps: list[dict] | None = None,
    distribution: str = "jammy",
) -> dict:
    """
    Génère un manifest complet pour un .deb.
    Si validated_deps est fourni (depuis le pipeline de validation),
    on l'utilise directement — il contient already available_internally.
    Sinon on parse les deps brutes sans vérification de disponibilité.
    """
    fields = parse_deb_fields(deb_path)
    file_size = os.path.getsize(deb_path)

    if validated_deps is not None:
        deps = validated_deps
    else:
        # Fallback : parse brut, available_internally non renseigné
        deps = parse_dependencies(fields.get("depends", ""))

    manifest = {
        "name": fields.get("package", Path(deb_path).stem),
        "version": fields.get("version", "unknown"),
        "arch": fields.get("architecture", "unknown"),
        "section": fields.get("section", "main"),
        "description": fields.get("description", ""),
        "maintainer": fields.get("maintainer", ""),
        "installed_size_kb": int(fields.get("installed_size", 0) or 0),
        "file_size_bytes": file_size,
        "filename": Path(deb_path).name,
        "type": "deb",
        "distribution": distribution,
        "source": {
            "imported_by": imported_by,
            "imported_at": datetime.now(timezone.utc).isoformat(),
            "import_method": import_method,
            "import_group": import_group,
        },
        "integrity": {
            "sha256": compute_sha256(deb_path),
            "sha512": compute_sha512(deb_path),
            "gpg_signed": False,
        },
        "dependencies": deps,
        "status": "validated",
        "tags": [],
        "validation_steps": validation_steps or [],
    }
    return manifest


def save_manifest(manifest: dict) -> str:
    """Sauvegarde un manifest et retourne son chemin."""
    name = manifest["name"]
    version = manifest["version"].replace(":", "_").replace("/", "_")
    arch = manifest["arch"]
    filename = f"{name}_{version}_{arch}.manifest.json"
    path = MANIFEST_DIR / filename
    with open(path, "w") as f:
        json.dump(manifest, f, indent=2, ensure_ascii=False)
    return str(path)


def load_manifest(name: str, version: str, arch: str = "amd64") -> dict | None:
    version_safe = version.replace(":", "_").replace("/", "_")
    filename = f"{name}_{version_safe}_{arch}.manifest.json"
    path = MANIFEST_DIR / filename
    if not path.exists():
        return None
    with open(path) as f:
        return json.load(f)


def list_manifests() -> list[dict]:
    """Retourne tous les manifests disponibles."""
    manifests = []
    for path in sorted(MANIFEST_DIR.glob("*.manifest.json")):
        try:
            with open(path) as f:
                manifests.append(json.load(f))
        except Exception:
            continue
    return manifests
