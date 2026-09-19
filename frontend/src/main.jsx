import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import ChamacargaMVP from "./ChamacargaMVP.jsx";
import Motorista from "./Motorista.jsx";
import ReservarJanela from "./ReservarJanela.jsx";
import DossiePublico from "./DossiePublico.jsx";
import Login from "./Login.jsx";
import { AuthProvider, RequireAuth } from "./auth.jsx";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/r/:token" element={<ReservarJanela />} />
          <Route path="/d/:token" element={<DossiePublico />} />
          <Route path="/motorista" element={<RequireAuth><Motorista /></RequireAuth>} />
          <Route path="/" element={<RequireAuth><ChamacargaMVP /></RequireAuth>} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>,
);

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  });
}
