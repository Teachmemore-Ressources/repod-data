import { useState, useEffect, useRef } from "react";
import toast from "react-hot-toast";
import { getClamavStatus, getApiBaseUrl } from "../api";

const API_URL = getApiBaseUrl();

function formatBytes(bytes) {
  if (!bytes) return "–";
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function LogLine({ line }) {
  if (!line) return null;
  const [level, ...rest] = line.split("|");
  const msg = rest.join("|");
  const styles = {
    info: "text-gray-300", success: "text-green-400",
    error: "text-red-400", warning: "text-yellow-400",
    done: "text-blue-400 font-semibold",
  };
  return (
    <p className={`text-xs font-mono leading-relaxed ${styles[level] || "text-gray-300"}`}>
      {msg}
    </p>
  );
}

function StatusBadge({ ok, label }) {
  return ok ? (
    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-green-100 text-green-700">
      <span className="w-1.5 h-1.5 rounded-full bg-green-500"></span>
      {label}
    </span>
  ) : (
    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-red-100 text-red-600">
      <span className="w-1.5 h-1.5 rounded-full bg-red-500"></span>
      {label}
    </span>
  );
}

export default function SecurityPage() {
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [logs, setLogs] = useState([]);
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(false);
  const logsRef = useRef(null);

  useEffect(() => { loadStatus(); }, []);

  useEffect(() => {
    if (done) {
      setTimeout(() => loadStatus(), 1000);
    }
  }, [done]);

  useEffect(() => {
    if (logsRef.current) logsRef.current.scrollTop = logsRef.current.scrollHeight;
  }, [logs]);

  const loadStatus = async () => {
    setLoading(true);
    try {
      const data = await getClamavStatus();
      setStatus(data);
    } catch {
      toast.error("Impossible de charger le statut ClamAV");
    } finally {
      setLoading(false);
    }
  };

  const handleUpdate = () => {
    setLogs([]);
    setDone(false);
    setRunning(true);

    const token = localStorage.getItem("token");
    fetch(`${API_URL}/security/clamav/update`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    }).then(async (resp) => {
      if (!resp.ok) {
        setLogs([`error|Erreur serveur (${resp.status})`]);
        setRunning(false);
        return;
      }
      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { value, done: streamDone } = await reader.read();
        if (streamDone) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split("\n\n");
        buffer = parts.pop();
        for (const part of parts) {
          const dataLine = part.split("\n").find((l) => l.startsWith("data:"));
          if (!dataLine) continue;
          const payload = dataLine.slice(5).trim();
          setLogs((prev) => [...prev, payload]);
          if (payload.startsWith("done|")) { setDone(true); setRunning(false); }
        }
      }
      setRunning(false);
    }).catch((e) => {
      setLogs([`error|${e.message}`]);
      setRunning(false);
    });
  };

  return (
    <div className="space-y-6 max-w-3xl">
      {/* En-tête */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Sécurité</h1>
        <p className="text-sm text-gray-500 mt-1">
          Gestion de l'antivirus et des contrôles de sécurité des binaires.
        </p>
      </div>

      {/* Carte ClamAV */}
      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        {/* En-tête carte */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-blue-50 rounded-xl flex items-center justify-center">
              <svg className="w-5 h-5 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
              </svg>
            </div>
            <div>
              <h2 className="text-sm font-semibold text-gray-900">ClamAV</h2>
              <p className="text-xs text-gray-400">Antivirus open-source — scan des binaires à l'import</p>
            </div>
          </div>
          {!loading && status && (
            <div className="flex items-center gap-2">
              <StatusBadge ok={status.available} label={status.available ? "Actif" : "Inactif"} />
              <StatusBadge ok={status.daemon_running} label={status.daemon_running ? "Daemon actif" : "Daemon arrêté"} />
            </div>
          )}
        </div>

        {loading ? (
          <div className="p-8 text-center text-gray-400 text-sm">Chargement...</div>
        ) : !status?.available ? (
          <div className="p-8 text-center text-red-400 text-sm">
            ClamAV n'est pas disponible dans ce conteneur.
          </div>
        ) : (
          <div className="p-6 space-y-6">
            {/* Infos version */}
            <div className="grid grid-cols-3 gap-4">
              <div className="bg-gray-50 rounded-lg p-4">
                <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">Version</p>
                <p className="text-lg font-bold text-gray-900 font-mono">{status.version || "–"}</p>
              </div>
              <div className="bg-gray-50 rounded-lg p-4">
                <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">Version DB</p>
                <p className="text-lg font-bold text-gray-900 font-mono">{status.db_version || "–"}</p>
              </div>
              <div className="bg-gray-50 rounded-lg p-4">
                <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">Date DB</p>
                <p className="text-sm font-semibold text-gray-700">{status.db_date || "–"}</p>
              </div>
            </div>

            {/* Fichiers de la DB */}
            {status.db_files?.length > 0 && (
              <div>
                <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
                  Fichiers de signatures ({status.db_files.length})
                </h3>
                <div className="border border-gray-200 rounded-lg overflow-hidden">
                  <table className="w-full">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-4 py-2 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Fichier</th>
                        <th className="px-4 py-2 text-right text-xs font-semibold text-gray-500 uppercase tracking-wider">Taille</th>
                        <th className="px-4 py-2 text-right text-xs font-semibold text-gray-500 uppercase tracking-wider">Modifié</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {status.db_files.map((f, i) => (
                        <tr key={i} className="hover:bg-gray-50">
                          <td className="px-4 py-2.5 text-sm font-mono text-gray-800">{f.name}</td>
                          <td className="px-4 py-2.5 text-xs text-right text-gray-500 font-mono">{formatBytes(f.size_bytes)}</td>
                          <td className="px-4 py-2.5 text-xs text-right text-gray-400">
                            {new Date(f.modified_at).toLocaleString("fr-FR")}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="text-xs text-gray-400 mt-1.5">
                  Stockés sur le volume hôte — persistants entre les redémarrages.
                </p>
              </div>
            )}

            {/* Mise à jour manuelle */}
            <div className="border-t border-gray-100 pt-5">
              {/* Cooldown warning */}
              {status?.cooldown_until && new Date(status.cooldown_until) > new Date() && (
                <div className="mb-4 flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3">
                  <svg className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                      d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                  <div>
                    <p className="text-xs font-semibold text-amber-800">Rate limit CDN ClamAV</p>
                    <p className="text-xs text-amber-700 mt-0.5">
                      Trop de requêtes récentes. Mise à jour disponible après{" "}
                      <strong>{new Date(status.cooldown_until).toLocaleTimeString("fr-FR")}</strong>.
                      Le daemon mettra à jour automatiquement dès que possible.
                    </p>
                  </div>
                </div>
              )}
              <div className="flex items-center justify-between mb-3">
                <div>
                  <h3 className="text-sm font-semibold text-gray-800">Mise à jour manuelle</h3>
                  <p className="text-xs text-gray-400 mt-0.5">
                    La base se met aussi à jour automatiquement toutes les 12h via le daemon.
                  </p>
                </div>
                <button
                  onClick={handleUpdate}
                  disabled={running || (status?.cooldown_until && new Date(status.cooldown_until) > new Date())}
                  className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium
                             rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
                >
                  {running ? (
                    <>
                      <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                          d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                      </svg>
                      Mise à jour...
                    </>
                  ) : (
                    <>
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                          d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                      </svg>
                      Mettre à jour maintenant
                    </>
                  )}
                </button>
              </div>

              {/* Logs SSE */}
              {logs.length > 0 && (
                <div className="border border-gray-800 rounded-xl bg-gray-900 p-4">
                  <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
                    Progression
                    {done && <span className="text-green-400 ml-2">— Terminé</span>}
                    {running && <span className="text-yellow-400 ml-2">— En cours...</span>}
                  </p>
                  <div ref={logsRef} className="max-h-56 overflow-y-auto space-y-0.5">
                    {logs.map((line, i) => <LogLine key={i} line={line} />)}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Pipeline de sécurité */}
      <div className="bg-white border border-gray-200 rounded-xl p-6">
        <h2 className="text-sm font-semibold text-gray-800 mb-4">Pipeline de sécurité à l'import</h2>
        <div className="space-y-3">
          {[
            {
              step: "1",
              name: "Format .deb",
              desc: "Vérification que le fichier est un paquet Debian valide via dpkg-deb.",
              color: "bg-blue-100 text-blue-700",
              blocking: true,
            },
            {
              step: "2",
              name: "Provenance SHA256",
              desc: "Comparaison du SHA256 du fichier téléchargé avec celui stocké dans Packages.gz. Protège contre les attaques man-in-the-middle.",
              color: "bg-purple-100 text-purple-700",
              blocking: true,
            },
            {
              step: "3",
              name: "Antivirus ClamAV",
              desc: "Scan complet du binaire contre la base de signatures ClamAV. Détecte les malwares et virus connus.",
              color: "bg-red-100 text-red-700",
              blocking: true,
            },
            {
              step: "4",
              name: "Signature GPG",
              desc: "Vérification de la signature GPG si un fichier .sig est présent. Non bloquant si absent.",
              color: "bg-yellow-100 text-yellow-700",
              blocking: false,
            },
            {
              step: "5",
              name: "Dépendances",
              desc: "Vérification de la disponibilité des dépendances dans le dépôt interne. Non bloquant — avertissement uniquement.",
              color: "bg-green-100 text-green-700",
              blocking: false,
            },
          ].map((item) => (
            <div key={item.step} className="flex items-start gap-4">
              <span className={`shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold ${item.color}`}>
                {item.step}
              </span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-semibold text-gray-800">{item.name}</p>
                  {item.blocking ? (
                    <span className="text-xs px-1.5 py-0.5 bg-red-50 text-red-600 rounded font-medium">Bloquant</span>
                  ) : (
                    <span className="text-xs px-1.5 py-0.5 bg-gray-100 text-gray-500 rounded font-medium">Avertissement</span>
                  )}
                </div>
                <p className="text-xs text-gray-500 mt-0.5">{item.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
