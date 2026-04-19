"""
Routes pour les paramètres de l'application (admin uniquement).
- GET  /settings/           → lire tous les paramètres
- PATCH /settings/          → mettre à jour (partiel, deep-merge)
- POST /settings/test-webhook → tester le webhook configuré
- GET  /settings/next-sync  → prochaine exécution du cron sécurité
"""

import logging
from typing import Any

import requests as http_requests
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from auth.dependencies import get_admin_user
from services import scheduler_state
from services.settings import get_settings, update_settings

logger = logging.getLogger("settings_router")

router = APIRouter(prefix="/settings", tags=["Settings"])


# ─── Lecture ──────────────────────────────────────────────────────────────────

@router.get("/")
def read_settings(current_user: str = Depends(get_admin_user)):
    """Retourne tous les paramètres courants."""
    return get_settings()


# ─── Mise à jour ──────────────────────────────────────────────────────────────

class SettingsPatch(BaseModel):
    sync: dict[str, Any] | None = None
    sources: dict[str, Any] | None = None
    notifications: dict[str, Any] | None = None
    retention: dict[str, Any] | None = None
    validation: dict[str, Any] | None = None


@router.patch("/")
def patch_settings(
    body: SettingsPatch,
    current_user: str = Depends(get_admin_user),
):
    """
    Met à jour les paramètres par fusion profonde.
    Si les paramètres sync changent, le scheduler est mis à jour immédiatement.
    """
    partial = {k: v for k, v in body.model_dump().items() if v is not None}
    updated = update_settings(partial)

    # ── Reschedule à chaud si le cron a changé ─────────────────────────────
    if "sync" in partial and scheduler_state.scheduler is not None:
        sync = updated["sync"]
        try:
            if sync.get("enabled", True):
                scheduler_state.scheduler.reschedule_job(
                    "security_sync_daily",
                    trigger="cron",
                    hour=int(sync["hour"]),
                    minute=int(sync["minute"]),
                )
                logger.info(
                    f"[settings] Cron replanifié → {sync['hour']:02d}:{sync['minute']:02d}"
                )
            else:
                scheduler_state.scheduler.pause_job("security_sync_daily")
                logger.info("[settings] Cron sécurité mis en pause.")
        except Exception as e:
            logger.warning(f"[settings] Impossible de mettre à jour le scheduler : {e}")

    return updated


# ─── Test webhook ─────────────────────────────────────────────────────────────

@router.post("/test-webhook")
def test_webhook(current_user: str = Depends(get_admin_user)):
    """Envoie un message de test au webhook configuré (Slack/Teams/Mattermost)."""
    settings = get_settings()
    url = settings["notifications"].get("webhook_url", "").strip()
    if not url:
        raise HTTPException(status_code=400, detail="Aucune URL webhook configurée.")

    payload = {
        "text": (
            "🔒 *repod — Test de notification*\n"
            "Le webhook est correctement configuré. "
            "Vous recevrez ici les rapports de synchronisation de sécurité APT."
        )
    }
    try:
        resp = http_requests.post(url, json=payload, timeout=5)
        resp.raise_for_status()
        return {"status": "ok", "http_status": resp.status_code}
    except http_requests.exceptions.Timeout:
        raise HTTPException(status_code=504, detail="Timeout : le webhook ne répond pas.")
    except http_requests.exceptions.HTTPError as e:
        raise HTTPException(status_code=502, detail=f"Erreur HTTP webhook : {e}")
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Erreur : {e}")


# ─── Infos scheduler ──────────────────────────────────────────────────────────

@router.get("/next-sync")
def get_next_sync(current_user: str = Depends(get_admin_user)):
    """Retourne la date/heure de la prochaine sync sécurité planifiée."""
    if scheduler_state.scheduler is None:
        return {"next_run": None, "status": "scheduler_not_started"}

    try:
        job = scheduler_state.scheduler.get_job("security_sync_daily")
        if job is None:
            return {"next_run": None, "status": "job_not_found"}
        if job.next_run_time is None:
            return {"next_run": None, "status": "paused"}
        return {
            "next_run": job.next_run_time.isoformat(),
            "status": "scheduled",
        }
    except Exception as e:
        return {"next_run": None, "status": f"error: {e}"}
