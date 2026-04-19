"""
Index local de métadonnées APT.
Télécharge et parse Packages.gz depuis les repos upstream → SQLite.
Permet la recherche sans connexion internet permanente.
"""
import gzip
import lzma
import os
import sqlite3
import urllib.request
import urllib.error
from datetime import datetime, timezone
from pathlib import Path
from threading import Lock

INDEX_DIR = Path(os.getenv("INDEX_DIR", "/repos/package-index"))
INDEX_DIR.mkdir(parents=True, exist_ok=True)
DB_PATH = INDEX_DIR / "packages.db"

_lock = Lock()

# Sources APT configurées
DEFAULT_SOURCES = [
    {
        "id": "ubuntu-jammy",
        "label": "Ubuntu 22.04 (Jammy)",
        "url": "http://archive.ubuntu.com/ubuntu/dists/jammy/main/binary-amd64/Packages.gz",
        "distro": "jammy",
        "component": "main",
        "arch": "amd64",
    },
    {
        "id": "ubuntu-jammy-updates",
        "label": "Ubuntu 22.04 Updates",
        "url": "http://archive.ubuntu.com/ubuntu/dists/jammy-updates/main/binary-amd64/Packages.gz",
        "distro": "jammy-updates",
        "component": "main",
        "arch": "amd64",
    },
    {
        "id": "ubuntu-noble",
        "label": "Ubuntu 24.04 (Noble)",
        "url": "http://archive.ubuntu.com/ubuntu/dists/noble/main/binary-amd64/Packages.gz",
        "distro": "noble",
        "component": "main",
        "arch": "amd64",
    },
    {
        "id": "ubuntu-focal",
        "label": "Ubuntu 20.04 (Focal)",
        "url": "http://archive.ubuntu.com/ubuntu/dists/focal/main/binary-amd64/Packages.gz",
        "distro": "focal",
        "component": "main",
        "arch": "amd64",
    },
    {
        "id": "debian-bookworm",
        "label": "Debian 12 (Bookworm)",
        "url": "http://deb.debian.org/debian/dists/bookworm/main/binary-amd64/Packages.gz",
        "distro": "bookworm",
        "component": "main",
        "arch": "amd64",
    },
    # ── Sources de sécurité ──────────────────────────────────────────────────
    {
        "id": "ubuntu-jammy-security",
        "label": "Ubuntu 22.04 Security",
        "url": "http://security.ubuntu.com/ubuntu/dists/jammy-security/main/binary-amd64/Packages.gz",
        "distro": "jammy",
        "component": "main",
        "arch": "amd64",
        "security": True,
    },
    {
        "id": "ubuntu-noble-security",
        "label": "Ubuntu 24.04 Security",
        "url": "http://security.ubuntu.com/ubuntu/dists/noble-security/main/binary-amd64/Packages.gz",
        "distro": "noble",
        "component": "main",
        "arch": "amd64",
        "security": True,
    },
    {
        "id": "ubuntu-focal-security",
        "label": "Ubuntu 20.04 Security",
        "url": "http://security.ubuntu.com/ubuntu/dists/focal-security/main/binary-amd64/Packages.gz",
        "distro": "focal",
        "component": "main",
        "arch": "amd64",
        "security": True,
    },
    {
        "id": "debian-bookworm-security",
        "label": "Debian 12 Security",
        "url": "http://security.debian.org/debian-security/dists/bookworm-security/main/binary-amd64/Packages.xz",
        "distro": "bookworm",
        "component": "main",
        "arch": "amd64",
        "security": True,
    },
]


