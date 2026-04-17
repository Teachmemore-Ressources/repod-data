"""
Pipeline d'upload complet :
1. Réception du fichier → staging/incoming/
2. Validation (format, checksum, GPG, dépendances)
3. Si OK → déplacement vers pool/, génération manifest, mise à jour index
4. Si KO → déplacement vers staging/quarantine/
5. Audit log dans tous les cas
"""
import os
import shutil
import subprocess
from pathlib import Path
from fastapi import APIRouter, UploadFile, File, Form, Depends, HTTPException

from auth.dependencies import get_uploader_user
from services.validator import run_validation_pipeline
from services.manifest import generate_manifest, save_manifest
from services.indexer import add_to_index
from services.audit import log as audit_log

router = APIRouter(prefix="/upload", tags=["Upload"])

STAGING_INCOMING = Path(os.getenv("STAGING_INCOMING", "/repos/staging/incoming"))
STAGING_QUARANTINE = Path(os.getenv("STAGING_QUARANTINE", "/repos/staging/quarantine"))
POOL_DIR = Path(os.getenv("POOL_DIR", "/repos/pool"))
ADD_DEB_SCRIPT = os.getenv("ADD_DEB_SCRIPT", "/scripts/add-deb.sh")

for d in [STAGING_INCOMING, STAGING_QUARANTINE, POOL_DIR]:
    d.mkdir(parents=True, exist_ok=True)


@router.post("/")
async def upload_package(
    file: UploadFile = File(...),
    distribution: str = Form("jammy"),
    current_user: str = Depends(get_uploader_user),
):
    """
    Pipeline complet d'import d'un paquet .deb :
    - Validation format, checksum, GPG, dépendances
    - Génération du manifest
    - Mise à jour de l'index
    - Ajout au dépôt APT via reprepro
    """
    filename = file.filename
    if not filename:
        raise HTTPException(status_code=400, detail="Nom de fichier manquant")

    # Nettoyage du nom de fichier (sécurité)
    safe_filename = Path(filename).name
    staging_path = STAGING_INCOMING / safe_filename

    # --- 1. Sauvegarde en staging ---
    try:
        with open(staging_path, "wb") as buf:
            shutil.copyfileobj(file.file, buf)
    except Exception as e:
        audit_log("UPLOAD", current_user, "FAILURE", package=safe_filename,
                  detail=f"Erreur écriture staging: {e}")
        raise HTTPException(status_code=500, detail="Erreur lors de la sauvegarde du fichier")

    # --- 2. Pipeline de validation ---
    validation = run_validation_pipeline(str(staging_path), strict_deps=False)

    # --- 3a. Rejet si validation échouée ---
    if not validation.passed:
        quarantine_path = STAGING_QUARANTINE / safe_filename
        shutil.move(str(staging_path), str(quarantine_path))
        audit_log(
            "VALIDATE", current_user, "FAILURE",
            package=safe_filename,
            detail="Validation échouée — déplacé en quarantaine",
            extra={"validation_steps": validation.steps},
        )
        return {
            "status": "rejected",
            "filename": safe_filename,
            "message": "Le paquet a été rejeté et mis en quarantaine",
            "validation": validation.to_dict(),
        }

    # --- 3b. Déplacement vers pool/ ---
    pool_path = POOL_DIR / safe_filename
    shutil.move(str(staging_path), str(pool_path))

    # --- 4. Génération du manifest ---
    # On passe les deps issues de la validation (avec available_internally renseigné)
    manifest = generate_manifest(
        str(pool_path),
        imported_by=current_user,
        validated_deps=validation.deps if validation.deps else None,
        validation_steps=validation.steps,
        distribution=distribution,
    )
    manifest_path = save_manifest(manifest)

    # --- 5. Mise à jour de l'index ---
    add_to_index(manifest)

    # --- 6. Ajout au repo APT via reprepro ---
    reprepro_result = subprocess.run(
        ["sh", ADD_DEB_SCRIPT, distribution, pool_path.name],
        capture_output=True, text=True
    )

    audit_log(
        "UPLOAD", current_user, "SUCCESS",
        package=manifest["name"],
        version=manifest["version"],
        detail=f"sha256={manifest['integrity']['sha256']}",
        extra={"validation_steps": validation.steps},
    )

    # Avertissements de dépendances (non bloquants)
    warnings = [
        s for s in validation.steps
        if s.get("warning") and not s["passed"]
    ]

    return {
        "status": "accepted",
        "filename": safe_filename,
        "package": manifest["name"],
        "version": manifest["version"],
        "arch": manifest["arch"],
        "sha256": manifest["integrity"]["sha256"],
        "validation": validation.to_dict(),
        "warnings": warnings,
        "message": f"{manifest['name']} {manifest['version']} ajouté au dépôt",
    }
