import { useState, useEffect } from "react";
import { getDashboardStats } from "../api";
import toast from "react-hot-toast";

function formatBytes(bytes) {
  if (!bytes) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function StatCard({ label, value, sub, color = "blue", icon }) {
  const colors = {
    blue: "bg-blue-50 text-blue-600",
    green: "bg-green-50 text-green-600",
    yellow: "bg-yellow-50 text-yellow-600",
    red: "bg-red-50 text-red-600",
    purple: "bg-purple-50 text-purple-600",
  };
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-5 flex items-start gap-4">
      <div className={`w-11 h-11 rounded-xl flex items-center justify-center shrink-0 ${colors[color]}`}>
        {icon}
      </div>
      <div className="min-w-0">
        <p className="text-xs text-gray-500 font-medium uppercase tracking-wider">{label}</p>
        <p className="text-2xl font-bold text-gray-900 mt-0.5">{value}</p>
        {sub && <p className="text-xs text-gray-400 mt-0.5">{sub}</p>}
      </div>
    </div>
  );
}

function ActivityBar({ day, imports, failures, max }) {
  const totalMax = Math.max(max, 1);
  const importsH = Math.round((imports / totalMax) * 60);
  const failuresH = Math.round((failures / totalMax) * 60);
  const label = day.slice(5); // MM-DD

  return (
    <div className="flex flex-col items-center gap-1 flex-1 min-w-0">
      <div className="flex flex-col-reverse items-center gap-0.5 h-16">
        {failures > 0 && (
          <div
            className="w-5 rounded-sm bg-red-400"
            style={{ height: `${failuresH}px` }}
            title={`${failures} échec(s)`}
          />
        )}
        {imports > 0 && (
          <div
            className="w-5 rounded-sm bg-blue-500"
            style={{ height: `${importsH}px` }}
            title={`${imports} import(s)`}
          />
        )}
        {imports === 0 && failures === 0 && (
          <div className="w-5 rounded-sm bg-gray-100 h-1" />
        )}
      </div>
      <span className="text-xs text-gray-400 font-mono">{label}</span>
    </div>
  );
}

function AlertItem({ alert }) {
  const isDepsMissing = alert.type === "deps_missing";
  return (
    <div className={`flex items-start gap-3 p-3 rounded-lg ${isDepsMissing ? "bg-yellow-50" : "bg-red-50"}`}>
      <div className={`w-1.5 h-1.5 rounded-full mt-1.5 shrink-0 ${isDepsMissing ? "bg-yellow-400" : "bg-red-400"}`} />
      <div className="min-w-0">
        <p className="text-sm font-medium text-gray-800 truncate">{alert.package}</p>
        <p className="text-xs text-gray-500 mt-0.5">{alert.message}</p>
        {alert.deps?.length > 0 && (
          <p className="text-xs text-gray-400 mt-0.5 font-mono truncate">
            {alert.deps.slice(0, 3).join(", ")}{alert.deps.length > 3 ? ` +${alert.deps.length - 3}` : ""}
          </p>
        )}
      </div>
    </div>
  );
}

function RecentImportRow({ entry }) {
  const ts = entry.timestamp ? new Date(entry.timestamp).toLocaleString("fr-FR") : "–";
  return (
    <tr className="hover:bg-gray-50">
      <td className="px-4 py-2.5 text-sm font-mono text-gray-800 truncate max-w-[180px]">
        {entry.package || "–"}
      </td>
      <td className="px-4 py-2.5 text-xs text-gray-500">{entry.action || "–"}</td>
      <td className="px-4 py-2.5 text-xs text-gray-400 text-right">{ts}</td>
    </tr>
  );
}

