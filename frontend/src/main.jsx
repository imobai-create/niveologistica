import React from "react";
import ReactDOM from "react-dom/client";
import ChamacargaMVP from "./ChamacargaMVP.jsx";
import Motorista from "./Motorista.jsx";
import "./index.css";

const Root = window.location.pathname.startsWith("/motorista") ? Motorista : ChamacargaMVP;

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>,
);

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  });
}
