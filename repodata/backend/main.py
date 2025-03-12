from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from routers import packages, upload  # Importe les modules de routes

app = FastAPI()

# ✅ CORS (pour permettre les requêtes du frontend)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ✅ Enregistrer les routes du backend
app.include_router(packages.router)  # Si `packages` a un attribut `router`
app.include_router(upload)  # Utilise directement `upload` (pas besoin de `.router`)
