"""
Pipeline de validation d'artefacts.
Vérifie l'intégrité, les dépendances et le format avant d'accepter un artefact.
"""
import os
import subprocess
import hashlib
from pathlib import Path
from services.manifest import parse_deb_fields, parse_dependencies, compute_sha256

POOL_DIR = Path(os.getenv("POOL_DIR", "/repos/pool"))


class ValidationResult:
    def __init__(self):
        self.steps: list[dict] = []
        self.passed = True
        self.deps: list[dict] = []  # dépendances avec available_internally renseigné

    def add_step(self, name: str, passed: bool, message: str, detail: str = ""):
        self.steps.append({
            "name": name,
            "passed": passed,
            "message": message,
            "detail": detail,
        })
        if not passed:
            self.passed = False

    def to_dict(self) -> dict:
        return {
            "passed": self.passed,
            "steps": self.steps,
        }


def validate_format(deb_path: str, result: ValidationResult):
    """Vérifie que le fichier est un .deb valide."""
    if not deb_path.endswith(".deb"):
        result.add_step("format", False, "Extension invalide — seuls les .deb sont acceptés")
        return

    r = subprocess.run(
        ["dpkg-deb", "--info", deb_path],
        capture_output=True, text=True
    )
    if r.returncode != 0:
        result.add_step("format", False, "Fichier .deb corrompu ou invalide", r.stderr)
    else:
        result.add_step("format", True, "Format .deb valide")


def validate_checksum(deb_path: str, expected_sha256: str | None, result: ValidationResult):
    """Calcule et vérifie le SHA-256."""
    actual = compute_sha256(deb_path)
    if expected_sha256 and expected_sha256 != actual:
        result.add_step(
            "checksum", False,
            "SHA-256 ne correspond pas",
            f"Attendu: {expected_sha256}\nObtenu:  {actual}"
        )
    else:
        result.add_step("checksum", True, f"SHA-256: {actual}")


def validate_gpg(deb_path: str, result: ValidationResult):
    """Tente de vérifier la signature GPG (.sig ou .asc à côté du fichier)."""
    sig_path = deb_path + ".sig"
    asc_path = deb_path + ".asc"

    sig_file = None
    if os.path.exists(sig_path):
        sig_file = sig_path
    elif os.path.exists(asc_path):
        sig_file = asc_path

    if sig_file is None:
        result.add_step("gpg", True, "Pas de signature GPG (non requis)", "Signature optionnelle absente")
        return

    r = subprocess.run(
        ["gpg", "--verify", sig_file, deb_path],
        capture_output=True, text=True
    )
    if r.returncode == 0:
        result.add_step("gpg", True, "Signature GPG valide", r.stderr)
    else:
        result.add_step("gpg", False, "Signature GPG invalide", r.stderr)


def validate_provenance_sha256(deb_path: str, expected_sha256: str | None, result: ValidationResult):
    """
    Vérifie le SHA256 du fichier téléchargé contre celui stocké dans l'index Packages.gz.
    Protège contre les attaques man-in-the-middle et les corruptions de source.
    """
    if not expected_sha256:
        result.add_step(
            "provenance", True,
            "Provenance non vérifiable (import manuel)",
            "Aucun SHA256 de référence disponible dans l'index"
        )
        return

    actual = compute_sha256(deb_path)
    if actual != expected_sha256:
        result.add_step(
            "provenance", False,
            "SHA256 ne correspond pas à l'index Packages.gz — fichier suspect",
            f"Attendu (Packages.gz) : {expected_sha256}\nObtenu               : {actual}"
        )
    else:
        result.add_step(
            "provenance", True,
            "Provenance vérifiée — SHA256 conforme à Packages.gz",
            f"SHA256 : {actual}"
        )


def validate_clamav(deb_path: str, result: ValidationResult):
    """
    Scan antivirus ClamAV du fichier .deb.
    Bloque les malwares et signatures connues.
    """
    # Vérifier que clamscan est disponible
    check = subprocess.run(
        ["which", "clamscan"],
        capture_output=True, text=True
    )
    if check.returncode != 0:
        result.add_step(
            "antivirus", True,
            "ClamAV non disponible — scan ignoré",
            "Installez clamav pour activer le scan antivirus"
        )
        return

    r = subprocess.run(
        ["clamscan", "--no-summary", "--infected", deb_path],
        capture_output=True, text=True,
        timeout=120
    )

    if r.returncode == 0:
        result.add_step("antivirus", True, "ClamAV — aucune menace détectée")
    elif r.returncode == 1:
        # Virus trouvé
        threat = r.stdout.strip() or "Menace inconnue"
        result.add_step(
            "antivirus", False,
            "ClamAV — menace détectée : fichier rejeté",
            threat
        )
    else:
        # Erreur clamscan (DB manquante, etc.) — on passe en warning
        result.add_step(
            "antivirus", True,
            "ClamAV — scan incomplet (avertissement)",
            r.stderr.strip() or "Erreur clamscan inconnue"
        )


def validate_dependencies(deb_path: str, result: ValidationResult) -> list[dict]:
    """
    Vérifie que toutes les dépendances déclarées sont disponibles dans le repo interne.
    Retourne la liste des dépendances avec leur statut de disponibilité.
    """
    fields = parse_deb_fields(deb_path)
    deps = parse_dependencies(fields.get("depends", ""))

    if not deps:
        result.add_step("dependencies", True, "Aucune dépendance déclarée")
        return []

    missing = []
    available = []

    for dep in deps:
        dep_name = dep["name"]
        # Chercher dans le pool interne (fichier .deb avec ce nom)
        matches = list(POOL_DIR.rglob(f"{dep_name}_*.deb"))
        if matches:
            dep["available_internally"] = True
            available.append(dep_name)
        else:
            dep["available_internally"] = False
            missing.append(dep_name)

    if missing:
        result.add_step(
            "dependencies", False,
            f"{len(missing)} dépendance(s) absente(s) du repo interne",
            "Manquantes: " + ", ".join(missing)
        )
    else:
        result.add_step(
            "dependencies", True,
            f"{len(available)} dépendance(s) disponible(s) en interne"
        )

    return deps


def run_validation_pipeline(
    deb_path: str,
    expected_sha256: str | None = None,
    strict_deps: bool = False,
) -> ValidationResult:
    """
    Pipeline de validation complet :
    1. Format .deb
    2. Provenance SHA256 (vs Packages.gz index)
    3. Antivirus ClamAV
    4. Signature GPG
    5. Dépendances
    """
    result = ValidationResult()

    # 1. Format
    validate_format(deb_path, result)
    if not result.passed:
        return result

    # 2. Provenance SHA256 vs index Packages.gz
    validate_provenance_sha256(deb_path, expected_sha256, result)
    if not result.passed:
        return result  # SHA256 invalide = rejet immédiat

    # 3. Antivirus ClamAV
    try:
        validate_clamav(deb_path, result)
    except subprocess.TimeoutExpired:
        result.add_step("antivirus", True, "ClamAV — timeout, scan ignoré")
    if not result.passed:
        return result  # Virus détecté = rejet immédiat

    # 4. GPG
    validate_gpg(deb_path, result)

    # 5. Dépendances
    deps = validate_dependencies(deb_path, result)
    result.deps = deps

    if not strict_deps:
        dep_step = next((s for s in result.steps if s["name"] == "dependencies"), None)
        if dep_step and not dep_step["passed"]:
            dep_step["warning"] = True
            result.passed = True

    return result