export default function DashboardPage() {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    load();
    const id = setInterval(load, 30000);
    return () => clearInterval(id);
  }, []);

  const load = async () => {
    try {
      const data = await getDashboardStats();
      setStats(data);
    } catch {
      toast.error("Impossible de charger le tableau de bord");
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-gray-400 text-sm">
        Chargement...
      </div>
    );
  }

  if (!stats) return null;

  const { packages, activity, recent_imports, alerts, clamav } = stats;
  const maxActivity = Math.max(...activity.map((d) => d.imports + d.failures), 1);

  return (
    <div className="space-y-6 max-w-5xl">
      {/* En-tête */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Tableau de bord</h1>
          <p className="text-sm text-gray-500 mt-1">Vue d'ensemble du dépôt APT.</p>
        </div>
        <button
          onClick={load}
          className="flex items-center gap-2 text-xs text-gray-400 hover:text-gray-600 transition-colors"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
          Actualiser
        </button>
      </div>

      {/* Stats cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Paquets"
          value={packages.total}
          sub={formatBytes(packages.total_size_bytes)}
          color="blue"
          icon={
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10" />
            </svg>
          }
        />
        <StatCard
          label="Imports aujourd'hui"
          value={packages.imports_today}
          color="green"
          icon={
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M9 19l3 3m0 0l3-3m-3 3V10" />
            </svg>
          }
        />
        <StatCard
          label="Dépendances manquantes"
          value={packages.deps_missing_count}
          color={packages.deps_missing_count > 0 ? "yellow" : "green"}
          icon={
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          }
        />
        <StatCard
          label="Antivirus ClamAV"
          value={clamav.available ? (clamav.daemon_running ? "Actif" : "Sans daemon") : "Inactif"}
          sub={clamav.db_version ? `DB v${clamav.db_version}` : undefined}
          color={clamav.available && clamav.daemon_running ? "green" : clamav.available ? "yellow" : "red"}
          icon={
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
            </svg>
          }
        />
      </div>

      {/* Activité + Alertes */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Activité 7 jours */}
        <div className="bg-white border border-gray-200 rounded-xl p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-gray-800">Activité — 7 derniers jours</h2>
            <div className="flex items-center gap-3 text-xs text-gray-400">
              <span className="flex items-center gap-1">
                <span className="w-2.5 h-2.5 rounded-sm bg-blue-500 inline-block" /> Imports
              </span>
              <span className="flex items-center gap-1">
                <span className="w-2.5 h-2.5 rounded-sm bg-red-400 inline-block" /> Échecs
              </span>
            </div>
          </div>
          <div className="flex items-end gap-2">
            {activity.map((d) => (
              <ActivityBar
                key={d.date}
                day={d.date}
                imports={d.imports}
                failures={d.failures}
                max={maxActivity}
              />
            ))}
          </div>
        </div>

        {/* Alertes */}
        <div className="bg-white border border-gray-200 rounded-xl p-5">
          <h2 className="text-sm font-semibold text-gray-800 mb-3">
            Alertes
            {alerts.length > 0 && (
              <span className="ml-2 inline-flex items-center justify-center w-5 h-5 rounded-full bg-red-100 text-red-600 text-xs font-bold">
                {alerts.length}
              </span>
            )}
          </h2>
          {alerts.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-32 text-gray-300">
              <svg className="w-8 h-8 mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                  d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <p className="text-sm">Aucune alerte</p>
            </div>
          ) : (
            <div className="space-y-2 max-h-52 overflow-y-auto">
              {alerts.map((a, i) => <AlertItem key={i} alert={a} />)}
            </div>
          )}
        </div>
      </div>

      {/* Imports récents */}
      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100">
          <h2 className="text-sm font-semibold text-gray-800">Imports récents</h2>
        </div>
        {recent_imports.length === 0 ? (
          <div className="p-8 text-center text-gray-400 text-sm">Aucun import enregistré.</div>
        ) : (
          <table className="w-full">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-2 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Paquet</th>
                <th className="px-4 py-2 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Action</th>
                <th className="px-4 py-2 text-right text-xs font-semibold text-gray-500 uppercase tracking-wider">Date</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {recent_imports.map((e, i) => <RecentImportRow key={i} entry={e} />)}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
