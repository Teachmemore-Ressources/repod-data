"""
Routes de sécurité :
- GET  /security/clamav/status   → version DB, date, statut
- POST /security/clamav/update   → mise à jour manuelle (SSE)
"""
import os
import re
import subprocess
from datetime import datetime, timezone
from pathlib import Path
from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse

from auth.dependencies import get_current_user, get_admin_user
from services.audit import log as audit_log

router = APIRouter(prefix="/security", tags=["Security"])

CLAMAV_DB_DIR = Path(os.getenv("CLAMAV_DB_DIR", "/var/lib/clamav"))


def _get_clamav_status() -> dict:
    """Retourne le statut actuel de ClamAV et sa base de signatures."""
    status = {
        "available": False,
        "version": None,
        "db_version": None,
        "db_date": None,
        "db_files": [],
        "daemon_running": False,
    }

    # Version de clamscan
    try:
        r = subprocess.run(["clamscan", "--version"], capture_output=True, text=True, timeout=5)
        if r.returncode == 0:
            status["available"] = True
            # Ex: "ClamAV 1.4.3/27969/Sun Apr 12 06:24:30 2026"
            parts = r.stdout.strip().split("/")
            if len(parts) >= 3:
                status["version"] = parts[0].replace("ClamAV ", "").strip()
                status["db_version"] = parts[1].strip()
                status["db_date"] = parts[2].strip()
    except Exception:
        pass

    # Fichiers de la DB sur le volume
    if CLAMAV_DB_DIR.exists():
        db_files = []
        for f in sorted(CLAMAV_DB_DIR.glob("*.cv*")):
            stat = f.stat()
            db_files.append({
                "name": f.name,
                "size_bytes": stat.st_size,
                "modified_at": datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc).isoformat(),
            })
        status["db_files"] = db_files

    # Vérifier si freshclam daemon tourne
    try:
        r = subprocess.run(["pgrep", "-x", "freshclam"], capture_output=True, text=True, timeout=3)
        status["daemon_running"] = r.returncode == 0
    except Exception:
        pass

    # Lire le cooldown depuis freshclam.dat
    cooldown_until = None
    freshclam_dat = CLAMAV_DB_DIR / "freshclam.dat"
    if freshclam_dat.exists():
        try:
            content = freshclam_dat.read_text()
            # Le fichier contient une ligne avec le timestamp de fin de cooldown
            for line in content.splitlines():
                if "cool" in line.lower() or line.strip().isdigit():
                    ts = int(line.strip())
                    if ts > 0:
                        cooldown_until = datetime.fromtimestamp(ts, tz=timezone.utc).isoformat()
                        break
        except Exception:
            pass
    status["cooldown_until"] = cooldown_until

    return status


@router.get("/clamav/status")
def clamav_status(current_user: str = Depends(get_current_user)):
    """Retourne le statut de ClamAV et de sa base de signatures."""
    return _get_clamav_status()


@router.post("/clamav/update")
def clamav_update(current_user: str = Depends(get_current_user)):
    """
    Lance une mise à jour manuelle de la base ClamAV.
    Stream SSE en temps réel.
    """
    def event_stream():
        def emit(msg: str, level: str = "info") -> str:
            return f"data: {level}|{msg}\n\n"

        yield emit("Lancement de la mise à jour ClamAV...")
        yield emit(f"Répertoire DB : {CLAMAV_DB_DIR}")

        try:
            process = subprocess.Popen(
                ["freshclam",
                 "--datadir", str(CLAMAV_DB_DIR),
                 "--stdout"],
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                bufsize=1,
            )

            for line in iter(process.stdout.readline, ""):
                line = line.strip()
                if not line:
                    continue
                line_lower = line.lower()
                # Coloriser selon le contenu
                if "up to date" in line_lower or "already up" in line_lower:
                    yield emit(line, "success")
                elif "updated" in line_lower or "downloading" in line_lower:
                    yield emit(line, "info")
                elif "rate limit" in line_lower or "cool-down" in line_lower or "429" in line or "403" in line:
                    yield emit(line, "warning")
                elif "error" in line_lower or "failed" in line_lower:
                    yield emit(line, "error")
                elif "warning" in line_lower:
                    yield emit(line, "warning")
                else:
                    yield emit(line, "info")

            process.wait()

            if process.returncode == 0:
                status = _get_clamav_status()
                yield emit(
                    f"Mise à jour terminée — DB version {status.get('db_version', '?')} "
                    f"({status.get('db_date', '?')})",
                    "success"
                )
                audit_log("CLAMAV_UPDATE", current_user, "SUCCESS",
                          detail=f"DB mise à jour : version {status.get('db_version')}")
            else:
                yield emit("Mise à jour terminée avec des avertissements", "warning")
                audit_log("CLAMAV_UPDATE", current_user, "WARNING",
                          detail="freshclam terminé avec code non-zéro")

        except FileNotFoundError:
            yield emit("freshclam introuvable — ClamAV n'est pas installé", "error")
        except Exception as e:
            yield emit(f"Erreur inattendue : {e}", "error")

        yield "data: done|DONE\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
