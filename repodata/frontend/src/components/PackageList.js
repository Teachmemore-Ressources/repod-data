import React, { useState, useEffect } from "react";
import { listPackages, installPackage } from "../api";

const PackageList = () => {
    const [packages, setPackages] = useState([]);
    const [packageName, setPackageName] = useState("");
    const [logs, setLogs] = useState("");
    const [isLoading, setIsLoading] = useState(false);

    // Charger la liste des paquets
    useEffect(() => {
        async function fetchPackages() {
            try {
                const data = await listPackages();
                setPackages(data.packages);
            } catch (error) {
                console.error("Erreur de récupération :", error);
            }
        }
        fetchPackages();
    }, []);

    // Installer un paquet
    const handleInstall = async () => {
        if (!packageName) return alert("Veuillez entrer un nom de paquet");
        setIsLoading(true);
        setLogs("Installation en cours...");

        try {
            const result = await installPackage(packageName);
            //setLogs(result.logs);
             console.log(result);  // ⚠️ Ajoute cette ligne
             setLogs(JSON.stringify(result, null, 2)); // Affiche la réponse brute
        } catch (error) {
            setLogs("Erreur d'installation : " + error.message);
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="package-list">
            <h2>📦 Liste des Paquets</h2>
            <ul>
                {packages.map((pkg, index) => (
                    <li key={index}>{pkg}</li>
                ))}
            </ul>
            <h2>🔧 Installer un Paquet</h2>
            <input
                type="text"
                placeholder="Nom du paquet"
                value={packageName}
                onChange={(e) => setPackageName(e.target.value)}
            />
            <button onClick={handleInstall} disabled={isLoading}>
                {isLoading ? "Installation en cours..." : "Installer"}
            </button>
            {logs && <pre className="logs">{logs}</pre>}
        </div>
    );
};

export default PackageList;
