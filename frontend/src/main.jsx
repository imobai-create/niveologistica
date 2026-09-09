import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import ChamacargaMVP from "./ChamacargaMVP.jsx";
import Motorista from "./Motorista.jsx";
import ReservarJanela from "./ReservarJanela.jsx";
import DossiePublico from "./DossiePublico.jsx";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<ChamacargaMVP />} />
        <Route path="/motorista" element={<Motorista />} />
        <Route path="/r/:token" element={<ReservarJanela />} />
        <Route path="/d/:token" element={<DossiePublico />} />
      </Routes>
    </BrowserRouter>
  </React.StrictMode>,
);

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  });
}
