# Étape 1 : Construction des dépendances
FROM python:3.10 AS builder

WORKDIR /app

# Installer pip et les dépendances dans un dossier temporaire
COPY requirements.txt .
RUN pip install --upgrade pip && \
    pip install --no-cache-dir --target=/dependencies -r requirements.txt

# Étape 2 : Exécution (runtime)
FROM python:3.10-slim

WORKDIR /app

# Copier uniquement les dépendances depuis l'étape précédente
COPY --from=builder /dependencies /usr/local/lib/python3.10/site-packages/

# Ajouter le dossier contenant les binaires Python au PATH
ENV PATH="/usr/local/bin:$PATH"

# Vérifier la présence de `uvicorn`
RUN ls -la /usr/local/bin

# Installer OpenSSH Client pour permettre au conteneur d'exécuter SSH vers l’hôte
RUN apt-get update -y  && apt install ssh -y

# Copier le code de l'application
COPY . .

# Exposer le port 8000
EXPOSE 8000

# Lancer l'application FastAPI
CMD ["python", "-m", "uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
