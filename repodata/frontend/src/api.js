const API_URL = "http://192.168.1.123:8000"; // Remplace "backend" par "localhost" si nécessaire

// Récupérer la liste des paquets
export async function listPackages() {
    const response = await fetch(`${API_URL}/packages/`);
    return response.json();
}

// Installer un paquet
export async function installPackage(name) {
    const response = await fetch(`${API_URL}/packages/install`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify({ name }), // Envoie le nom du paquet dans le corps
    });
    return response.json();
}

// Ajouter un paquet (upload)
export async function uploadPackage(file) {
    const formData = new FormData();
    formData.append("file", file);

    const response = await fetch(`${API_URL}/packages/upload`, {
        method: "POST",
        body: formData, // Pas besoin de headers pour FormData
    });

    return response.json();
}
