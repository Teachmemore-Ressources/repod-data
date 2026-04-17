"""
Gestion des utilisateurs via SQLite.
Initialise automatiquement l'admin depuis les variables d'environnement si la DB est vide.
"""
import os
import sqlite3
import secrets
from datetime import datetime, timezone
from pathlib import Path
from threading import Lock
from passlib.context import CryptContext

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

AUTH_DB_PATH = Path(os.getenv("AUTH_DB_PATH", "/repos/auth/users.db"))
_lock = Lock()

VALID_ROLES = {"admin", "uploader", "reader"}


def _get_db() -> sqlite3.Connection:
    AUTH_DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(AUTH_DB_PATH))
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    """Crée le schéma et initialise l'admin depuis l'environnement si nécessaire."""
    with _lock:
        with _get_db() as conn:
            conn.executescript("""
                CREATE TABLE IF NOT EXISTS users (
                    id           INTEGER PRIMARY KEY AUTOINCREMENT,
                    username     TEXT UNIQUE NOT NULL,
                    hashed_password TEXT NOT NULL,
                    role         TEXT NOT NULL DEFAULT 'reader',
                    full_name    TEXT NOT NULL DEFAULT '',
                    email        TEXT NOT NULL DEFAULT '',
                    active       INTEGER NOT NULL DEFAULT 1,
                    created_at   TEXT NOT NULL,
                    last_login   TEXT
                );
            """)

        # Insérer l'admin depuis l'env si la table est vide
        count = conn.execute("SELECT COUNT(*) FROM users").fetchone()[0]
        if count == 0:
            admin_username = os.getenv("ADMIN_USERNAME", "admin")
            admin_hash = os.getenv("ADMIN_PASSWORD_HASH", "")
            # Docker Compose double les $ dans les env_file → les restaurer
            admin_hash = admin_hash.replace("$$", "$")
            now = datetime.now(timezone.utc).isoformat()
            conn.execute(
                "INSERT INTO users (username, hashed_password, role, created_at) VALUES (?, ?, 'admin', ?)",
                (admin_username, admin_hash, now),
            )


def hash_password(plain: str) -> str:
    return pwd_context.hash(plain)


def verify_password(plain: str, hashed: str) -> bool:
    return pwd_context.verify(plain, hashed)


def get_user(username: str) -> dict | None:
    init_db()
    with _lock:
        with _get_db() as conn:
            row = conn.execute(
                "SELECT * FROM users WHERE username = ? AND active = 1",
                (username,)
            ).fetchone()
    return dict(row) if row else None


def get_user_any(username: str) -> dict | None:
    """Retourne un user même inactif (pour admin)."""
    init_db()
    with _lock:
        with _get_db() as conn:
            row = conn.execute("SELECT * FROM users WHERE username = ?", (username,)).fetchone()
    return dict(row) if row else None


def list_users() -> list[dict]:
    init_db()
    with _lock:
        with _get_db() as conn:
            rows = conn.execute(
                "SELECT id, username, role, full_name, email, active, created_at, last_login "
                "FROM users ORDER BY role DESC, username ASC"
            ).fetchall()
    return [dict(r) for r in rows]


def create_user(username: str, password: str, role: str = "reader",
                full_name: str = "", email: str = "") -> dict:
    init_db()
    if role not in VALID_ROLES:
        raise ValueError(f"Rôle invalide : {role}")
    hashed = hash_password(password)
    now = datetime.now(timezone.utc).isoformat()
    with _lock:
        with _get_db() as conn:
            conn.execute(
                "INSERT INTO users (username, hashed_password, role, full_name, email, created_at) "
                "VALUES (?, ?, ?, ?, ?, ?)",
                (username, hashed, role, full_name, email, now),
            )
    return get_user_any(username)


def update_user(username: str, role: str | None = None, full_name: str | None = None,
                email: str | None = None, active: bool | None = None) -> dict | None:
    init_db()
    user = get_user_any(username)
    if not user:
        return None
    if role is not None and role not in VALID_ROLES:
        raise ValueError(f"Rôle invalide : {role}")
    with _lock:
        with _get_db() as conn:
            if role is not None:
                conn.execute("UPDATE users SET role = ? WHERE username = ?", (role, username))
            if full_name is not None:
                conn.execute("UPDATE users SET full_name = ? WHERE username = ?", (full_name, username))
            if email is not None:
                conn.execute("UPDATE users SET email = ? WHERE username = ?", (email, username))
            if active is not None:
                conn.execute("UPDATE users SET active = ? WHERE username = ?", (int(active), username))
    return get_user_any(username)


def delete_user(username: str) -> bool:
    init_db()
    with _lock:
        with _get_db() as conn:
            result = conn.execute("DELETE FROM users WHERE username = ?", (username,))
    return result.rowcount > 0


def change_password(username: str, new_password: str) -> bool:
    init_db()
    hashed = hash_password(new_password)
    with _lock:
        with _get_db() as conn:
            result = conn.execute(
                "UPDATE users SET hashed_password = ? WHERE username = ?",
                (hashed, username)
            )
    return result.rowcount > 0


def update_last_login(username: str):
    init_db()
    now = datetime.now(timezone.utc).isoformat()
    with _lock:
        with _get_db() as conn:
            conn.execute("UPDATE users SET last_login = ? WHERE username = ?", (now, username))
