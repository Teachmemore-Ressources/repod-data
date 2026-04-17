import { useState } from "react";
import toast from "react-hot-toast";

const REPO_URL = process.env.REACT_APP_REPO_URL || "http://localhost:80";
const REPO_HOST = REPO_URL.replace(/^https?:\/\//, "").replace(/:\d+$/, "");

function CodeBlock({ code, label }) {
  const copy = () => {
    navigator.clipboard.writeText(code).then(
      () => toast.success("Copié"),
      () => toast.error("Impossible de copier")
    );
  };

  return (
    <div className="rounded-xl overflow-hidden border border-gray-200">
      {label && (
        <div className="flex items-center justify-between px-4 py-2 bg-gray-800 border-b border-gray-700">
          <span className="text-xs text-gray-400 font-mono">{label}</span>
          <button
            onClick={copy}
            className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-white transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
            </svg>
            Copier
          </button>
        </div>
      )}
      <pre className="bg-gray-900 text-green-400 text-sm font-mono px-5 py-4 overflow-x-auto whitespace-pre w-0 min-w-full">
        {code}
      </pre>
    </div>
  );
}

function Step({ number, title, children }) {
  return (
    <div className="flex gap-5">
      <div className="shrink-0 w-8 h-8 rounded-full bg-blue-600 text-white flex items-center justify-center
                      text-sm font-bold mt-0.5">
        {number}
      </div>
      <div className="flex-1 space-y-3 pb-8 border-b border-gray-100 last:border-0 last:pb-0">
        <h3 className="font-semibold text-gray-900">{title}</h3>
        {children}
      </div>
    </div>
  );
}

export default function ClientSetupPage() {
  const [distro, setDistro] = useState("bookworm");

  const distros = [
    { id: "bookworm", label: "Debian 12 (Bookworm)" },
    { id: "bullseye", label: "Debian 11 (Bullseye)" },
    { id: "jammy", label: "Ubuntu 22.04 (Jammy)" },
    { id: "noble", label: "Ubuntu 24.04 (Noble)" },
  ];

  const gpgCmd = `curl -fsSL ${REPO_URL}/repos/depot.gpg | sudo gpg --dearmor -o /etc/apt/trusted.gpg.d/private-repo.gpg`;

  const sourcesEntry = `deb [signed-by=/etc/apt/trusted.gpg.d/private-repo.gpg] ${REPO_URL}/repos ${distro} main`;

  const addSourceCmd = `echo "${sourcesEntry}" | sudo tee /etc/apt/sources.list.d/private-repo.list`;

  const fullScript = `#!/bin/bash
# Configuration du dépôt APT privé — ${REPO_HOST}

# 1. Importer la clé GPG
curl -fsSL ${REPO_URL}/repos/depot.gpg | \\
  sudo gpg --dearmor -o /etc/apt/trusted.gpg.d/private-repo.gpg

# 2. Ajouter le dépôt
echo "deb [signed-by=/etc/apt/trusted.gpg.d/private-repo.gpg] \\
  ${REPO_URL}/repos ${distro} main" | \\
  sudo tee /etc/apt/sources.list.d/private-repo.list

# 3. Mettre à jour
sudo apt update

echo "Dépôt privé configuré avec succès."`;

  return (
    <div className="space-y-8 max-w-3xl">
      {/* En-tête */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Configuration des machines clientes</h1>
        <p className="text-sm text-gray-500 mt-1">
          Suivez ces étapes sur chaque machine qui doit accéder au dépôt privé.
        </p>
      </div>

      {/* Sélecteur de distribution */}
      <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-3">
        <h2 className="text-sm font-semibold text-gray-700">Distribution cible</h2>
        <div className="flex flex-wrap gap-2">
          {distros.map((d) => (
            <button
              key={d.id}
              onClick={() => setDistro(d.id)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors border ${
                distro === d.id
                  ? "bg-blue-600 text-white border-blue-600"
                  : "bg-white text-gray-600 border-gray-300 hover:border-blue-400"
              }`}
            >
              {d.label}
            </button>
          ))}
        </div>
      </div>

      {/* Étapes */}
      <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-8">

        <Step number="1" title="Importer la clé GPG du dépôt">
          <p className="text-sm text-gray-600">
            Cette clé permet à APT de vérifier l'authenticité des paquets téléchargés.
          </p>
          <CodeBlock code={gpgCmd} label="bash" />
        </Step>

        <Step number="2" title="Ajouter le dépôt aux sources APT">
          <p className="text-sm text-gray-600">
            Enregistre l'adresse du dépôt privé dans la liste des sources APT.
          </p>
          <CodeBlock code={addSourceCmd} label="bash" />
          <p className="text-xs text-gray-400">
            Fichier créé : <code className="bg-gray-100 px-1 rounded">/etc/apt/sources.list.d/private-repo.list</code>
          </p>
        </Step>

        <Step number="3" title="Mettre à jour la liste des paquets">
          <CodeBlock code="sudo apt update" label="bash" />
        </Step>

        <Step number="4" title="Installer un paquet">
          <p className="text-sm text-gray-600">
            Une fois le dépôt configuré, l'installation se fait normalement avec apt.
          </p>
          <CodeBlock code="sudo apt install <nom-du-paquet>" label="bash" />
          <p className="text-xs text-gray-500 bg-blue-50 border border-blue-100 rounded-lg px-3 py-2">
            Les paquets disponibles sont listés dans l'onglet{" "}
            <strong>Paquets</strong>. Chaque ligne a un bouton{" "}
            <code className="bg-white px-1 rounded border text-xs">apt install</code>{" "}
            pour copier la commande exacte.
          </p>
        </Step>
      </div>

      {/* Script tout-en-un */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-gray-900">Script d'installation complet</h2>
          <span className="text-xs text-gray-400">Pour automatiser la configuration</span>
        </div>
        <CodeBlock code={fullScript} label="setup-repo.sh" />
      </div>

      {/* Vérification */}
      <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-3">
        <h2 className="text-sm font-semibold text-gray-700">Vérifier la configuration</h2>
        <div className="space-y-2">
          <CodeBlock
            code={`# Vérifier que le dépôt est bien reconnu\napt-cache policy | grep ${REPO_HOST}`}
            label="bash"
          />
          <CodeBlock
            code={`# Lister les paquets disponibles dans le dépôt\napt-cache search . | grep -i <nom>`}
            label="bash"
          />
        </div>
      </div>

      {/* Info réseau */}
      <div className="flex gap-3 bg-amber-50 border border-amber-200 rounded-xl px-5 py-4 text-sm text-amber-800">
        <svg className="w-5 h-5 shrink-0 mt-0.5 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
            d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <div>
          <p className="font-medium">Accès réseau requis</p>
          <p className="mt-0.5 text-amber-700">
            Les machines clientes doivent pouvoir atteindre{" "}
            <code className="bg-amber-100 px-1 rounded font-mono text-xs">{REPO_URL}</code>{" "}
            sur le réseau interne. Aucune connexion internet n'est nécessaire.
          </p>
        </div>
      </div>
    </div>
  );
}
