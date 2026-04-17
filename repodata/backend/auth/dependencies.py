"""
Dépendances FastAPI pour l'authentification et les rôles.

- get_current_user      → retourne le username (str) — backward compatible
- get_current_user_full → retourne {username, role, full_name}
- get_admin_user        → username, lève 403 si role != admin
- get_uploader_user     → username, lève 403 si role not in (admin, uploader)
"""
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from .jwt import decode_token

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/auth/token")

_401 = HTTPException(
    status_code=status.HTTP_401_UNAUTHORIZED,
    detail="Token invalide ou expiré",
    headers={"WWW-Authenticate": "Bearer"},
)


def _parse_token(token: str) -> dict:
    data = decode_token(token)
    if not data:
        raise _401
    return data


async def get_current_user(token: str = Depends(oauth2_scheme)) -> str:
    """Retourne le username — compatible avec tout le code existant."""
    return _parse_token(token)["username"]


async def get_current_user_full(token: str = Depends(oauth2_scheme)) -> dict:
    """Retourne {username, role, full_name}."""
    return _parse_token(token)


async def get_admin_user(token: str = Depends(oauth2_scheme)) -> str:
    """Retourne le username, lève 403 si l'utilisateur n'est pas admin."""
    data = _parse_token(token)
    if data["role"] != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Accès réservé aux administrateurs",
        )
    return data["username"]


async def get_uploader_user(token: str = Depends(oauth2_scheme)) -> str:
    """Retourne le username, lève 403 si le rôle est reader."""
    data = _parse_token(token)
    if data["role"] not in ("admin", "uploader"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Rôle uploader ou admin requis",
        )
    return data["username"]
