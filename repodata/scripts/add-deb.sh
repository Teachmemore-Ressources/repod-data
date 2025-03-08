#!/bin/bash

# Chemin du répertoire contenant les fichiers .deb
REPO_PATH="/usr/share/nginx/html/repos/pool/"

# Vérifier s'il y a des fichiers .deb à ajouter
if ls $REPO_PATH/*.deb > /dev/null 2>&1; then
    echo "📌 Ajout des paquets au dépôt APT..."
    reprepro -b /usr/share/nginx/html/repos includedeb bookworm $REPO_PATH/*.deb
else
    echo "❌ Aucun fichier .deb à ajouter au dépôt."
    exit 1
fi

# Nettoyer les fichiers .deb après l'ajout
rm -rf $REPO_PATH/*.deb

echo "✅ Tous les paquets ont été ajoutés au dépôt APT !"
