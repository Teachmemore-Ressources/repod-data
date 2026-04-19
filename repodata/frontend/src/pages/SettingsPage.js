import { useState, useEffect, useRef } from "react";
import toast from "react-hot-toast";
import {
  getSettings,
  patchSettings,
  testWebhook,
  getNextSync,
  getApiBaseUrl,
} from "../api";

const API_URL = getApiBaseUrl();

// ─── Sources connues (label lisible) ─────────────────────────────────────────

const SOURCE_META = {
  "ubuntu-jammy":          { label: "Ubuntu 22.04 (Jammy) — base",     security: false },
  "ubuntu-jammy-updates":  { label: "Ubuntu 22.04 (Jammy) — updates",  security: false },
  "ubuntu-noble":          { label: "Ubuntu 24.04 (Noble) — base",     security: false },
  "ubuntu-focal":          { label: "Ubuntu 20.04 (Focal) — base",     security: false },
  "debian-bookworm":       { label: "Debian 12 (Bookworm) — base",     security: false },
  "ubuntu-jammy-security": { label: "Ubuntu 22.04 Security",           security: true  },
  "ubuntu-noble-security": { label: "Ubuntu 24.04 Security",           security: true  },
  "ubuntu-focal-security": { label: "Ubuntu 20.04 Security",           security: true  },
  "debian-bookworm-security": { label: "Debian 12 Security",           security: true  },
};

// ─── Composants utilitaires ───────────────────────────────────────────────────

function SectionCard({ title, description, icon, children }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div className="px-6 py-4 border-b border-gray-100 flex items-center gap-3">
        <span className="text-xl">{icon}</span>
        <div>
          <h2 className="text-sm font-semibold text-gray-900">{title}</h2>
          {description && <p className="text-xs text-gray-500 mt-0.5">{description}</p>}
        </div>
      </div>
      <div className="px-6 py-5 space-y-5">{children}</div>
    </div>
  );
}

