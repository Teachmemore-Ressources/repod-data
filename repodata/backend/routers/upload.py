from fastapi import APIRouter, UploadFile, File
import shutil
import os

router = APIRouter(prefix="/upload", tags=["Upload"])

@router.post("/")
def upload_package(file: UploadFile = File(...)):
    """Upload un paquet .deb et l'ajoute au dépôt"""
    save_path = f"/scripts/repos/pool/{file.filename}"
    with open(save_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)
    
    os.system(f"sh /scripts/add-deb.sh {save_path}")
    
    return {"message": f"✅ {file.filename} ajouté au dépôt"}
