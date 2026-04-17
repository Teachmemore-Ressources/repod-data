import { useCallback, useState } from "react";
import { useDropzone } from "react-dropzone";
import toast from "react-hot-toast";
import { uploadPackage } from "../api";

function ValidationStep({ step }) {
  const isWarning = step.warning && !step.passed;
  const icon = step.passed || isWarning ? (
    isWarning ? (
      <svg className="w-4 h-4 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
          d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
      </svg>
    ) : (
      <svg className="w-4 h-4 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
      </svg>
    )
  ) : (
    <svg className="w-4 h-4 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
    </svg>
  );

  const labelMap = {
    format: "Format",
    checksum: "Intégrité (SHA-256)",
    gpg: "Signature GPG",
    dependencies: "Dépendances",
  };

  return (
    <li className="flex items-start gap-3 py-2.5">
      <span className="mt-0.5 shrink-0">{icon}</span>
      <div className="flex-1 min-w-0">
        <p className={`text-sm font-medium ${
          step.passed || isWarning
            ? isWarning ? "text-amber-700" : "text-green-700"
            : "text-red-700"
        }`}>
          {labelMap[step.name] || step.name}
        </p>
        <p className="text-xs text-gray-500 mt-0.5 truncate">{step.message}</p>
        {step.detail && (
          <p className="text-xs text-gray-400 mt-0.5 font-mono break-all">{step.detail}</p>
        )}
      </div>
    </li>
  );
}

const DISTRIBUTIONS = [
  { codename: "jammy", label: "Ubuntu 22.04 LTS (Jammy) ⭐" },
  { codename: "noble", label: "Ubuntu 24.04 LTS (Noble)" },
  { codename: "focal", label: "Ubuntu 20.04 LTS (Focal)" },
  { codename: "bookworm", label: "Debian 12 (Bookworm)" },
];

export default function UploadForm() {
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState(null);
  const [distribution, setDistribution] = useState("jammy");

  const onDrop = useCallback(async (acceptedFiles) => {
    const file = acceptedFiles[0];
    if (!file) return;

    if (!file.name.endsWith(".deb")) {
      toast.error("Seuls les fichiers .deb sont acceptés");
      return;
    }

    setUploading(true);
    setResult(null);

    try {
      const data = await uploadPackage(file, distribution);
      setResult(data);
      if (data.status === "accepted") {
        toast.success(`${data.package} ${data.version} ajouté au dépôt`);
      } else {
        toast.error(`${file.name} rejeté — voir les détails`);
      }
    } catch (err) {
      const msg = err.response?.data?.detail || "Erreur lors de l'upload";
      toast.error(typeof msg === "string" ? msg : "Erreur serveur");
    } finally {
      setUploading(false);
    }
  }, []);

  const { getRootProps, getInputProps, isDragActive, isDragReject } = useDropzone({
    onDrop,
    accept: { "application/octet-stream": [".deb"] },
    multiple: false,
    disabled: uploading,
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Upload un paquet</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Le paquet sera validé automatiquement avant d'être ajouté au dépôt
        </p>
      </div>

      {/* Sélecteur de distribution */}
      <div className="bg-white border border-gray-200 rounded-xl p-4">
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Distribution cible
        </label>
        <div className="flex flex-wrap gap-2">
          {DISTRIBUTIONS.map((d) => (
            <button
              key={d.codename}
              type="button"
              onClick={() => setDistribution(d.codename)}
              className={`px-4 py-2 rounded-lg text-sm font-medium border transition-colors ${
                distribution === d.codename
                  ? "bg-blue-600 text-white border-blue-600"
                  : "text-gray-600 border-gray-200 hover:border-blue-400 hover:text-blue-600"
              }`}
            >
              {d.label}
            </button>
          ))}
        </div>
      </div>

      {/* Zone de dépôt */}
      <div
        {...getRootProps()}
        className={`border-2 border-dashed rounded-xl p-14 text-center cursor-pointer transition-all
          ${uploading ? "opacity-50 cursor-not-allowed" : ""}
          ${isDragReject ? "border-red-400 bg-red-50" : ""}
          ${isDragActive && !isDragReject ? "border-blue-500 bg-blue-50" : ""}
          ${!isDragActive && !isDragReject ? "border-gray-300 hover:border-blue-400 hover:bg-gray-50 bg-white" : ""}
        `}
      >
        <input {...getInputProps()} />
        <div className="flex flex-col items-center gap-3">
          {uploading ? (
            <>
              <div className="w-10 h-10 rounded-full border-4 border-blue-200 border-t-blue-600 animate-spin" />
              <p className="text-sm text-gray-500 font-medium">Validation en cours...</p>
            </>
          ) : isDragReject ? (
            <>
              <svg className="w-10 h-10 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M6 18L18 6M6 6l12 12" />
              </svg>
              <p className="text-sm text-red-500 font-medium">Fichier non supporté</p>
            </>
          ) : isDragActive ? (
            <>
              <svg className="w-10 h-10 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                  d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
              </svg>
              <p className="text-sm text-blue-600 font-medium">Déposez le fichier ici</p>
            </>
          ) : (
            <>
              <svg className="w-10 h-10 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                  d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
              </svg>
              <div>
                <p className="text-sm font-medium text-gray-700">
                  Glissez-déposez un fichier <span className="text-blue-600">.deb</span>
                </p>
                <p className="text-xs text-gray-400 mt-1">ou cliquez pour sélectionner</p>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Résultat de validation */}
      {result && (
        <div className={`rounded-xl border overflow-hidden ${
          result.status === "accepted" ? "border-green-200" : "border-red-200"
        }`}>
          {/* En-tête du résultat */}
          <div className={`px-5 py-4 flex items-center gap-3 ${
            result.status === "accepted" ? "bg-green-50" : "bg-red-50"
          }`}>
            {result.status === "accepted" ? (
              <svg className="w-5 h-5 text-green-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            ) : (
              <svg className="w-5 h-5 text-red-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            )}
            <div className="flex-1">
              <p className={`font-semibold text-sm ${
                result.status === "accepted" ? "text-green-800" : "text-red-800"
              }`}>
                {result.status === "accepted" ? "Paquet accepté" : "Paquet rejeté"}
              </p>
              <p className="text-xs text-gray-500 mt-0.5">{result.message}</p>
            </div>
            {result.status === "accepted" && (
              <div className="text-right">
                <p className="font-mono text-sm font-bold text-gray-900">{result.package}</p>
                <p className="text-xs text-gray-500">{result.version} · {result.arch}</p>
              </div>
            )}
          </div>

          {/* Étapes de validation */}
          {result.validation?.steps?.length > 0 && (
            <div className="px-5 bg-white">
              <ul className="divide-y divide-gray-100">
                {result.validation.steps.map((step, i) => (
                  <ValidationStep key={i} step={step} />
                ))}
              </ul>
            </div>
          )}

          {/* SHA-256 */}
          {result.sha256 && (
            <div className="px-5 py-3 bg-gray-50 border-t border-gray-100">
              <p className="text-xs text-gray-500">
                <span className="font-medium">SHA-256</span>{" "}
                <span className="font-mono text-gray-700 break-all">{result.sha256}</span>
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
