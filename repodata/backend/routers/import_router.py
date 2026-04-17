"""
Routes pour l'import de paquets depuis internet.
- GET  /import/search?q=nginx        → recherche dans l'index local
- GET  /import/resolve/{name}        → résout les dépendances online
- POST /import/fetch                 → lance l'import (streaming SSE)
- POST /import/batch                 → importe une liste de paquets
- GET  /import/sync-status           → statut des sources indexées
- POST /import/sync                  → (re)synchronise l'index local
- POST /import/sync/{source_id}      → synchronise une source précise
"""
import json
import os
from datetime import datetime, timezone
from pathlib import Path
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from auth.dependencies import get_current_user, get_uploader_user, get_admin_user
from services.package_index import (
    search_packages, get_package_info as index_get_info,
    get_sync_status, sync_source, sync_all, is_indexed, DEFAULT_SOURCES,
)
from services.importer import resolve_deps_online, import_package_stream
from services.audit import log as audit_log

IMPORTS_DIR = Path(os.getenv("IMPORTS_DIR", "/repos/imports"))

router = APIRouter(prefix="/import", tags=["Import"])


# ─── Recherche ────────────────────────────────────────────────────────────────

@router.get("/search")
def search(
    q: str = Query(..., min_length=1, description="Terme de recherche"),
    limit: int = Query(20, ge=1, le=100),
    source_id: str = Query(None),
    current_user: str = Depends(get_current_user),
):
    """
    Recherche dans l'index local (Packages.gz mis en cache).
    Ne nécessite pas de connexion internet au moment de la recherche.
    """
    if not is_indexed():
        raise HTTPException(
            status_code=424,
            detail="L'index local est vide. Lancez une synchronisation d'abord."
        )

    results = search_packages(q, limit=limit, source_id=source_id)
    return {"query": q, "count": len(results), "results": results}


# ─── Résolution des dépendances ───────────────────────────────────────────────

@router.get("/resolve/{package_name}")
def resolve(
    package_name: str,
    current_user: str = Depends(get_current_user),
):
    """
    Résout les dépendances d'un paquet en temps réel via apt-cache.
    Indique pour chaque dépendance si elle est déjà dans le repo interne.
    """
    result = resolve_deps_online(package_name)
    if not result["success"]:
        raise HTTPException(status_code=404, detail=result["error"])
    return result


# ─── Import ───────────────────────────────────────────────────────────────────

class ImportRequest(BaseModel):
    package: str
    group: str | None = None         # groupe d'import cible (défaut = nom du paquet)
    distribution: str | None = None  # distribution cible (défaut = auto-détection depuis source)


class BatchImportRequest(BaseModel):
    packages: list[str]
    group: str | None = None         # tous les paquets du batch vont dans ce groupe
    distribution: str | None = None  # distribution cible pour tous les paquets


@router.post("/fetch")
def fetch_package(
    request: ImportRequest,
    current_user: str = Depends(get_uploader_user),
):
    """
    Télécharge un paquet et ses dépendances depuis internet,
    les valide et les ajoute au repo.
    Retourne un stream Server-Sent Events pour les logs en temps réel.
    """
    audit_log("IMPORT", current_user, "START",
              package=request.package,
              detail="Import depuis internet lancé")

    def event_stream():
        for chunk in import_package_stream(
            request.package, current_user,
            group=request.group,
            distribution=request.distribution,
        ):
            yield chunk
        yield "data: done|DONE\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        }
    )


@router.post("/batch")
def batch_import(
    request: BatchImportRequest,
    current_user: str = Depends(get_uploader_user),
):
    """
    Import par lot : stream SSE pour une liste de paquets.
    """
    if not request.packages:
        raise HTTPException(status_code=400, detail="Liste de paquets vide")

    if len(request.packages) > 50:
        raise HTTPException(status_code=400, detail="Maximum 50 paquets par batch")

    def event_stream():
        for pkg in request.packages:
            yield f"data: info|=== Import de {pkg} ===\n\n"
            for chunk in import_package_stream(
                pkg, current_user,
                group=request.group,
                distribution=request.distribution,
            ):
                yield chunk
        yield "data: done|DONE\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


# ─── Sync de l'index ─────────────────────────────────────────────────────────

@router.get("/sync-status")
def get_status(current_user: str = Depends(get_current_user)):
    """Retourne le statut de synchronisation de chaque source APT."""
    return {"sources": get_sync_status()}


@router.post("/sync")
def sync_index(current_user: str = Depends(get_uploader_user)):
    """
    (Re)synchronise l'index local depuis toutes les sources upstream.
    Télécharge uniquement les métadonnées (Packages.gz), pas les binaires.
    """
    def event_stream():
        sources = DEFAULT_SOURCES
        for source in sources:
            yield f"data: info|Synchronisation de {source['label']}...\n\n"
            result = sync_source(source)
            if result["status"] == "ok":
                yield f"data: success|✅ {source['label']} — {result['pkg_count']} paquets indexés\n\n"
            else:
                yield f"data: error|❌ {source['label']} — {result.get('error', 'Erreur inconnue')}\n\n"

        audit_log("SYNC", current_user, "SUCCESS", detail="Index APT synchronisé")
        yield "data: success|Synchronisation terminée\n\n"
        yield "data: done|DONE\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


# ─── Groupes d'import ────────────────────────────────────────────────────────

@router.get("/groups")
def list_import_groups(current_user: str = Depends(get_current_user)):
    """Liste tous les groupes d'import (un répertoire par paquet importé)."""
    IMPORTS_DIR.mkdir(parents=True, exist_ok=True)
    groups = []
    for group_dir in sorted(IMPORTS_DIR.iterdir()):
        if not group_dir.is_dir():
            continue
        debs = sorted(group_dir.glob("*.deb"))
        if not debs:
            continue
        total_size = sum(f.stat().st_size for f in debs)
        # Date de création = date du fichier le plus ancien
        imported_at = min(f.stat().st_mtime for f in debs)
        groups.append({
            "name": group_dir.name,
            "package_count": len(debs),
            "total_size_bytes": total_size,
            "imported_at": datetime.fromtimestamp(imported_at, tz=timezone.utc).isoformat(),
            "packages": [
                {
                    "filename": f.name,
                    "size_bytes": f.stat().st_size,
                }
                for f in debs
            ],
        })
    return {"groups": groups}


@router.delete("/groups/{group_name}")
def delete_import_group(
    group_name: str,
    current_user: str = Depends(get_admin_user),
):
    """Supprime un groupe d'import (les fichiers dans /repos/imports/{name})."""
    import re, shutil
    if not re.match(r'^[\w.\-+]+$', group_name):
        raise HTTPException(status_code=400, detail="Nom de groupe invalide")
    group_dir = IMPORTS_DIR / group_name
    if not group_dir.exists():
        raise HTTPException(status_code=404, detail=f"Groupe '{group_name}' introuvable")
    shutil.rmtree(str(group_dir))
    audit_log("IMPORT_GROUP_DELETE", current_user, "SUCCESS", detail=f"Groupe '{group_name}' supprimé")
    return {"deleted": group_name}


@router.post("/sync/{source_id}")
def sync_one_source(
    source_id: str,
    current_user: str = Depends(get_current_user),
):
    """Synchronise une source spécifique."""
    source = next((s for s in DEFAULT_SOURCES if s["id"] == source_id), None)
    if not source:
        raise HTTPException(status_code=404, detail=f"Source '{source_id}' inconnue")

    result = sync_source(source)
    if result["status"] == "error":
        raise HTTPException(status_code=502, detail=result.get("error"))

    return result
