import React, { useState } from "react";
import { uploadPackage } from "../api";


function UploadForm() {
    const [file, setFile] = useState(null);

    const handleFileChange = (event) => {
        setFile(event.target.files[0]);
    };

    const handleUpload = async () => {
        if (file) {
            await uploadPackage(file);
            alert("✅ Paquet ajouté avec succès !");
            setFile(null);
        } else {
            alert("❌ Veuillez sélectionner un fichier .deb");
        }
    };

    return (
        <div className="upload-form">
            <h2>📤 Ajouter un paquet</h2>
            <input type="file" onChange={handleFileChange} />
            <button onClick={handleUpload}>📥 Ajouter</button>
        </div>
    );
}

export default UploadForm;
