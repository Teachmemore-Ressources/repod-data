"""
Synchronisation automatique des sources de sécurité APT.

Planifié via APScheduler (main.py) → cron quotidien configurable.
Déclenché manuellement via POST /import/sync-security.

Respecte les paramètres :
  - settings.sources  : sources activées/désactivées
  - settings.notifications : webhook Slack/Teams après chaque sync
"""

import logging
from datetime import datetime, timezone

import requests as http_requests

from services.package_index import DEFAULT_SOURCES, sync_source
from services.audit import log as audit_log
from services.settings import get_settings

logger = logging.getLogger("security_sync")

# Toutes les sources marquées security=True (référence statique du module)
ALL_SECURITY_SOURCES = [s for s in DEFAULT_SOURCES if s.get("security")]


def _get_active_security_sources() -> list[dict]:
    """Retourne les sources sécurité activées dans les paramètres."""
    settings = get_settings()
    enabled = settings.get("sources", {})
    return [s for s in ALL_SECURITY_SOURCES if enabled.get(s["id"], True)]


def _send_webhook(summary: dict) -> None:
    """Envoie un résumé de la sync au webhook configuré (Slack/Teams/Mattermost)."""
    settings = get_settings()
    notif = settings.get("notifications", {})

    if not notif.get("webhook_enabled") or not notif.get("webhook_url"):
        return

    total_packages = sum(
        r.get("pkg_count", 0) for r in summary["sources"] if r.get("status") == "ok"
    )
    min_packages = notif.get("webhook_min_packages", 1)

    if total_packages < min_packages:
        return

    icon = "✅" if summary["total_error"] == 0 else "⚠️"
    lines = [f"{icon} *Sync sécurité APT* — {summary['total_ok']} source(s) OK"]
    for r in summary["sources"]:
        if r["status"] == "ok":
            lines.append(f"  • {r['label']} : {r.get('pkg_count', 0)} paquets indexés")
        else:
            lines.append(f"  • ❌ {r['label']} : {r.get('error', 'erreur')}")

    payload = {"text": "\n".join(lines)}

    try:
        resp = http_requests.post(notif["webhook_url"], json=payload, timeout=5)
        resp.raise_for_status()
        logger.info("[security_sync] Webhook envoyé avec succès.")
    except Exception as e:
        logger.warning(f"[security_sync] Échec webhook : {e}")


def run_security_sync() -> dict:
    """
    Synchronise toutes les sources de sécurité activées.
    Appelé par le scheduler (cron) ET par l'endpoint manuel POST /import/sync-security.

    Retourne :
    {
        "started_at": "...",
        "finished_at": "...",
        "sources": [...],
        "total_ok": int,
        "total_error": int,
        "skipped": int,
    }
    """
    started_at = datetime.now(timezone.utc).isoformat()
    active_sources = _get_active_security_sources()
    skipped = len(ALL_SECURITY_SOURCES) - len(active_sources)

    logger.info(
        f"[security_sync] Démarrage — {len(active_sources)} source(s) active(s), "
        f"{skipped} désactivée(s)."
    )

    results = []
    total_ok = 0
    total_error = 0

    for source in active_sources:
        logger.info(f"[security_sync] Synchronisation : {source['label']}")
        result = sync_source(source)
        result["label"] = source["label"]
        results.append(result)

        if result["status"] == "ok":
            total_ok += 1
            logger.info(f"[security_sync] ✅ {source['label']} — {result['pkg_count']} paquets")
        else:
            total_error += 1
            logger.error(f"[security_sync] ❌ {source['label']} — {result.get('error')}")

    finished_at = datetime.now(timezone.utc).isoformat()
    status = "SUCCESS" if total_error == 0 else ("PARTIAL" if total_ok > 0 else "ERROR")

    audit_log(
        "SECURITY_SYNC", "scheduler", status,
        detail=(
            f"{total_ok} OK, {total_error} erreur(s), {skipped} source(s) désactivée(s)"
        ),
    )

    summary = {
        "started_at": started_at,
        "finished_at": finished_at,
        "sources": results,
        "total_ok": total_ok,
        "total_error": total_error,
        "skipped": skipped,
    }

    _send_webhook(summary)

    logger.info(f"[security_sync] Terminé — {total_ok} OK / {total_error} erreur(s).")
    return summary


# Exposé pour import_router.py
SECURITY_SOURCES = ALL_SECURITY_SOURCES
