"""
Gestion des distributions reprepro (enterprise).
Distributions fixes : jammy, noble, focal, bookworm.
"""
import subprocess

REPREPRO_BASE = "/usr/share/nginx/html/repos"

ENTERPRISE_DISTRIBUTIONS = [
    {
        "codename": "jammy",
        "name": "Ubuntu 22.04 LTS",
        "full_name": "Ubuntu 22.04 LTS — Jammy Jellyfish",
        "os": "ubuntu",
        "badge": "⭐ Principal",
        "color": "orange",
    },
    {
        "codename": "noble",
        "name": "Ubuntu 24.04 LTS",
        "full_name": "Ubuntu 24.04 LTS — Noble Numbat",
        "os": "ubuntu",
        "badge": "En adoption",
        "color": "green",
    },
    {
        "codename": "focal",
        "name": "Ubuntu 20.04 LTS",
        "full_name": "Ubuntu 20.04 LTS — Focal Fossa",
        "os": "ubuntu",
        "badge": "Héritage",
        "color": "gray",
    },
    {
        "codename": "bookworm",
        "name": "Debian 12",
        "full_name": "Debian 12 — Bookworm",
        "os": "debian",
        "badge": "Debian",
        "color": "red",
    },
]

VALID_CODENAMES = {d["codename"] for d in ENTERPRISE_DISTRIBUTIONS}

# Mapping source APT → distribution locale
SOURCE_TO_DISTRIB: dict[str, str] = {
    "ubuntu-jammy": "jammy",
    "ubuntu-jammy-updates": "jammy",
    "ubuntu-noble": "noble",
    "ubuntu-focal": "focal",
    "debian-bookworm": "bookworm",
    # Sources de sécurité
    "ubuntu-jammy-security": "jammy",
    "ubuntu-noble-security": "noble",
    "ubuntu-focal-security": "focal",
    "debian-bookworm-security": "bookworm",
}


def _reprepro(*args) -> tuple[int, str, str]:
    """Lance reprepro dans le container depot-apt via docker exec."""
    cmd = ["docker", "exec", "depot-apt", "reprepro", "-b", REPREPRO_BASE] + list(args)
    result = subprocess.run(cmd, capture_output=True, text=True)
    return result.returncode, result.stdout, result.stderr


def list_packages_in_distrib(codename: str) -> list[dict]:
    """
    Liste les paquets dans une distribution via `reprepro list`.
    Format de sortie reprepro : "codename|component|arch: name version"
    """
    rc, stdout, _ = _reprepro("list", codename)
    if rc != 0:
        return []
    packages = []
    seen = set()
    for line in stdout.strip().splitlines():
        if ":" not in line:
            continue
        _, _, pkg_info = line.partition(": ")
        parts = pkg_info.strip().split(" ", 1)
        if len(parts) == 2:
            name, version = parts[0], parts[1]
            if name not in seen:
                seen.add(name)
                packages.append({"name": name, "version": version})
    return sorted(packages, key=lambda p: p["name"])


def get_distribution_stats() -> list[dict]:
    """Retourne la liste des distributions avec leur nombre de paquets."""
    result = []
    for distrib in ENTERPRISE_DISTRIBUTIONS:
        pkgs = list_packages_in_distrib(distrib["codename"])
        result.append({
            **distrib,
            "package_count": len(pkgs),
        })
    return result


def promote_package(name: str, from_dist: str, to_dist: str) -> tuple[bool, str]:
    """
    Promeut un paquet d'une distribution vers une autre via `reprepro copy`.
    Retourne (succès, message).
    """
    rc, stdout, stderr = _reprepro("copy", to_dist, from_dist, name)
    if rc == 0:
        return True, f"{name} promu de {from_dist} vers {to_dist}"
    # reprepro peut retourner non-zéro si déjà présent — on vérifie le stdout
    combined = (stdout + stderr).lower()
    if "already" in combined or "up-to-date" in combined:
        return True, f"{name} est déjà présent dans {to_dist}"
    return False, (stderr.strip() or stdout.strip() or "Erreur reprepro inconnue")


def migrate_all(from_dist: str, to_dist: str) -> tuple[int, list[str], list[str]]:
    """
    Copie TOUS les paquets de from_dist vers to_dist.
    Retourne (nb_copiés, liste_ok, liste_erreurs).
    """
    packages = list_packages_in_distrib(from_dist)
    copied, errors = [], []
    for pkg in packages:
        ok, msg = promote_package(pkg["name"], from_dist, to_dist)
        if ok:
            copied.append(pkg["name"])
        else:
            errors.append(f"{pkg['name']}: {msg}")
    return len(copied), copied, errors


def detect_distribution_from_source(source_id: str) -> str:
    """
    Retourne la distribution locale correspondant à une source APT upstream.
    Défaut : jammy.
    """
    return SOURCE_TO_DISTRIB.get(source_id, "jammy")
