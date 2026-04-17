"""
Route dashboard :
- GET /dashboard/stats → toutes les métriques en une requête
"""
import os
from datetime import datetime, timezone, timedelta
from pathlib import Path
from fastapi import APIRouter, Depends

from auth.dependencies import get_current_user
from services.indexer import list_packages_from_index
from services.audit import get_recent_logs
from routers.security_router import _get_clamav_status

router = APIRouter(prefix="/dashboard", tags=["Dashboard"])

POOL_DIR = Path(os.getenv("POOL_DIR", "/repos/pool"))


@router.get("/stats")
def get_dashboard_stats(current_user: str = Depends(get_current_user)):
    packages = list_packages_from_index()

    # ── Stats paquets ──────────────────────────────────────────────────────────
    total_packages = len(packages)
    deps_missing = [p for p in packages if p.get("deps_missing")]
    total_size = sum(p.get("size_bytes", 0) for p in packages)

    # ── Activité audit (7 derniers jours) ─────────────────────────────────────
    logs = get_recent_logs(limit=500)
    today = datetime.now(timezone.utc).date()

    # Imports d'aujourd'hui
    imports_today = sum(
        1 for e in logs
        if e.get("action") in ("UPLOAD", "IMPORT")
        and e.get("result") == "SUCCESS"
        and e.get("timestamp", "")[:10] == str(today)
    )

    # Activité par jour sur 7 jours
    activity = {}
    for i in range(6, -1, -1):
        day = (today - timedelta(days=i)).isoformat()
        activity[day] = {"imports": 0, "failures": 0}

    for entry in logs:
        ts = entry.get("timestamp", "")[:10]
        if ts in activity:
            action = entry.get("action", "")
            result = entry.get("result", "")
            if action in ("UPLOAD", "IMPORT") and result == "SUCCESS":
                activity[ts]["imports"] += 1
            elif result == "FAILURE":
                activity[ts]["failures"] += 1

    activity_list = [
        {"date": day, **vals}
        for day, vals in activity.items()
    ]

    # ── Imports récents ────────────────────────────────────────────────────────
    recent_imports = [
        e for e in logs
        if e.get("action") in ("UPLOAD", "IMPORT") and e.get("result") == "SUCCESS"
    ][:8]

    # ── Alertes ───────────────────────────────────────────────────────────────
    alerts = []
    for p in deps_missing:
        alerts.append({
            "type": "deps_missing",
            "package": p["name"],
            "message": f"{len(p['deps_missing'])} dépendance(s) manquante(s)",
            "deps": p["deps_missing"],
        })

    # Alertes sécurité (rejets ClamAV ou provenance)
    security_failures = [
        e for e in logs
        if e.get("result") == "FAILURE"
        and e.get("action") in ("UPLOAD", "IMPORT", "VALIDATE")
    ][:3]
    for e in security_failures:
        alerts.append({
            "type": "security",
            "package": e.get("package", "inconnu"),
            "message": e.get("detail", "Validation échouée"),
            "timestamp": e.get("timestamp"),
        })

    # ── ClamAV statut (léger) ─────────────────────────────────────────────────
    try:
        clamav = _get_clamav_status()
        clamav_summary = {
            "available": clamav["available"],
            "db_version": clamav.get("db_version"),
            "db_date": clamav.get("db_date"),
            "daemon_running": clamav.get("daemon_running"),
        }
    except Exception:
        clamav_summary = {"available": False}

    return {
        "packages": {
            "total": total_packages,
            "total_size_bytes": total_size,
            "deps_missing_count": len(deps_missing),
            "imports_today": imports_today,
        },
        "activity": activity_list,
        "recent_imports": recent_imports,
        "alerts": alerts[:10],
        "clamav": clamav_summary,
    }
