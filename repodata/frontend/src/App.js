import { BrowserRouter, Routes, Route } from "react-router-dom";
import { Toaster } from "react-hot-toast";
import { AuthProvider } from "./context/AuthContext";
import ProtectedRoute from "./components/ProtectedRoute";
import LoginPage from "./pages/LoginPage";
import DashboardLayout from "./layouts/DashboardLayout";
import PackageList from "./components/PackageList";
import UploadForm from "./components/UploadForm";
import ClientSetupPage from "./pages/ClientSetupPage";
import ImportPage from "./pages/ImportPage";
import SecurityPage from "./pages/SecurityPage";
import DashboardPage from "./pages/DashboardPage";
import DistributionsPage from "./pages/DistributionsPage";

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Toaster position="top-right" toastOptions={{ duration: 4000 }} />
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route
            path="/"
            element={
              <ProtectedRoute>
                <DashboardLayout />
              </ProtectedRoute>
            }
          >
            <Route index element={<DashboardPage />} />
            <Route path="packages" element={<PackageList />} />
            <Route path="upload" element={<UploadForm />} />
            <Route path="setup" element={<ClientSetupPage />} />
            <Route path="import" element={<ImportPage />} />
            <Route path="security" element={<SecurityPage />} />
            <Route path="distributions" element={<DistributionsPage />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