function Toggle({ checked, onChange, disabled = false }) {
  return (
    <button
      type="button"
      onClick={() => !disabled && onChange(!checked)}
      disabled={disabled}
      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none
        ${checked ? "bg-blue-600" : "bg-gray-300"}
        ${disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}
    >
      <span
        className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform
          ${checked ? "translate-x-6" : "translate-x-1"}`}
      />
    </button>
  );
}

function FieldRow({ label, hint, children }) {
  return (
    <div className="flex items-start justify-between gap-6">
      <div className="min-w-0">
        <p className="text-sm font-medium text-gray-800">{label}</p>
        {hint && <p className="text-xs text-gray-400 mt-0.5">{hint}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function SaveButton({ onClick, saving, dirty }) {
  return (
    <div className="flex justify-end pt-2">
      <button
        onClick={onClick}
        disabled={saving || !dirty}
        className="px-5 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg
                   hover:bg-blue-700 disabled:opacity-40 transition-colors"
      >
        {saving ? "Enregistrement..." : "Enregistrer"}
      </button>
    </div>
  );
}

// ─── Logs SSE (sync manuelle) ─────────────────────────────────────────────────

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

// ─── Section : Synchronisation ────────────────────────────────────────────────

function SyncSection({ settings, onChange }) {
  const sync = settings.sync || {};
  const [logs, setLogs] = useState([]);
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(false);
  const [nextRun, setNextRun] = useState(null);
  const logsRef = useRef(null);

  useEffect(() => {
    getNextSync()
      .then((d) => setNextRun(d.next_run))
      .catch(() => {});
  }, [done]);

  useEffect(() => {
    if (logsRef.current) logsRef.current.scrollTop = logsRef.current.scrollHeight;
  }, [logs]);

  const handleManualSync = () => {
    const token = localStorage.getItem("token");
    setLogs([]);
    setDone(false);
    setRunning(true);

    fetch(`${API_URL}/import/sync-security`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({}),
    }).then(async (resp) => {
      if (!resp.ok) {
        setLogs(["error|Erreur serveur"]);
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
    }).catch(() => { setLogs(["error|Connexion perdue"]); setRunning(false); });
  };

  const HOURS = Array.from({ length: 24 }, (_, i) => i);
  const MINUTES = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55];

  return (
    <SectionCard
      icon="🕐"
      title="Synchronisation automatique"
      description="Planifiez la récupération quotidienne des métadonnées APT de sécurité."
    >
      <FieldRow
        label="Activer la sync automatique"
        hint="Désactiver stoppe le cron — la sync manuelle reste disponible."
      >
        <Toggle
          checked={sync.enabled ?? true}
          onChange={(v) => onChange("sync", { ...sync, enabled: v })}
        />
      </FieldRow>

      <div className={`space-y-4 ${!(sync.enabled ?? true) ? "opacity-40 pointer-events-none" : ""}`}>
        <FieldRow
          label="Heure de déclenchement"
          hint="Heure et minute (fuseau Europe/Paris)"
        >
          <div className="flex items-center gap-2">
            <select
              value={sync.hour ?? 3}
              onChange={(e) => onChange("sync", { ...sync, hour: parseInt(e.target.value) })}
              className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {HOURS.map((h) => (
                <option key={h} value={h}>{String(h).padStart(2, "0")}h</option>
              ))}
            </select>
            <span className="text-gray-400 text-sm">:</span>
            <select
              value={sync.minute ?? 0}
              onChange={(e) => onChange("sync", { ...sync, minute: parseInt(e.target.value) })}
              className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {MINUTES.map((m) => (
                <option key={m} value={m}>{String(m).padStart(2, "0")}</option>
              ))}
            </select>
          </div>
        </FieldRow>

        {nextRun && (
          <p className="text-xs text-gray-500 bg-blue-50 border border-blue-100 rounded-lg px-3 py-2">
            ⏰ Prochain déclenchement :{" "}
            <strong>{new Date(nextRun).toLocaleString("fr-FR")}</strong>
          </p>
        )}
      </div>

      {/* Sync manuelle */}
      <div className="pt-2 border-t border-gray-100">
        <div className="flex items-center justify-between mb-3">
          <div>
            <p className="text-sm font-medium text-gray-800">Synchronisation manuelle</p>
            <p className="text-xs text-gray-400">Déclenche immédiatement la sync des sources sécurité actives.</p>
          </div>
          <button
            onClick={handleManualSync}
            disabled={running}
            className="flex items-center gap-2 px-4 py-2 bg-red-600 text-white text-sm font-medium
                       rounded-lg hover:bg-red-700 disabled:opacity-50 transition-colors"
          >
            🔒 {running ? "En cours..." : "Sync sécurité"}
          </button>
        </div>
        {logs.length > 0 && (
          <div className="border border-gray-800 rounded-lg bg-gray-900 p-3">
            <div ref={logsRef} className="max-h-40 overflow-y-auto space-y-0.5">
              {logs.map((line, i) => <LogLine key={i} line={line} />)}
            </div>
          </div>
        )}
      </div>
    </SectionCard>
  );
}

// ─── Section : Sources APT ────────────────────────────────────────────────────

function SourcesSection({ settings, onChange }) {
  const sources = settings.sources || {};
  const standardIds = Object.keys(SOURCE_META).filter((id) => !SOURCE_META[id].security);
  const securityIds = Object.keys(SOURCE_META).filter((id) => SOURCE_META[id].security);

  const SourceRow = ({ id }) => {
    const meta = SOURCE_META[id] || { label: id, security: false };
    const enabled = sources[id] ?? true;
    return (
      <div className="flex items-center justify-between py-2.5 border-b border-gray-50 last:border-0">
        <div className="flex items-center gap-2">
          {meta.security && <span title="Source de sécurité">🔒</span>}
          <div>
            <p className="text-sm text-gray-800">{meta.label}</p>
            <p className="text-xs text-gray-400 font-mono">{id}</p>
          </div>
        </div>
        <Toggle
          checked={enabled}
          onChange={(v) => onChange("sources", { ...sources, [id]: v })}
        />
      </div>
    );
  };

  return (
    <SectionCard
      icon="📦"
      title="Sources APT"
      description="Activez ou désactivez chaque source. Les sources désactivées sont ignorées lors de la synchronisation et de la recherche."
    >
      <div>
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Sources standard</p>
        {standardIds.map((id) => <SourceRow key={id} id={id} />)}
      </div>
      <div>
        <p className="text-xs font-semibold text-red-500 uppercase tracking-wider mb-2">🔒 Sources de sécurité (CVE)</p>
        {securityIds.map((id) => <SourceRow key={id} id={id} />)}
      </div>
    </SectionCard>
  );
}

// ─── Section : Notifications ──────────────────────────────────────────────────

function NotificationsSection({ settings, onChange }) {
  const notif = settings.notifications || {};
  const [testing, setTesting] = useState(false);

  const handleTest = async () => {
    setTesting(true);
    try {
      await testWebhook();
      toast.success("Message de test envoyé !");
    } catch (err) {
      toast.error(err.response?.data?.detail || "Erreur lors du test webhook");
    } finally {
      setTesting(false);
    }
  };

  return (
    <SectionCard
      icon="🔔"
      title="Notifications"
      description="Recevez un rapport après chaque sync de sécurité (Slack, Teams, Mattermost ou tout service compatible webhook)."
    >
      <FieldRow label="Activer les notifications" hint="Envoie un résumé après chaque sync automatique.">
        <Toggle
          checked={notif.webhook_enabled ?? false}
          onChange={(v) => onChange("notifications", { ...notif, webhook_enabled: v })}
        />
      </FieldRow>

      <div className={`space-y-4 ${!(notif.webhook_enabled) ? "opacity-40 pointer-events-none" : ""}`}>
        <div>
          <label className="block text-sm font-medium text-gray-800 mb-1.5">URL Webhook</label>
          <div className="flex gap-2">
            <input
              type="url"
              value={notif.webhook_url || ""}
              onChange={(e) => onChange("notifications", { ...notif, webhook_url: e.target.value })}
              placeholder="https://hooks.slack.com/services/..."
              className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm
                         focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <button
              onClick={handleTest}
              disabled={testing || !notif.webhook_url}
              className="px-4 py-2 bg-gray-800 text-white text-sm rounded-lg
                         hover:bg-gray-700 disabled:opacity-40 transition-colors"
            >
              {testing ? "..." : "Tester"}
            </button>
          </div>
          <p className="text-xs text-gray-400 mt-1">
            Compatible Slack, Teams (Incoming Webhook), Mattermost, Discord (/slack endpoint).
          </p>
        </div>

        <FieldRow
          label="Seuil de notification"
          hint="N'envoie une alerte que si au moins N nouveaux paquets sont indexés."
        >
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={1}
              max={100}
              value={notif.webhook_min_packages ?? 1}
              onChange={(e) =>
                onChange("notifications", { ...notif, webhook_min_packages: parseInt(e.target.value) || 1 })
              }
              className="w-20 px-3 py-1.5 border border-gray-300 rounded-lg text-sm text-center
                         focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <span className="text-sm text-gray-500">paquet(s)</span>
          </div>
        </FieldRow>
      </div>
    </SectionCard>
  );
}

// ─── Section : Rétention ─────────────────────────────────────────────────────

function RetentionSection({ settings, onChange }) {
  const ret = settings.retention || {};

  return (
    <SectionCard
      icon="🗂️"
      title="Rétention & nettoyage"
      description="Durée de conservation des logs et des fichiers temporaires."
    >
      <FieldRow
        label="Rétention des logs d'audit"
        hint="Les logs plus anciens seront supprimés automatiquement."
      >
        <div className="flex items-center gap-2">
          <input
            type="number"
            min={7}
            max={3650}
            value={ret.audit_days ?? 90}
            onChange={(e) =>
              onChange("retention", { ...ret, audit_days: parseInt(e.target.value) || 90 })
            }
            className="w-24 px-3 py-1.5 border border-gray-300 rounded-lg text-sm text-center
                       focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <span className="text-sm text-gray-500">jours</span>
        </div>
      </FieldRow>

      <FieldRow
        label="Nettoyage des groupes d'import"
        hint="Supprime les fichiers temporaires dans /repos/imports après ce délai."
      >
        <div className="flex items-center gap-2">
          <input
            type="number"
            min={1}
            max={365}
            value={ret.import_cleanup_days ?? 30}
            onChange={(e) =>
              onChange("retention", { ...ret, import_cleanup_days: parseInt(e.target.value) || 30 })
            }
            className="w-24 px-3 py-1.5 border border-gray-300 rounded-lg text-sm text-center
                       focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <span className="text-sm text-gray-500">jours</span>
        </div>
      </FieldRow>
    </SectionCard>
  );
}

// ─── Section : Validation ─────────────────────────────────────────────────────

function ValidationSection({ settings, onChange }) {
  const val = settings.validation || {};

  return (
    <SectionCard
      icon="🛡️"
      title="Validation des paquets"
      description="Contrôles appliqués à chaque paquet importé ou uploadé manuellement."
    >
      <FieldRow
        label="Vérification SHA256"
        hint="Compare le hash du fichier téléchargé avec celui de l'index upstream."
      >
        <Toggle
          checked={val.sha256_check ?? true}
          onChange={(v) => onChange("validation", { ...val, sha256_check: v })}
        />
      </FieldRow>

      <FieldRow
        label="Scan antivirus ClamAV"
        hint="Analyse chaque .deb avant de l'accepter dans le dépôt."
      >
        <Toggle
          checked={val.clamav_scan ?? true}
          onChange={(v) => onChange("validation", { ...val, clamav_scan: v })}
        />
      </FieldRow>

      <FieldRow
        label="Taille max upload manuel"
        hint="Limite la taille des fichiers .deb uploadés via l'interface."
      >
        <div className="flex items-center gap-2">
          <input
            type="number"
            min={1}
            max={4096}
            value={val.max_upload_size_mb ?? 500}
            onChange={(e) =>
              onChange("validation", { ...val, max_upload_size_mb: parseInt(e.target.value) || 500 })
            }
            className="w-24 px-3 py-1.5 border border-gray-300 rounded-lg text-sm text-center
                       focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <span className="text-sm text-gray-500">Mo</span>
        </div>
      </FieldRow>
    </SectionCard>
  );
}

// ─── Page principale ──────────────────────────────────────────────────────────

export default function SettingsPage() {
  const [settings, setSettings] = useState(null);
  const [original, setOriginal] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    getSettings()
      .then((data) => {
        setSettings(data);
        setOriginal(JSON.stringify(data));
      })
      .catch(() => toast.error("Impossible de charger les paramètres"))
      .finally(() => setLoading(false));
  }, []);

  const isDirty = settings && JSON.stringify(settings) !== original;

  const handleChange = (section, value) => {
    setSettings((prev) => ({ ...prev, [section]: value }));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const updated = await patchSettings(settings);
      setSettings(updated);
      setOriginal(JSON.stringify(updated));
      toast.success("Paramètres enregistrés");
    } catch (err) {
      toast.error(err.response?.data?.detail || "Erreur lors de la sauvegarde");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24 text-gray-400 text-sm">
        Chargement des paramètres...
      </div>
    );
  }

  if (!settings) {
    return (
      <div className="text-center py-24 text-red-500 text-sm">
        Impossible de charger les paramètres. Vérifiez que vous êtes connecté en tant qu'administrateur.
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-2xl">
      {/* En-tête */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Paramètres</h1>
          <p className="text-sm text-gray-500 mt-1">
            Configuration du serveur repod (admin uniquement).
          </p>
        </div>
        {isDirty && (
          <span className="text-xs bg-yellow-100 text-yellow-700 border border-yellow-200
                           px-3 py-1 rounded-full font-medium">
            Modifications non sauvegardées
          </span>
        )}
      </div>

      {/* Sections */}
      <SyncSection settings={settings} onChange={handleChange} />
      <SourcesSection settings={settings} onChange={handleChange} />
      <NotificationsSection settings={settings} onChange={handleChange} />
      <RetentionSection settings={settings} onChange={handleChange} />
      <ValidationSection settings={settings} onChange={handleChange} />

      {/* Bouton global de sauvegarde */}
      <div className="bg-white rounded-xl border border-gray-200 px-6 py-4">
        <SaveButton onClick={handleSave} saving={saving} dirty={isDirty} />
      </div>
    </div>
  );
}
