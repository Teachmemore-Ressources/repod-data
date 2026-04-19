import axios from "axios";

const API_URL = process.env.REACT_APP_API_URL || "http://localhost:8000";

const api = axios.create({ baseURL: API_URL });

// Injecte le token JWT sur chaque requête
api.interceptors.request.use((config) => {
  const token = localStorage.getItem("token");
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Redirige vers /login en cas de 401
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem("token");
      window.location.href = "/login";
    }
    return Promise.reject(error);
  }
);

export const login = (username, password) =>
  api.post("/auth/token", { username, password });

export const listPackages = () =>
  api.get("/packages/").then((r) => r.data);

// Artifacts — liste enrichie avec métadonnées
export const listArtifacts = () =>
  api.get("/artifacts/").then((r) => r.data);

export const getArtifact = (name) =>
  api.get(`/artifacts/${name}`).then((r) => r.data);

export const resolveDependencies = (name) =>
  api.get(`/artifacts/${name}/dependencies`).then((r) => r.data);

export const installArtifact = (name, target = "localhost") =>
  api.post(`/artifacts/${name}/install`, { target }).then((r) => r.data);

export const deleteArtifact = (name, version = null) => {
  const url = version ? `/artifacts/${name}/${version}` : `/artifacts/${name}`;
  return api.delete(url).then((r) => r.data);
};

export const getAuditLogs = (limit = 50) =>
  api.get(`/artifacts/audit/logs?limit=${limit}`).then((r) => r.data);

export const syncIndex = () =>
  api.post("/artifacts/admin/sync-index").then((r) => r.data);

export const installPackage = (name) =>
  api.post("/packages/install/", { name }).then((r) => r.data);

export const uploadPackage = (file, distribution = "jammy") => {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("distribution", distribution);
  return api.post("/upload/", formData).then((r) => r.data);
};

// ─── Import depuis internet ───────────────────────────────────────────────────

export const searchImportPackages = (q, limit = 20, source_id = null) => {
  const params = new URLSearchParams({ q, limit });
  if (source_id) params.append("source_id", source_id);
  return api.get(`/import/search?${params}`).then((r) => r.data);
};

export const resolveImportDeps = (packageName) =>
  api.get(`/import/resolve/${encodeURIComponent(packageName)}`).then((r) => r.data);

export const getImportSyncStatus = () =>
  api.get("/import/sync-status").then((r) => r.data);

export const getImportGroups = () =>
  api.get("/import/groups").then((r) => r.data);

export const deleteImportGroup = (name) =>
  api.delete(`/import/groups/${encodeURIComponent(name)}`).then((r) => r.data);

// ─── Sécurité / ClamAV ───────────────────────────────────────────────────────

export const getClamavStatus = () =>
  api.get("/security/clamav/status").then((r) => r.data);

export const getApiBaseUrl = () => API_URL;

// ─── Dashboard ───────────────────────────────────────────────────────────────

export const getDashboardStats = () =>
  api.get("/dashboard/stats").then((r) => r.data);

// ─── Distributions ───────────────────────────────────────────────────────────

export const getDistributions = () =>
  api.get("/distributions/").then((r) => r.data);

export const getDistribPackages = (codename) =>
  api.get(`/distributions/${codename}/packages`).then((r) => r.data);

export const promotePackage = (pkg, fromDist, toDist) =>
  api.post("/distributions/promote", { package: pkg, from_dist: fromDist, to_dist: toDist }).then((r) => r.data);

export const migrateDistrib = (fromDist, toDist) =>
  api.post("/distributions/migrate", { from_dist: fromDist, to_dist: toDist }).then((r) => r.data);

export const initDistributions = () =>
  api.post("/distributions/init").then((r) => r.data);

// ─── Paramètres ──────────────────────────────────────────────────────────────

// ─── Gestion des utilisateurs ─────────────────────────────────────────────────

export const getRoles = () =>
  api.get("/auth/roles").then((r) => r.data);

export const listUsers = () =>
  api.get("/auth/users").then((r) => r.data);

export const createUser = (payload) =>
  api.post("/auth/users", payload).then((r) => r.data);

export const updateUser = (username, payload) =>
  api.patch(`/auth/users/${encodeURIComponent(username)}`, payload).then((r) => r.data);

export const deleteUser = (username) =>
  api.delete(`/auth/users/${encodeURIComponent(username)}`).then((r) => r.data);

export const resetUserPassword = (username, newPassword) =>
  api.post(`/auth/users/${encodeURIComponent(username)}/reset-password`, { new_password: newPassword }).then((r) => r.data);

export const changeOwnPassword = (currentPassword, newPassword) =>
  api.post("/auth/change-password", { current_password: currentPassword, new_password: newPassword }).then((r) => r.data);

// ─── Paramètres ──────────────────────────────────────────────────────────────

export const getSettings = () =>
  api.get("/settings/").then((r) => r.data);

export const patchSettings = (partial) =>
  api.patch("/settings/", partial).then((r) => r.data);

export const testWebhook = () =>
  api.post("/settings/test-webhook").then((r) => r.data);

export const getNextSync = () =>
  api.get("/settings/next-sync").then((r) => r.data);

export const getSyncSchedule = () =>
  api.get("/import/sync-schedule").then((r) => r.data);
