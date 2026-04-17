"""
Service d'import depuis internet.
Télécharge un paquet et toutes ses dépendances directement depuis les URLs
de l'index SQLite (Packages.gz), les valide, et les ajoute au repo interne.
"""
import os
import shutil
import subprocess
import tempfile
import urllib.request
import urllib.error
from pathlib import Path
from typing import Generator

POOL_DIR = Path(os.getenv("POOL_DIR", "/repos/pool"))
IMPORTS_DIR = Path(os.getenv("IMPORTS_DIR", "/repos/imports"))
ADD_DEB_SCRIPT = os.getenv("ADD_DEB_SCRIPT", "/scripts/add-deb.sh")


def _run(cmd: list[str], cwd: str = None) -> tuple[int, str, str]:
    """Exécute une commande et retourne (returncode, stdout, stderr)."""
    result = subprocess.run(
        cmd, capture_output=True, text=True, cwd=cwd
    )
    return result.returncode, result.stdout, result.stderr


def _get_source_base_url(source_url: str) -> str:
    """
    Extrait l'URL de base depuis l'URL Packages.gz.
    Ex: http://archive.ubuntu.com/ubuntu/dists/jammy/.../Packages.gz
     →  http://archive.ubuntu.com/ubuntu
    """
    return source_url.split("/dists/")[0]


def _download_deb(pkg_name: str, tmp_dir: str) -> tuple[Path | None, str, str | None]:
    """
    Télécharge un .deb depuis l'index SQLite local.
    Retourne (chemin_fichier, source_label, sha256_attendu) ou (None, message_erreur, None).
    """
    from services.package_index import get_package_info as index_get_info, DEFAULT_SOURCES

    row = index_get_info(pkg_name)
    if not row or not row.get("filename"):
        return None, f"'{pkg_name}' introuvable dans l'index — lancez une synchronisation", None

    source = next((s for s in DEFAULT_SOURCES if s["id"] == row["source_id"]), None)
    if not source:
        return None, f"Source '{row['source_id']}' inconnue", None

    base_url = _get_source_base_url(source["url"])
    download_url = f"{base_url}/{row['filename']}"
    expected_sha256 = row.get("sha256")  # SHA256 depuis Packages.gz

    filename = Path(row["filename"]).name
    dest = Path(tmp_dir) / filename

    try:
        req = urllib.request.Request(
            download_url,
            headers={"User-Agent": "APT-Repo-Manager/2.0"}
        )
        with urllib.request.urlopen(req, timeout=60) as resp:
            dest.write_bytes(resp.read())
        return dest, source["label"], expected_sha256
    except urllib.error.URLError as e:
        return None, f"Erreur téléchargement {pkg_name}: {e}", None


def resolve_deps_online(package_name: str) -> dict:
    """
    Résout les dépendances d'un paquet depuis l'index SQLite.
    """
    from services.package_index import get_package_info as index_get_info
    from services.indexer import get_package_info as repo_get_info

    row = index_get_info(package_name)
    if not row:
        return {
            "success": False,
            "error": f"Paquet '{package_name}' introuvable dans l'index local. "
                     "Lancez une synchronisation d'abord.",
            "packages": [],
        }

    # Résoudre les dépendances depuis le champ depends de l'index
    dep_names = {package_name}
    if row.get("depends"):
        for part in row["depends"].split(","):
            part = part.strip().split(" ")[0]  # "curl (>= 7.0)" → "curl"
            if part and all(c.isalnum() or c in ".-+_" for c in part):
                dep_names.add(part)

    packages = []
    for dep in sorted(dep_names):
        already_present = repo_get_info(dep) is not None
        packages.append({"name": dep, "already_in_repo": already_present})

    to_download = [p for p in packages if not p["already_in_repo"]]

    return {
        "success": True,
        "package": package_name,
        "total_deps": len(packages),
        "already_in_repo": len(packages) - len(to_download),
        "to_download": len(to_download),
        "packages": packages,
    }


