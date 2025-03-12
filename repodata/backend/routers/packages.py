from fastapi import APIRouter, Query, HTTPException
from services.download import download_package
from services.search import list_packages  # ✅ Correction ici !

router = APIRouter(prefix="/packages", tags=["Packages"])

@router.get("/")
def get_packages():
    """📌 Retourne la liste des paquets disponibles."""
    try:
        return list_packages()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Erreur : {str(e)}")

@router.post("/install/")
def install_package(request: PackageRequest):
    """📌 Installe un paquet APT en exécutant `download-package-dep.sh`."""
    try:
        result = download_package(request.name)
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Erreur : {str(e)}")