def _get_db() -> sqlite3.Connection:
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    """Crée le schéma SQLite si nécessaire et migre les colonnes manquantes."""
    with _get_db() as conn:
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS packages (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                source_id   TEXT NOT NULL,
                name        TEXT NOT NULL,
                version     TEXT NOT NULL,
                arch        TEXT,
                section     TEXT,
                description TEXT,
                depends     TEXT,
                filename    TEXT,
                size        INTEGER,
                sha256      TEXT,
                installed_size INTEGER,
                maintainer  TEXT,
                distro      TEXT,
                synced_at   TEXT,
                security    INTEGER DEFAULT 0
            );
            CREATE INDEX IF NOT EXISTS idx_name ON packages(name);
            CREATE INDEX IF NOT EXISTS idx_source ON packages(source_id);

            CREATE TABLE IF NOT EXISTS sync_status (
                source_id   TEXT PRIMARY KEY,
                label       TEXT,
                last_sync   TEXT,
                pkg_count   INTEGER,
                status      TEXT,
                error       TEXT
            );
        """)
        # Migration : ajoute les colonnes absentes sur les bases existantes
        existing = {row[1] for row in conn.execute("PRAGMA table_info(packages)")}
        if "security" not in existing:
            conn.execute("ALTER TABLE packages ADD COLUMN security INTEGER DEFAULT 0")


def _decompress(data: bytes, url: str) -> str:
    """Décompresse selon l'extension de l'URL (.gz, .xz, ou pas de compression)."""
    if url.endswith(".xz"):
        return lzma.decompress(data).decode("utf-8", errors="replace")
    if url.endswith(".gz"):
        return gzip.decompress(data).decode("utf-8", errors="replace")
    return data.decode("utf-8", errors="replace")


def _parse_packages_gz(gz_data: bytes, source: dict) -> list[dict]:
    """Parse le contenu d'un Packages(.gz/.xz) en liste de dicts."""
    try:
        content = _decompress(gz_data, source["url"])
    except Exception as e:
        raise ValueError(f"Impossible de décompresser le fichier Packages : {e}")

    packages = []
    current = {}

    for line in content.splitlines():
        if line == "":
            if current.get("name"):
                current["source_id"] = source["id"]
                current["distro"] = source["distro"]
                current["synced_at"] = datetime.now(timezone.utc).isoformat()
                current["security"] = 1 if source.get("security") else 0
                packages.append(current)
            current = {}
        elif line.startswith("Package: "):
            current["name"] = line[9:].strip()
        elif line.startswith("Version: "):
            current["version"] = line[9:].strip()
        elif line.startswith("Architecture: "):
            current["arch"] = line[14:].strip()
        elif line.startswith("Section: "):
            current["section"] = line[9:].strip()
        elif line.startswith("Description: "):
            current["description"] = line[13:].strip()
        elif line.startswith("Depends: "):
            current["depends"] = line[9:].strip()
        elif line.startswith("Filename: "):
            current["filename"] = line[10:].strip()
        elif line.startswith("Size: "):
            try:
                current["size"] = int(line[6:].strip())
            except ValueError:
                pass
        elif line.startswith("SHA256: "):
            current["sha256"] = line[8:].strip()
        elif line.startswith("Installed-Size: "):
            try:
                current["installed_size"] = int(line[16:].strip())
            except ValueError:
                pass
        elif line.startswith("Maintainer: "):
            current["maintainer"] = line[12:].strip()

    if current.get("name"):
        current["source_id"] = source["id"]
        current["distro"] = source["distro"]
        current["synced_at"] = datetime.now(timezone.utc).isoformat()
        current["security"] = 1 if source.get("security") else 0
        packages.append(current)

    return packages