def import_package_stream(package_name: str, user: str, group: str | None = None, distribution: str | None = None) -> Generator[str, None, None]:
    """
    Télécharge un paquet et ses dépendances, les valide et les ajoute au repo.
    Génère des messages de log en temps réel (Server-Sent Events).
    """
    from services.validator import run_validation_pipeline
    from services.manifest import generate_manifest, save_manifest
    from services.indexer import add_to_index, get_package_info as repo_get_info
    from services.package_index import get_package_info as index_get_info
    from services.audit import log as audit_log
    from services.distributions import detect_distribution_from_source

    def emit(msg: str, level: str = "info") -> str:
        return f"data: {level}|{msg}\n\n"

    yield emit(f"Démarrage de l'import de '{package_name}'...")

    tmp_dir = tempfile.mkdtemp(prefix="apt-import-")

    try:
        # 1. Vérifier que le paquet est dans l'index
        row = index_get_info(package_name)
        # Auto-détecter la distribution depuis la source si non fournie
        target_distrib = distribution or detect_distribution_from_source(row.get("source_id", "") if row else "")
        yield emit(f"Distribution cible : {target_distrib}")
        if not row:
            yield emit(
                f"Paquet '{package_name}' introuvable dans l'index local. "
                "Lancez une synchronisation depuis l'onglet Synchronisation.",
                "error"
            )
            return

        # 2. Résolution des dépendances depuis l'index SQLite
        yield emit("Résolution des dépendances...")
        dep_names = {package_name}
        if row.get("depends"):
            for part in row["depends"].split(","):
                name = part.strip().split(" ")[0].split("|")[0].strip()
                if name and all(c.isalnum() or c in ".-+_" for c in name):
                    dep_names.add(name)

        # Filtrer ceux déjà dans le repo
        to_download = []
        skipped = []
        for dep in sorted(dep_names):
            if repo_get_info(dep) is not None:
                skipped.append(dep)
            else:
                to_download.append(dep)

        yield emit(
            f"Trouvé {len(dep_names)} paquet(s) — "
            f"{len(skipped)} déjà présent(s), {len(to_download)} à télécharger"
        )

        if not to_download:
            yield emit("Tous les paquets sont déjà dans le repo !", "success")
            return

        for name in skipped:
            yield emit(f"  ⏭  {name} — déjà dans le repo", "skip")

        # 3. Téléchargement direct depuis les URLs de l'index
        yield emit("Téléchargement depuis internet...")
        downloaded = []
        sha256_map = {}  # path → expected_sha256
        for pkg in to_download:
            yield emit(f"  ⬇  {pkg}...")
            path, info, expected_sha256 = _download_deb(pkg, tmp_dir)
            if path:
                downloaded.append(path)
                if expected_sha256:
                    sha256_map[str(path)] = expected_sha256
                yield emit(f"     OK ({info})", "success")
            else:
                yield emit(f"     Ignoré : {info}", "warning")

        if not downloaded:
            yield emit("Aucun fichier .deb téléchargé.", "error")
            audit_log("IMPORT", user, "FAILURE", package=package_name,
                      detail="Aucun .deb téléchargé")
            return

        yield emit(f"{len(downloaded)} fichier(s) téléchargé(s)")

        # 4. Validation + ajout au repo
        imported = []
        failed = []

        # Répertoire du groupe d'import (groupe explicite ou nom du paquet)
        group_dir = IMPORTS_DIR / (group or package_name)
        group_dir.mkdir(parents=True, exist_ok=True)

        for deb_path in downloaded:
            yield emit(f"Validation de {deb_path.name}...")
            expected_sha256 = sha256_map.get(str(deb_path))
            validation = run_validation_pipeline(str(deb_path), expected_sha256=expected_sha256, strict_deps=False)
            # Émettre le résultat de chaque étape de sécurité
            for step in validation.steps:
                if step["name"] == "provenance":
                    icon = "✅" if step["passed"] else "❌"
                    yield emit(f"     {icon} Provenance : {step['message']}", "success" if step["passed"] else "error")
                elif step["name"] == "antivirus":
                    icon = "✅" if step["passed"] else "❌"
                    yield emit(f"     {icon} Antivirus  : {step['message']}", "success" if step["passed"] else "error")

            if not validation.passed:
                yield emit(f"  ❌ {deb_path.name} — validation échouée", "error")
                failed.append(deb_path.name)
                continue

            # Copie dans le pool principal (pour reprepro)
            dest = POOL_DIR / deb_path.name
            shutil.copy2(str(deb_path), str(dest))

            # Copie dans le répertoire du groupe d'import
            shutil.copy2(str(deb_path), str(group_dir / deb_path.name))

            manifest = generate_manifest(
                str(dest),
                imported_by=user,
                import_method="internet",
                validated_deps=validation.deps if validation.deps else None,
                import_group=group or package_name,
                validation_steps=validation.steps,
                distribution=target_distrib,
            )
            save_manifest(manifest)
            add_to_index(manifest)

            subprocess.run(
                ["sh", ADD_DEB_SCRIPT, target_distrib, dest.name],
                capture_output=True, text=True
            )

            audit_log("IMPORT", user, "SUCCESS",
                      package=manifest["name"],
                      version=manifest["version"],
                      detail=f"importé depuis internet, sha256={manifest['integrity']['sha256']}")

            yield emit(f"  ✅ {manifest['name']} {manifest['version']} — ajouté au repo", "success")
            imported.append(manifest["name"])

        # 5. Résumé final
        yield emit("─" * 50)
        yield emit(
            f"Import terminé : {len(imported)} ajouté(s), "
            f"{len(skipped)} déjà présent(s), {len(failed)} échoué(s)",
            "success" if not failed else "warning"
        )
        if failed:
            yield emit(f"Échecs : {', '.join(failed)}", "warning")

    except Exception as e:
        yield emit(f"Erreur inattendue : {e}", "error")

    finally:
        shutil.rmtree(tmp_dir, ignore_errors=True)
