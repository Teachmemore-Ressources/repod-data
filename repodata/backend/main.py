import os
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv
from routers.packages import router as packages_router
from routers.upload import router as upload_router
from routers.artifacts import router as artifacts_router
from routers.import_router import router as import_router
from routers.security_router import router as security_router
from routers.dashboard_router import router as dashboard_router
from routers.distributions_router import router as distributions_router
from auth.router import router as auth_router

load_dotenv()

app = FastAPI(title="APT Repo Manager", version="2.0.0")

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
