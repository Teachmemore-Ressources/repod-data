#!/bin/bash
# Usage: add-deb.sh <distrib> <deb_filename>
# Exécute reprepro includedeb dans le container depot-apt via docker exec.
#
# Arguments :
#   $1 = distribution cible (ex: jammy, noble, focal, bookworm)
#   $2 = nom du fichier .deb (pas le chemin complet — juste le filename)

DISTRIB="${1:-jammy}"
FILENAME="${2}"

if [ -z "$FILENAME" ]; then
    echo "Erreur : nom de fichier manquant" >&2
    echo "Usage: add-deb.sh <distrib> <filename.deb>" >&2
    exit 1
fi

REPO_BASE="/usr/share/nginx/html/repos"
DEB_PATH="${REPO_BASE}/pool/${FILENAME}"

echo "➕ Ajout de ${FILENAME} dans la distribution ${DISTRIB}..."
docker exec depot-apt reprepro -b "${REPO_BASE}" includedeb "${DISTRIB}" "${DEB_PATH}" 2>&1

RC=$?
if [ $RC -eq 0 ]; then
    echo "✅ ${FILENAME} ajouté dans ${DISTRIB}"
else
    echo "⚠️  reprepro a retourné le code ${RC} pour ${FILENAME} (peut déjà être présent)"
fi
