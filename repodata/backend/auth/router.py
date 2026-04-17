"""
Routes d'authentification et de gestion des utilisateurs.

Publique :
  POST /auth/token           → connexion, retourne JWT

Authentifié (tout rôle) :
  GET  /auth/me              → info du compte courant
  POST /auth/change-password → changer son propre mot de passe

Admin uniquement :
  GET    /auth/users                        → liste tous les utilisateurs
  POST   /auth/users                        → créer un utilisateur
  PATCH  /auth/users/{username}             → modifier rôle/infos
  DELETE /auth/users/{username}             → supprimer un utilisateur
  POST   /auth/users/{username}/reset-password → réinitialiser le mdp
"""
from fastapi import APIRouter, HTTPException, status, Depends

from .models import Token, UserLogin, UserCreate, UserUpdate, PasswordChange, PasswordReset
from .users import (
    get_user, get_user_any, list_users, create_user,
    update_user, delete_user, change_password, verify_password, update_last_login,
    VALID_ROLES,
)
from .jwt import create_access_token
from .dependencies import get_current_user, get_current_user_full, get_admin_user

router = APIRouter(prefix="/auth", tags=["Auth"])


# ─── Connexion ────────────────────────────────────────────────────────────────

@router.post("/token", response_model=Token)
def login(credentials: UserLogin):
    """Authentifie un utilisateur et retourne un JWT."""
    user = get_user(credentials.username)
    if not user or not verify_password(credentials.password, user["hashed_password"]):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Identifiants incorrects",
        )
    update_last_login(user["username"])
    token = create_access_token({
        "sub": user["username"],
        "role": user["role"],
        "full_name": user.get("full_name", ""),
    })
    return {"access_token": token, "token_type": "bearer"}


# ─── Compte courant ───────────────────────────────────────────────────────────

@router.get("/me")
def me(current_user: dict = Depends(get_current_user_full)):
    """Retourne les informations du compte connecté."""
    user = get_user_any(current_user["username"])
    if not user:
        raise HTTPException(status_code=404, detail="Utilisateur introuvable")
    return {
        "username": user["username"],
        "role": user["role"],
        "full_name": user.get("full_name", ""),
        "email": user.get("email", ""),
        "active": bool(user["active"]),
        "last_login": user.get("last_login"),
    }


@router.post("/change-password")
def change_own_password(
    payload: PasswordChange,
    current_user: dict = Depends(get_current_user_full),
):
    """Permet à l'utilisateur connecté de changer son propre mot de passe."""
    username = current_user["username"]
    user = get_user_any(username)
    if not user:
        raise HTTPException(status_code=404, detail="Utilisateur introuvable")

    if not verify_password(payload.current_password, user["hashed_password"]):
        raise HTTPException(status_code=400, detail="Mot de passe actuel incorrect")

    if len(payload.new_password) < 8:
        raise HTTPException(status_code=400, detail="Le nouveau mot de passe doit contenir au moins 8 caractères")

    change_password(username, payload.new_password)
    return {"status": "ok", "message": "Mot de passe modifié avec succès"}


# ─── Gestion des utilisateurs (admin) ────────────────────────────────────────

@router.get("/users")
def list_all_users(admin: str = Depends(get_admin_user)):
    """Liste tous les utilisateurs (admin uniquement)."""
    users = list_users()
    # Ne jamais exposer les hashes
    return {"users": [
        {k: v for k, v in u.items() if k != "hashed_password"}
        for u in users
    ]}


@router.post("/users", status_code=201)
def create_new_user(payload: UserCreate, admin: str = Depends(get_admin_user)):
    """Crée un nouvel utilisateur (admin uniquement)."""
    if payload.role not in VALID_ROLES:
        raise HTTPException(status_code=400, detail=f"Rôle invalide. Valeurs acceptées : {', '.join(VALID_ROLES)}")

    if len(payload.password) < 8:
        raise HTTPException(status_code=400, detail="Le mot de passe doit contenir au moins 8 caractères")

    existing = get_user_any(payload.username)
    if existing:
        raise HTTPException(status_code=409, detail=f"L'utilisateur '{payload.username}' existe déjà")

    user = create_user(
        username=payload.username,
        password=payload.password,
        role=payload.role,
        full_name=payload.full_name,
        email=payload.email,
    )
    return {k: v for k, v in user.items() if k != "hashed_password"}


@router.patch("/users/{username}")
def update_existing_user(
    username: str,
    payload: UserUpdate,
    admin: str = Depends(get_admin_user),
):
    """Met à jour le rôle et/ou les infos d'un utilisateur (admin uniquement)."""
    # L'admin ne peut pas changer son propre rôle (sécurité)
    if username == admin and payload.role is not None and payload.role != "admin":
        raise HTTPException(status_code=400, detail="Vous ne pouvez pas changer votre propre rôle")

    if payload.role is not None and payload.role not in VALID_ROLES:
        raise HTTPException(status_code=400, detail=f"Rôle invalide. Valeurs acceptées : {', '.join(VALID_ROLES)}")

    user = update_user(
        username=username,
        role=payload.role,
        full_name=payload.full_name,
        email=payload.email,
        active=payload.active,
    )
    if not user:
        raise HTTPException(status_code=404, detail=f"Utilisateur '{username}' introuvable")

    return {k: v for k, v in user.items() if k != "hashed_password"}


@router.delete("/users/{username}")
def delete_existing_user(username: str, admin: str = Depends(get_admin_user)):
    """Supprime un utilisateur (admin uniquement, ne peut pas se supprimer soi-même)."""
    if username == admin:
        raise HTTPException(status_code=400, detail="Vous ne pouvez pas supprimer votre propre compte")

    ok = delete_user(username)
    if not ok:
        raise HTTPException(status_code=404, detail=f"Utilisateur '{username}' introuvable")

    return {"status": "deleted", "username": username}


@router.post("/users/{username}/reset-password")
def reset_user_password(
    username: str,
    payload: PasswordReset,
    admin: str = Depends(get_admin_user),
):
    """Réinitialise le mot de passe d'un utilisateur (admin uniquement)."""
    if len(payload.new_password) < 8:
        raise HTTPException(status_code=400, detail="Le mot de passe doit contenir au moins 8 caractères")

    user = get_user_any(username)
    if not user:
        raise HTTPException(status_code=404, detail=f"Utilisateur '{username}' introuvable")

    change_password(username, payload.new_password)
    return {"status": "ok", "message": f"Mot de passe de '{username}' réinitialisé"}