def sync_source(source: dict) -> dict:
    """
    Télécharge et indexe Packages.gz pour une source donnée.
    Retourne un résumé du résultat.
    """
    init_db()
    source_id = source["id"]

    try:
        req = urllib.request.Request(
            source["url"],
            headers={"User-Agent": "APT-Repo-Manager/2.0"}
        )
        with urllib.request.urlopen(req, timeout=30) as resp:
            gz_data = resp.read()

        packages = _parse_packages_gz(gz_data, source)

        # S'assurer que tous les champs optionnels ont une valeur par défaut
        _defaults = {
            "arch": None, "section": None, "description": None,
            "depends": None, "filename": None, "size": None,
            "sha256": None, "installed_size": None, "maintainer": None,
            "security": 0,
        }
        for pkg in packages:
            for k, v in _defaults.items():
                pkg.setdefault(k, v)

        with _lock:
            with _get_db() as conn:
                # Supprimer les anciens enregistrements de cette source
                conn.execute("DELETE FROM packages WHERE source_id = ?", (source_id,))

                # Insérer les nouveaux
                conn.executemany("""
                    INSERT INTO packages
                    (source_id, name, version, arch, section, description,
                     depends, filename, size, sha256, installed_size, maintainer, distro, synced_at, security)
                    VALUES
                    (:source_id, :name, :version, :arch, :section, :description,
                     :depends, :filename, :size, :sha256, :installed_size, :maintainer, :distro, :synced_at, :security)
                """, packages)

                conn.execute("""
                    INSERT OR REPLACE INTO sync_status
                    (source_id, label, last_sync, pkg_count, status, error)
                    VALUES (?, ?, ?, ?, 'ok', NULL)
                """, (
                    source_id,
                    source["label"],
                    datetime.now(timezone.utc).isoformat(),
                    len(packages),
                ))

        return {
            "source_id": source_id,
            "label": source["label"],
            "status": "ok",
            "pkg_count": len(packages),
        }

    except urllib.error.URLError as e:
        error_msg = str(e)
        with _lock:
            with _get_db() as conn:
                conn.execute("""
                    INSERT OR REPLACE INTO sync_status
                    (source_id, label, last_sync, pkg_count, status, error)
                    VALUES (?, ?, ?, 0, 'error', ?)
                """, (
                    source_id,
                    source["label"],
                    datetime.now(timezone.utc).isoformat(),
                    error_msg,
                ))
        return {"source_id": source_id, "label": source["label"], "status": "error", "error": error_msg}

    except Exception as e:
        return {"source_id": source_id, "label": source["label"], "status": "error", "error": str(e)}


def sync_all() -> list[dict]:
    """Synchronise toutes les sources configurées."""
    results = []
    for source in DEFAULT_SOURCES:
        results.append(sync_source(source))
    return results


def get_sync_status() -> list[dict]:
    """Retourne le statut de synchronisation de chaque source."""
    init_db()
    with _get_db() as conn:
        rows = conn.execute("SELECT * FROM sync_status").fetchall()
        synced = {r["source_id"]: dict(r) for r in rows}

    result = []
    for source in DEFAULT_SOURCES:
        sid = source["id"]
        is_security = source.get("security", False)
        if sid in synced:
            entry = dict(synced[sid])
            entry["security"] = is_security
            result.append(entry)
        else:
            result.append({
                "source_id": sid,
                "label": source["label"],
                "last_sync": None,
                "pkg_count": 0,
                "status": "never",
                "error": None,
                "security": is_security,
            })
    return result


def search_packages(query: str, limit: int = 30, source_id: str = None) -> list[dict]:
    """
    Recherche des paquets dans l'index local par nom ou description.
    Prioritise les correspondances exactes sur le nom.
    """
    init_db()
    query = query.strip()
    if not query:
        return []

    with _get_db() as conn:
        params: list = []
        source_filter = ""
        if source_id:
            source_filter = "AND source_id = ?"
            params.append(source_id)

        # Recherche : nom exact d'abord, puis préfixe, puis contenu description
        rows = conn.execute(f"""
            SELECT name, version, arch, section, description, depends,
                   size, sha256, distro, source_id, synced_at, security
            FROM packages
            WHERE (name LIKE ? OR description LIKE ?)
            {source_filter}
            ORDER BY
                CASE
                    WHEN name = ?           THEN 0
                    WHEN name LIKE ?        THEN 1
                    ELSE                         2
                END,
                name ASC
            LIMIT ?
        """, [
            f"%{query}%", f"%{query}%",
            *params,
            query, f"{query}%",
            limit,
        ]).fetchall()

    return [dict(r) for r in rows]


def get_package_info(name: str, source_id: str = None) -> dict | None:
    """Retourne les infos complètes d'un paquet depuis l'index."""
    init_db()
    with _get_db() as conn:
        if source_id:
            row = conn.execute(
                "SELECT * FROM packages WHERE name = ? AND source_id = ? LIMIT 1",
                (name, source_id)
            ).fetchone()
        else:
            row = conn.execute(
                "SELECT * FROM packages WHERE name = ? LIMIT 1",
                (name,)
            ).fetchone()
    return dict(row) if row else None


def is_indexed() -> bool:
    """Retourne True si l'index contient au moins un paquet."""
    init_db()
    with _get_db() as conn:
        count = conn.execute("SELECT COUNT(*) FROM packages").fetchone()[0]
    return count > 0
