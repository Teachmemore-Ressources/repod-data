import { useState, useEffect, useCallback, useRef } from "react";
import toast from "react-hot-toast";
import { listArtifacts, deleteArtifact, syncIndex, getArtifact, resolveDependencies, getApiBaseUrl } from "../api";

const REPO_URL = process.env.REACT_APP_REPO_URL || "http://localhost:80";
const API_URL = getApiBaseUrl();

function formatBytes(bytes) {
  if (!bytes) return "–";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

function formatDate(iso) {
  if (!iso) return "–";
  return new Date(iso).toLocaleDateString("fr-FR", {
    day: "2-digit", month: "short", year: "numeric",
  });
}

function copyToClipboard(text) {
  navigator.clipboard.writeText(text).then(
    () => toast.success("Commande copiée"),
    () => toast.error("Impossible de copier")
  );
}

function LogLine({ line }) {
  if (!line) return null;
  const [level, ...rest] = line.split("|");
  const msg = rest.join("|");
  const styles = {
    info: "text-gray-300", success: "text-green-400",
    error: "text-red-400", warning: "text-yellow-400",
    skip: "text-gray-500", done: "text-blue-400 font-semibold",
  };
  return (
    <p className={`text-xs font-mono leading-relaxed ${styles[level] || "text-gray-300"}`}>
      {msg}
    </p>
  );
}

// ─── Panel : Résoudre les dépendances manquantes ──────────────────────────────

function ResolvePanel({ pkg, onClose, onResolved }) {
  const [logs, setLogs] = useState([]);
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(false);
  const logsRef = useRef(null);
  const missing = pkg.deps_missing || [];

  useEffect(() => {
    if (logsRef.current) logsRef.current.scrollTop = logsRef.current.scrollHeight;
  }, [logs]);

  useEffect(() => {
    if (done) {
      setTimeout(() => { onResolved(); }, 1500);
    }
  }, [done, onResolved]);

  const handleImport = () => {
    if (missing.length === 0) return;
    setLogs([]);
    setDone(false);
    setRunning(true);

    const token = localStorage.getItem("token");
    fetch(`${API_URL}/import/batch`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ packages: missing, group: pkg.name }),
    }).then(async (resp) => {
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ detail: "Erreur inconnue" }));
        setLogs([`error|${err.detail}`]);
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
    <>
      <div className="fixed inset-0 z-40 bg-black/30" onClick={!running ? onClose : undefined} />
      <div className="fixed inset-y-0 right-0 z-50 w-full max-w-lg bg-white shadow-2xl flex flex-col overflow-hidden">

        {/* En-tête */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-amber-100 rounded-lg flex items-center justify-center">
              <svg className="w-5 h-5 text-amber-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
            </div>
            <div>
              <h2 className="font-semibold text-gray-900">Résoudre les dépendances</h2>
              <p className="text-xs text-gray-400 font-mono">{pkg.name}</p>
            </div>
          </div>
          <button onClick={onClose} disabled={running}
            className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors disabled:opacity-40">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-5">

          {/* Bannière */}
          <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
            <p className="text-sm font-semibold text-amber-800">
              {missing.length} dépendance(s) manquante(s) dans le dépôt
            </p>
            <p className="text-xs text-amber-600 mt-0.5">
              Ces paquets sont requis par <span className="font-mono font-semibold">{pkg.name}</span> mais absents du dépôt.
            </p>
          </div>

          {/* Liste des deps manquantes */}
          <div>
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
              Dépendances à importer
            </h3>
            <div className="border border-gray-200 rounded-xl overflow-hidden">
              <ul className="divide-y divide-gray-100">
                {missing.map((dep) => (
                  <li key={dep} className="flex items-center gap-3 px-4 py-3 bg-white">
                    <div className="w-5 h-5 rounded-full bg-red-100 flex items-center justify-center shrink-0">
                      <svg className="w-3 h-3 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </div>
                    <span className="font-mono text-sm text-gray-800">{dep}</span>
                    <span className="ml-auto text-xs text-red-500 font-medium">Manquant</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          {/* Bouton d'import */}
          {!done && (
            <button
              onClick={handleImport}
              disabled={running || missing.length === 0}
              className="w-full flex items-center justify-center gap-2 py-3 bg-blue-600 text-white
                         text-sm font-medium rounded-xl hover:bg-blue-700 disabled:opacity-50 transition-colors"
            >
              {running ? (
                <>
                  <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                      d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                  Import en cours...
                </>
              ) : (
                <>
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                      d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M9 19l3 3m0 0l3-3m-3 3V10" />
                  </svg>
                  Importer automatiquement ({missing.length} paquet{missing.length > 1 ? "s" : ""})
                </>
              )}
            </button>
          )}

          {done && (
            <div className="flex items-center gap-3 bg-green-50 border border-green-200 rounded-xl px-4 py-3">
              <svg className="w-5 h-5 text-green-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              <p className="text-sm font-semibold text-green-800">Import terminé — mise à jour en cours…</p>
            </div>
          )}

          {/* Logs SSE */}
          {logs.length > 0 && (
            <div>
              <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
                Progression
              </h3>
              <div className="border border-gray-800 rounded-xl bg-gray-900 p-4">
                <div ref={logsRef} className="max-h-56 overflow-y-auto space-y-0.5">
                  {logs.map((line, i) => <LogLine key={i} line={line} />)}
                </div>
              </div>
            </div>
          )}

          {/* Avertissement index */}
          {!running && logs.length === 0 && (
            <p className="text-xs text-gray-400 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2.5">
              Les paquets seront téléchargés depuis l'index APT synchronisé.
              Si l'index n'est pas à jour, allez dans <strong>Importer → Synchronisation</strong>.
            </p>
          )}
        </div>
      </div>
    </>
  );
}

// ─── Panneau de détail / inspection ──────────────────────────────────────────

function InspectPanel({ pkg, onClose }) {
  const [detail, setDetail]   = useState(null);
  const [deps, setDeps]       = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      getArtifact(pkg.name).catch(() => null),
      resolveDependencies(pkg.name).catch(() => null),
    ]).then(([d, r]) => {
      setDetail(d);
      setDeps(r);
    }).finally(() => setLoading(false));
  }, [pkg.name]);

  const latest          = detail?.info?.latest;
  const verInfo         = latest ? detail?.info?.versions?.[latest] : null;
  const allDeps         = deps?.dependencies ?? [];
  const missing         = deps?.missing ?? [];
  const satisfied       = deps?.all_satisfied ?? true;
  const validationSteps = detail?.validation_steps ?? [];

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/30" onClick={onClose} />
      <div className="fixed inset-y-0 right-0 z-50 w-full max-w-lg bg-white shadow-2xl flex flex-col overflow-hidden">

        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-blue-100 rounded-lg flex items-center justify-center">
              <svg className="w-5 h-5 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10" />
              </svg>
            </div>
            <div>
              <h2 className="font-mono font-semibold text-gray-900">{pkg.name}</h2>
              <p className="text-xs text-gray-400">{pkg.latest_version} · {pkg.arch}</p>
            </div>
          </div>
          <button onClick={onClose}
            className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {loading ? (
          <div className="flex-1 flex items-center justify-center text-gray-400 text-sm">Chargement...</div>
        ) : (
          <div className="flex-1 overflow-y-auto">

            <div className={`mx-4 mt-4 rounded-xl px-4 py-3 flex items-center gap-3 ${
              satisfied ? "bg-green-50 border border-green-200" : "bg-amber-50 border border-amber-200"
            }`}>
              {satisfied ? (
                <svg className="w-5 h-5 text-green-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              ) : (
                <svg className="w-5 h-5 text-amber-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
              )}
              <div>
                <p className={`text-sm font-semibold ${satisfied ? "text-green-800" : "text-amber-800"}`}>
                  {satisfied
                    ? "Toutes les dépendances sont présentes"
                    : `${missing.length} dépendance(s) manquante(s)`}
                </p>
                {!satisfied && (
                  <p className="text-xs text-amber-700 mt-0.5 font-mono">
                    {missing.join(", ")}
                  </p>
                )}
              </div>
            </div>

            <section className="px-4 mt-5">
              <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">
                Informations du binaire
              </h3>
              <div className="bg-white border border-gray-200 rounded-xl divide-y divide-gray-100">
                {[
                  { label: "Nom",          value: pkg.name },
                  { label: "Version",      value: pkg.latest_version || "–" },
                  { label: "Architecture", value: pkg.arch || "–" },
                  { label: "Taille",       value: formatBytes(pkg.size_bytes) },
                  { label: "Section",      value: pkg.section || "–" },
                  { label: "Importé le",   value: formatDate(pkg.imported_at) },
                  { label: "Importé par",  value: pkg.imported_by || "–" },
                ].map(({ label, value }) => (
                  <div key={label} className="flex items-center px-4 py-2.5 gap-4">
                    <span className="text-xs text-gray-500 w-28 shrink-0">{label}</span>
                    <span className="text-sm text-gray-800 font-mono truncate">{value}</span>
                  </div>
                ))}
                {pkg.description && (
                  <div className="flex items-start px-4 py-2.5 gap-4">
                    <span className="text-xs text-gray-500 w-28 shrink-0 mt-0.5">Description</span>
                    <span className="text-sm text-gray-800">{pkg.description}</span>
                  </div>
                )}
              </div>
            </section>

            {verInfo?.sha256 && (
              <section className="px-4 mt-5">
                <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Intégrité</h3>
                <div className="bg-white border border-gray-200 rounded-xl px-4 py-3">
                  <div className="flex items-start gap-3">
                    <svg className="w-4 h-4 text-green-500 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                        d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                    </svg>
                    <div className="min-w-0">
                      <p className="text-xs text-gray-500 mb-0.5">SHA-256</p>
                      <p className="text-xs font-mono text-gray-700 break-all">{verInfo.sha256}</p>
                    </div>
                    <button onClick={() => copyToClipboard(verInfo.sha256)}
                      className="shrink-0 p-1 text-gray-400 hover:text-gray-600" title="Copier">
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                          d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                      </svg>
                    </button>
                  </div>
                </div>
              </section>
            )}

            {/* ── Sécurité (étapes de validation) ── */}
            {validationSteps.length > 0 && (
              <section className="px-4 mt-5">
                <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">
                  Sécurité & Validation
                </h3>
                <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
                  <ul className="divide-y divide-gray-100">
                    {validationSteps.map((step, i) => {
                      const isWarning = step.warning && !step.passed;
                      const color = step.passed || isWarning
                        ? isWarning ? "text-amber-500" : "text-green-500"
                        : "text-red-500";
                      const bg = step.passed || isWarning
                        ? isWarning ? "bg-amber-50/50" : ""
                        : "bg-red-50/50";
                      const labels = {
                        format: "Format .deb",
                        provenance: "Provenance SHA256",
                        antivirus: "Antivirus ClamAV",
                        gpg: "Signature GPG",
                        checksum: "Checksum",
                        dependencies: "Dépendances",
                      };
                      return (
                        <li key={i} className={`flex items-start gap-3 px-4 py-3 ${bg}`}>
                          <svg className={`w-4 h-4 shrink-0 mt-0.5 ${color}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            {step.passed || isWarning ? (
                              isWarning
                                ? <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                                : <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                            ) : (
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                            )}
                          </svg>
                          <div className="min-w-0 flex-1">
                            <p className="text-xs font-semibold text-gray-700">
                              {labels[step.name] || step.name}
                            </p>
                            <p className="text-xs text-gray-500 mt-0.5">{step.message}</p>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              </section>
            )}

            <section className="px-4 mt-5 mb-6">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Dépendances</h3>
                <span className="text-xs text-gray-400">
                  {allDeps.length === 0 ? "Aucune" : `${allDeps.length - missing.length}/${allDeps.length} disponibles`}
                </span>
              </div>
              {allDeps.length === 0 ? (
                <div className="bg-white border border-gray-200 rounded-xl px-4 py-6 text-center text-sm text-gray-400">
                  Ce paquet n'a aucune dépendance déclarée
                </div>
              ) : (
                <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
                  <ul className="divide-y divide-gray-100">
                    {allDeps.map((dep) => {
                      const present = dep.available_internally !== false;
                      return (
                        <li key={dep.name} className={`flex items-center justify-between px-4 py-3 ${!present ? "bg-red-50/60" : ""}`}>
                          <div className="flex items-center gap-2.5 min-w-0">
                            {present ? (
                              <div className="w-5 h-5 rounded-full bg-green-100 flex items-center justify-center shrink-0">
                                <svg className="w-3 h-3 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                                </svg>
                              </div>
                            ) : (
                              <div className="w-5 h-5 rounded-full bg-red-100 flex items-center justify-center shrink-0">
                                <svg className="w-3 h-3 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                                </svg>
                              </div>
                            )}
                            <div className="min-w-0">
                              <p className="font-mono text-sm text-gray-800 truncate">{dep.name}</p>
                              {dep.version_constraint && (
                                <p className="text-xs text-gray-400">{dep.version_constraint}</p>
                              )}
                            </div>
                          </div>
                          <span className={`text-xs font-medium shrink-0 ml-3 ${present ? "text-green-600" : "text-red-500"}`}>
                            {present ? "Dans le dépôt" : "Manquante"}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                  <div className="px-4 py-2.5 bg-gray-50 border-t border-gray-100 flex gap-4 text-xs">
                    <span className="flex items-center gap-1.5 text-green-700">
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                      {allDeps.length - missing.length} présente(s)
                    </span>
                    {missing.length > 0 && (
                      <span className="flex items-center gap-1.5 text-red-500">
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                        {missing.length} manquante(s)
                      </span>
                    )}
                  </div>
                </div>
              )}
            </section>
          </div>
        )}
      </div>
    </>
  );
}

// ─── Composant principal ──────────────────────────────────────────────────────

const DISTRIB_TABS = [
  { id: "all",      label: "Toutes" },
  { id: "jammy",    label: "Jammy 22.04" },
  { id: "noble",    label: "Noble 24.04" },
  { id: "focal",    label: "Focal 20.04" },
  { id: "bookworm", label: "Bookworm 12" },
];

const DISTRIB_COLORS = {
  jammy:    "bg-orange-100 text-orange-700",
  noble:    "bg-green-100 text-green-700",
  focal:    "bg-gray-100 text-gray-600",
  bookworm: "bg-red-100 text-red-700",
};

export default function PackageList() {
  const [packages, setPackages]         = useState([]);
  const [filter, setFilter]             = useState("");
  const [distribFilter, setDistribFilter] = useState("all");
  const [loading, setLoading]           = useState(true);
  const [deleting, setDeleting]         = useState("");
  const [syncing, setSyncing]           = useState(false);
  const [inspecting, setInspecting]     = useState(null);
  const [resolving, setResolving]       = useState(null);

  const fetchPackages = useCallback(() => {
    setLoading(true);
    listArtifacts()
      .then((data) => setPackages(data.packages || []))
      .catch(() => toast.error("Impossible de charger les paquets"))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { fetchPackages(); }, [fetchPackages]);

  const handleDelete = async (name) => {
    if (!window.confirm(`Supprimer ${name} du dépôt ?`)) return;
    setDeleting(name);
    try {
      await deleteArtifact(name);
      toast.success(`${name} supprimé`);
      if (inspecting?.name === name) setInspecting(null);
      fetchPackages();
    } catch {
      toast.error(`Impossible de supprimer ${name}`);
    } finally {
      setDeleting("");
    }
  };

  const handleSync = async () => {
    setSyncing(true);
    try {
      const result = await syncIndex();
      toast.success(`Index synchronisé — ${result.packages_indexed} paquet(s)`);
      fetchPackages();
    } catch {
      toast.error("Échec de la synchronisation");
    } finally {
      setSyncing(false);
    }
  };

  const handleResolved = useCallback(() => {
    setResolving(null);
    fetchPackages();
    toast.success("Dépendances importées — liste mise à jour");
  }, [fetchPackages]);

  const visible = packages.filter((p) => {
    const textMatch = p.name.toLowerCase().includes(filter.toLowerCase()) ||
      p.description?.toLowerCase().includes(filter.toLowerCase());
    const distMatch = distribFilter === "all" ||
      (p.distribution || "jammy") === distribFilter;
    return textMatch && distMatch;
  });

  return (
    <>
      {resolving && (
        <ResolvePanel
          pkg={resolving}
          onClose={() => setResolving(null)}
          onResolved={handleResolved}
        />
      )}
      {inspecting && !resolving && (
        <InspectPanel pkg={inspecting} onClose={() => setInspecting(null)} />
      )}

      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Paquets disponibles</h1>
            <p className="text-sm text-gray-500 mt-0.5">
              {packages.length} paquet(s) — accessible via{" "}
              <code className="bg-gray-100 px-1.5 py-0.5 rounded text-xs font-mono">apt install</code>
            </p>
          </div>
          <button onClick={handleSync} disabled={syncing}
            className="flex items-center gap-2 px-3 py-2 text-sm text-gray-600 border rounded-lg
                       hover:bg-gray-50 disabled:opacity-40 transition-colors">
            <svg className={`w-4 h-4 ${syncing ? "animate-spin" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            {syncing ? "Sync..." : "Sync index"}
          </button>
        </div>

        <div className="relative">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400"
            fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0" />
          </svg>
          <input type="text" placeholder="Rechercher un paquet..." value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 border border-gray-300 rounded-lg text-sm
                       focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white" />
        </div>

        {/* Filtre par distribution */}
        <div className="flex items-center gap-2 flex-wrap">
          {DISTRIB_TABS.map((tab) => {
            const count = tab.id === "all"
              ? packages.length
              : packages.filter((p) => (p.distribution || "jammy") === tab.id).length;
            return (
              <button
                key={tab.id}
                onClick={() => setDistribFilter(tab.id)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                  distribFilter === tab.id
                    ? "bg-blue-600 text-white border-blue-600"
                    : "text-gray-500 border-gray-200 hover:border-blue-400 hover:text-blue-600"
                }`}
              >
                {tab.label}
                <span className={`px-1.5 py-0.5 rounded text-xs ${
                  distribFilter === tab.id ? "bg-white/20 text-white" : "bg-gray-100 text-gray-500"
                }`}>{count}</span>
              </button>
            );
          })}
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          {loading ? (
            <div className="p-10 text-center text-gray-400 text-sm">Chargement...</div>
          ) : visible.length === 0 ? (
            <div className="p-10 text-center text-gray-400 text-sm">
              {filter ? "Aucun paquet ne correspond." : "Le dépôt est vide."}
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50 text-xs text-gray-500 uppercase tracking-wider">
                  <th className="text-left px-5 py-3 font-semibold">Paquet</th>
                  <th className="text-left px-4 py-3 font-semibold">Version</th>
                  <th className="text-left px-4 py-3 font-semibold hidden md:table-cell">Arch</th>
                  <th className="text-left px-4 py-3 font-semibold hidden lg:table-cell">Taille</th>
                  <th className="text-left px-4 py-3 font-semibold hidden lg:table-cell">Importé le</th>
                  <th className="text-left px-4 py-3 font-semibold">Statut</th>
                  <th className="px-4 py-3 text-right font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {visible.map((pkg) => {
                  const debUrl       = pkg.filename ? `${REPO_URL}/repos/pool/${pkg.filename}` : null;
                  const aptCmd       = `sudo apt install ${pkg.name}`;
                  const isInspecting = inspecting?.name === pkg.name;
                  const isResolving  = resolving?.name === pkg.name;
                  const hasMissing   = pkg.deps_missing?.length > 0;

                  return (
                    <tr key={pkg.name}
                      className={`transition-colors ${
                        isResolving ? "bg-amber-50" : isInspecting ? "bg-blue-50" : "hover:bg-gray-50"
                      }`}>

                      <td className="px-5 py-3.5">
                        <div className="flex items-center gap-2.5">
                          <div className="w-7 h-7 bg-blue-100 rounded-md flex items-center justify-center shrink-0">
                            <svg className="w-3.5 h-3.5 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                                d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10" />
                            </svg>
                          </div>
                          <div>
                            <div className="flex items-center gap-2">
                              <p className="font-mono font-medium text-gray-900">{pkg.name}</p>
                              {pkg.distribution && (
                                <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${DISTRIB_COLORS[pkg.distribution] || "bg-gray-100 text-gray-600"}`}>
                                  {pkg.distribution}
                                </span>
                              )}
                            </div>
                            {pkg.description && (
                              <p className="text-xs text-gray-400 truncate max-w-xs">{pkg.description}</p>
                            )}
                          </div>
                        </div>
                      </td>

                      <td className="px-4 py-3.5">
                        <span className="font-mono text-gray-700">{pkg.latest_version || "–"}</span>
                        {pkg.versions?.length > 1 && (
                          <span className="ml-1 text-xs text-gray-400">(+{pkg.versions.length - 1})</span>
                        )}
                      </td>

                      <td className="px-4 py-3.5 hidden md:table-cell">
                        <span className="px-2 py-0.5 bg-gray-100 rounded text-xs text-gray-600 font-mono">
                          {pkg.arch}
                        </span>
                      </td>

                      <td className="px-4 py-3.5 text-gray-500 hidden lg:table-cell">
                        {formatBytes(pkg.size_bytes)}
                      </td>

                      <td className="px-4 py-3.5 text-gray-500 hidden lg:table-cell">
                        {formatDate(pkg.imported_at)}
                      </td>

                      {/* Statut — cliquable si deps manquantes */}
                      <td className="px-4 py-3.5">
                        {hasMissing ? (
                          <button
                            onClick={() => setResolving(isResolving ? null : pkg)}
                            title={`Manquants : ${pkg.deps_missing.join(", ")}`}
                            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium
                                        transition-colors cursor-pointer ${
                              isResolving
                                ? "bg-amber-300 text-amber-900"
                                : "bg-amber-100 text-amber-700 hover:bg-amber-200"
                            }`}
                          >
                            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                            </svg>
                            {pkg.deps_missing.length} dep{pkg.deps_missing.length > 1 ? "s" : ""} manquante{pkg.deps_missing.length > 1 ? "s" : ""}
                          </button>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-green-100 text-green-700 rounded-full text-xs font-medium">
                            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                            </svg>
                            Disponible
                          </span>
                        )}
                      </td>

                      {/* Actions */}
                      <td className="px-4 py-3.5">
                        <div className="flex items-center justify-end gap-1.5">

                          {/* Inspecter */}
                          <button
                            onClick={() => setInspecting(isInspecting ? null : pkg)}
                            className={`p-2 rounded-lg transition-colors border ${
                              isInspecting
                                ? "bg-blue-600 text-white border-blue-600"
                                : "text-gray-500 border-gray-200 hover:border-blue-400 hover:text-blue-600 hover:bg-blue-50"
                            }`}
                            title="Inspecter"
                          >
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                                d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                            </svg>
                          </button>

                          {/* Résoudre (deps manquantes) ou Copier apt install */}
                          {hasMissing ? (
                            <button
                              onClick={() => setResolving(isResolving ? null : pkg)}
                              className={`p-2 rounded-lg transition-colors border ${
                                isResolving
                                  ? "bg-amber-500 text-white border-amber-500"
                                  : "text-amber-600 border-amber-200 hover:bg-amber-50 hover:border-amber-400"
                              }`}
                              title="Résoudre les dépendances manquantes"
                            >
                              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                                  d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M9 19l3 3m0 0l3-3m-3 3V10" />
                              </svg>
                            </button>
                          ) : (
                            <button
                              onClick={() => copyToClipboard(aptCmd)}
                              className="p-2 rounded-lg transition-colors border text-gray-500 border-gray-200
                                         hover:bg-gray-900 hover:text-white hover:border-gray-900"
                              title={`Copier : ${aptCmd}`}
                            >
                              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                                  d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                              </svg>
                            </button>
                          )}

                          {/* Télécharger .deb */}
                          {debUrl && (
                            <a href={debUrl} download
                              className="p-2 rounded-lg transition-colors border text-gray-500 border-gray-200
                                         hover:bg-gray-50 hover:text-gray-700"
                              title="Télécharger le .deb">
                              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                                  d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                              </svg>
                            </a>
                          )}

                          {/* Supprimer */}
                          <button onClick={() => handleDelete(pkg.name)} disabled={deleting === pkg.name}
                            className="p-2 rounded-lg transition-colors border border-transparent
                                       text-red-400 hover:bg-red-50 hover:border-red-200 hover:text-red-600
                                       disabled:opacity-40"
                            title="Supprimer du dépôt">
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                                d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </>
  );
}
