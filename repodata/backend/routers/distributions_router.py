"""
Routes pour la gestion des distributions reprepro enterprise.
- GET  /distributions/          → liste + stats (nb paquets par distrib)
- GET  /distributions/{codename}/packages → paquets dans une distribution
- POST /distributions/promote   → promouvoir un paquet d'une distrib vers une autre
- POST /distributions/migrate   → migration en masse (ex: bookworm → jammy)
- POST /distributions/init      → initialise les dists/ reprepro pour les nouvelles distribs
"""
import json
from pathlib import Path
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel

from auth.dependencies import get_current_user, get_admin_user, get_uploader_user, get_maintainer_user
from services.distributions import (
    ENTERPRISE_DISTRIBUTIONS, VALID_CODENAMES,
    get_distribution_stats, list_packages_in_distrib,
    promote_package, migrate_all,
)
from services.audit import log as audit_log

router = APIRouter(prefix="/distributions", tags=["Distributions"])

MANIFEST_DIR = Path("/repos/manifests")


# ─── Liste & stats ────────────────────────────────────────────────────────────

@router.get("/")
def list_distributions(current_user: str = Depends(get_current_user)):
    """Liste toutes les distributions avec leur nombre de paquets."""
    return {"distributions": get_distribution_stats()}


# ─── Paquets d'une distribution ───────────────────────────────────────────────

@router.get("/{codename}/packages")
def get_distrib_packages(
    codename: str,
    current_user: str = Depends(get_current_user),
):
    """Liste les paquets dans une distribution spécifique."""
    if codename not in VALID_CODENAMES:
        raise HTTPException(status_code=400, detail=f"Distribution inconnue : {codename}")
    packages = list_packages_in_distrib(codename)
    return {"codename": codename, "packages": packages, "total": len(packages)}


# ─── Promotion ────────────────────────────────────────────────────────────────

class PromoteRequest(BaseModel):
    package: str
    from_dist: str
    to_dist: str


@router.post("/promote")
def promote(
    req: PromoteRequest,
    current_user: str = Depends(get_maintainer_user),
):
    """
    Promeut un paquet d'une distribution vers une autre.
    Ex : jammy → noble pour déployer en production.
    """
    if req.from_dist not in VALID_CODENAMES or req.to_dist not in VALID_CODENAMES:
        raise HTTPException(status_code=400, detail="Distribution invalide")
    if req.from_dist == req.to_dist:
        raise HTTPException(status_code=400, detail="Source et destination identiques")

    ok, message = promote_package(req.package, req.from_dist, req.to_dist)
    if not ok:
        raise HTTPException(status_code=500, detail=message)

    audit_log("PROMOTE", current_user, "SUCCESS",
              package=req.package,
              detail=f"{req.from_dist} → {req.to_dist}")

    return {"status": "ok", "message": message,
            "package": req.package, "from": req.from_dist, "to": req.to_dist}


# ─── Migration en masse ───────────────────────────────────────────────────────

class MigrateRequest(BaseModel):
    from_dist: str
    to_dist: str


@router.post("/migrate")
def migrate(
    req: MigrateRequest,
    current_user: str = Depends(get_maintainer_user),
):
    """
    Copie TOUS les paquets de from_dist vers to_dist.
    Utilisé pour la migration initiale bookworm → jammy.
    Aussi met à jour les manifests locaux avec la nouvelle distribution.
    """
    if req.from_dist not in VALID_CODENAMES or req.to_dist not in VALID_CODENAMES:
        raise HTTPException(status_code=400, detail="Distribution invalide")
    if req.from_dist == req.to_dist:
        raise HTTPException(status_code=400, detail="Source et destination identiques")

    count, copied, errors = migrate_all(req.from_dist, req.to_dist)

    # Mettre à jour les manifests : changer distribution si c'est from_dist
    updated_manifests = 0
    if MANIFEST_DIR.exists():
        for mf_path in MANIFEST_DIR.glob("*.manifest.json"):
            try:
                with open(mf_path) as f:
                    mf = json.load(f)
                if mf.get("distribution", "jammy") == req.from_dist:
                    mf["distribution"] = req.to_dist
                    with open(mf_path, "w") as f:
                        json.dump(mf, f, indent=2, ensure_ascii=False)
                    updated_manifests += 1
            except Exception:
                continue

    # Reconstruire l'index depuis les manifests mis à jour
    if updated_manifests > 0:
        from services.indexer import sync_index_from_pool
        sync_index_from_pool()

    audit_log("MIGRATE", current_user, "SUCCESS",
              detail=f"{count} paquets migrés de {req.from_dist} vers {req.to_dist}")

    return {
        "status": "ok",
        "from": req.from_dist,
        "to": req.to_dist,
        "migrated": count,
        "packages": copied,
        "errors": errors,
        "manifests_updated": updated_manifests,
    }


# ─── Initialisation des distributions ─────────────────────────────────────────

@router.post("/init")
def init_distributions(current_user: str = Depends(get_maintainer_user)):
    """
    Initialise les dists/ reprepro pour toutes les distributions configurées.
    Exécute `reprepro export` pour chaque distribution.
    """
    import subprocess
    results = []
    for dist in ENTERPRISE_DISTRIBUTIONS:
        result = subprocess.run(
            ["docker", "exec", "depot-apt",
             "reprepro", "-b", "/usr/share/nginx/html/repos",
             "export", dist["codename"]],
            capture_output=True, text=True
        )
        results.append({
            "codename": dist["codename"],
            "ok": result.returncode == 0,
            "output": (result.stdout + result.stderr).strip()[:200],
        })

    audit_log("INIT_DISTS", current_user, "SUCCESS",
              detail=f"Initialisation de {len(ENTERPRISE_DISTRIBUTIONS)} distributions")

    return {"results": results}
