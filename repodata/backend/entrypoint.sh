#!/bin/bash
set -e

CLAMAV_DB_DIR="${CLAMAV_DB_DIR:-/var/lib/clamav}"

echo "[entrypoint] Initialisation ClamAV..."

# S'assurer que le répertoire DB appartient à l'utilisateur clamav
chown -R clamav:clamav "$CLAMAV_DB_DIR" 2>/dev/null || true

# Si la DB est vide (premier démarrage ou nouveau volume), télécharger les signatures
if [ ! -f "$CLAMAV_DB_DIR/main.cvd" ] && [ ! -f "$CLAMAV_DB_DIR/main.cld" ]; then
    echo "[entrypoint] Base ClamAV absente — téléchargement initial..."
    freshclam --datadir="$CLAMAV_DB_DIR" 2>&1 | tail -5 || echo "[entrypoint] Avertissement: freshclam initial échoué (mode offline ?)"
else
    echo "[entrypoint] Base ClamAV trouvée dans le volume."
fi

# Démarrer freshclam en daemon pour les mises à jour automatiques (toutes les 12h)
echo "[entrypoint] Démarrage freshclam daemon (mises à jour automatiques)..."
freshclam --daemon \
    --datadir="$CLAMAV_DB_DIR" \
    --log=/var/log/freshclam.log \
    --checks=2 \
    2>/dev/null || echo "[entrypoint] freshclam daemon non disponible"

echo "[entrypoint] Démarrage de l'API backend..."
exec python -m uvicorn main:app --host 0.0.0.0 --port 8000
