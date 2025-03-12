import React from "react";
import PackageList from "./components/PackageList";
import UploadForm from "./components/UploadForm";

function App() {
    return (
        <div className="container">
            <h1>🎛️ Gestion des Paquets APT</h1>
            <UploadForm />
            <PackageList />
        </div>
    );
}

export default App;
