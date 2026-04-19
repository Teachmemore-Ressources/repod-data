import logging
import os
from contextlib import asynccontextmanager

from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger
from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from auth.router import router as auth_router
from routers.artifacts import router as artifacts_router
from routers.dashboard_router import router as dashboard_router
from routers.distributions_router import router as distributions_router
from routers.import_router import router as import_router
from routers.packages import router as packages_router
from routers.security_router import router as security_router
from routers.settings_router import router as settings_router
from routers.upload import router as upload_router
from services import scheduler_state
from services.security_sync import run_security_sync
from services.settings import get_settings

load_dotenv()

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("main")


@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    Gestion du cycle de vie de l'application.
    Lit les paramètres de sync depuis settings.json au démarrage.
    Démarre le scheduler et l'arrête proprement à l'extinction.
    """
    settings = get_settings()
    sync_cfg = settings.get("sync", {})

    hour = int(sync_cfg.get("hour", 3))
    minute = int(sync_cfg.get("minute", 0))
    enabled = sync_cfg.get("enabled", True)

    sched = BackgroundScheduler(timezone="Europe/Paris")
    sched.add_job(
        run_security_sync,
        trigger=CronTrigger(hour=hour, minute=minute),
        id="security_sync_daily",
        name="Sync quotidienne des sources APT sécurité",
        replace_existing=True,
        misfire_grace_time=3600,  # tolère 1h de décalage (container redémarré)
    )
    sched.start()

    # Stocker la référence pour que settings_router puisse reschedule à chaud
    scheduler_state.scheduler = sched

    if enabled:
        logger.info(
            f"[scheduler] Sync sécurité APT planifiée chaque jour à "
            f"{hour:02d}:{minute:02d} (Europe/Paris)"
        )
    else:
        sched.pause_job("security_sync_daily")
        logger.info("[scheduler] Sync sécurité désactivée dans les paramètres.")

    yield  # ← l'application tourne ici

    sched.shutdown(wait=False)
    scheduler_state.scheduler = None
    logger.info("[scheduler] Scheduler arrêté proprement.")


app = FastAPI(title="APT Repo Manager", version="2.0.0", lifespan=lifespan)

allowed_origins = os.getenv("CORS_ORIGINS", "http://localhost:3000").split(",")

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router)
app.include_router(packages_router)
app.include_router(upload_router)
app.include_router(artifacts_router)
app.include_router(import_router)
app.include_router(security_router)
app.include_router(dashboard_router)
app.include_router(distributions_router)
app.include_router(settings_router)
