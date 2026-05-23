import React, { useEffect, useRef, useState } from "react";
import { Camera, MapPin, CheckCircle2, ChevronLeft, Truck, AlertTriangle, Pen, RotateCcw } from "lucide-react";
import { listarAbertas, registrarPod, adicionarEvento } from "./api";

const C = {
  bg: "#0E2A26", green: "#1E5F4F", mint: "#2FBF93", paper: "#F4F8F6",
  ink: "#16241F", mute: "#5C6F69", line: "#E0E8E4", red: "#D2544B", amber: "#E08A3C",
};

const fmtT = (s) => (s ? new Date(s).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : "—");

export default function Motorista() {
  const [entregas, setEntregas] = useState(null);
  const [sel, setSel] = useState(null);
  const [erro, setErro] = useState(null);

  const carregar = async () => {
    setErro(null);
    try {
      setEntregas(await listarAbertas());
    } catch {
      setErro("Não foi possível carregar as entregas. Verifique a conexão.");
      setEntregas([]);
    }
  };
  useEffect(() => { carregar(); }, []);

  if (sel) {
    return <PodScreen entrega={sel} onBack={() => { setSel(null); carregar(); }} />;
  }

  return (
    <div style={{ background: C.paper, color: C.ink, fontFamily: "system-ui, -apple-system, Segoe UI, sans-serif" }} className="min-h-screen">
      <header style={{ background: C.bg, color: "#fff" }} className="px-4 py-3 flex items-center gap-2">
        <Truck size={20} color={C.mint} />
        <span className="font-semibold">Rastro · Motorista</span>
        <button onClick={carregar} className="ml-auto text-xs flex items-center gap-1 opacity-80">
          <RotateCcw size={13} /> Atualizar
        </button>
      </header>

      {erro && (
        <div style={{ background: C.red + "14", color: C.red }} className="text-sm px-4 py-2 flex items-center gap-2">
          <AlertTriangle size={14} /> {erro}
        </div>
      )}

      <div className="p-3 space-y-2">
        {!entregas && <div style={{ color: C.mute }} className="text-sm text-center py-12">Carregando…</div>}
        {entregas && entregas.length === 0 && (
          <div style={{ color: C.mute }} className="text-sm text-center py-12">
            Nenhuma entrega aberta agora.
          </div>
        )}
        {entregas?.map((e) => (
          <button key={e.id} onClick={() => setSel(e)}
            style={{ background: "#fff", borderColor: C.line }}
            className="w-full text-left border rounded-xl p-3 active:opacity-70">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-sm">{e.cliente}</span>
              <span style={{ background: C.mint + "22", color: C.green }} className="text-xs font-semibold px-2 py-0.5 rounded-full">
                {e.status.replace(/_/g, " ")}
              </span>
            </div>
            <div style={{ color: C.mute }} className="text-xs mt-1">{e.ref} · {e.destinatario}</div>
            <div style={{ color: C.mute }} className="text-xs mt-1 flex items-center gap-1">
              <MapPin size={11} /> {e.endereco || "—"}
            </div>
            <div style={{ color: C.mute }} className="text-xs mt-1">
              Janela: {fmtT(e.janela_i)}–{fmtT(e.janela_f)}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

function PodScreen({ entrega, onBack }) {
  const [foto, setFoto] = useState(null);
  const [recebedor, setRecebedor] = useState("");
  const [doc, setDoc] = useState("");
  const [coord, setCoord] = useState(null);
  const [assinatura, setAssinatura] = useState(null);
  const [busy, setBusy] = useState(false);
  const [ok, setOk] = useState(false);
  const [erro, setErro] = useState(null);
  const fotoRef = useRef(null);

  const capturarGps = () => {
    if (!navigator.geolocation) { setErro("Geolocalização não disponível neste navegador."); return; }
    navigator.geolocation.getCurrentPosition(
      (pos) => setCoord({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      (err) => setErro("Não foi possível obter GPS: " + err.message),
      { enableHighAccuracy: true, timeout: 10000 },
    );
  };

  const onFoto = (ev) => {
    const f = ev.target.files?.[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => setFoto(reader.result);
    reader.readAsDataURL(f);
  };

  const enviar = async () => {
    setErro(null);
    if (!recebedor.trim()) { setErro("Informe quem recebeu."); return; }
    if (!foto) { setErro("Tire a foto do POD."); return; }
    if (!assinatura) { setErro("Colete a assinatura."); return; }
    if (!coord) { setErro("Capture o GPS."); return; }
    setBusy(true);
    try {
      await registrarPod(entrega.id, {
        recebedor_nome: recebedor,
        recebedor_doc: doc || null,
        foto_url: foto,
        assinatura_url: assinatura,
        lat: coord.lat,
        lng: coord.lng,
      });
      setOk(true);
    } catch (e) {
      setErro("Falha ao enviar: " + (e.message || "erro desconhecido"));
    } finally {
      setBusy(false);
    }
  };

  const tentativa = async () => {
    setBusy(true);
    try {
      await adicionarEvento(entrega.id, {
        tipo: "tentativa",
        autor: "motorista",
        lat: coord?.lat ?? null,
        lng: coord?.lng ?? null,
        detalhe: { motivo: "Destinatário ausente" },
      });
      onBack();
    } catch (e) {
      setErro("Falha ao registrar tentativa: " + (e.message || ""));
    } finally {
      setBusy(false);
    }
  };

  if (ok) {
    return (
      <div style={{ background: C.paper, color: C.ink }} className="min-h-screen flex flex-col items-center justify-center p-6 text-center">
        <CheckCircle2 size={56} color={C.green} />
        <div className="font-semibold mt-3">POD registrado</div>
        <div style={{ color: C.mute }} className="text-sm mt-1">{entrega.cliente} · {entrega.ref}</div>
        <button onClick={onBack} style={{ background: C.green, color: "#fff" }} className="mt-6 rounded-lg px-4 py-2 text-sm font-semibold">
          Voltar para a fila
        </button>
      </div>
    );
  }

  return (
    <div style={{ background: C.paper, color: C.ink, fontFamily: "system-ui, -apple-system, Segoe UI, sans-serif" }} className="min-h-screen">
      <header style={{ background: C.bg, color: "#fff" }} className="px-4 py-3 flex items-center gap-3">
        <button onClick={onBack}><ChevronLeft size={22} /></button>
        <div>
          <div className="font-semibold text-sm">{entrega.cliente}</div>
          <div style={{ color: "#9DB3AC" }} className="text-xs">{entrega.ref}</div>
        </div>
      </header>

      <div className="p-4 space-y-4 pb-32">
        <div style={{ background: "#fff", borderColor: C.line }} className="border rounded-xl p-3">
          <div style={{ color: C.mute }} className="text-xs">Destinatário</div>
          <div className="font-semibold text-sm">{entrega.destinatario}</div>
          <div style={{ color: C.mute }} className="text-xs mt-1 flex items-center gap-1">
            <MapPin size={12} /> {entrega.endereco || "—"}
          </div>
        </div>

        <Campo label="Quem recebeu" >
          <input value={recebedor} onChange={(e) => setRecebedor(e.target.value)}
            placeholder="Nome completo" style={{ borderColor: C.line }}
            className="w-full border rounded-lg px-3 py-2 text-sm outline-none" />
        </Campo>

        <Campo label="Documento (opcional)">
          <input value={doc} onChange={(e) => setDoc(e.target.value)}
            placeholder="CPF / RG" style={{ borderColor: C.line }}
            className="w-full border rounded-lg px-3 py-2 text-sm outline-none" />
        </Campo>

        <Campo label="Foto do POD">
          <div className="flex items-center gap-2">
            <button onClick={() => fotoRef.current?.click()}
              style={{ background: foto ? C.green : "#fff", color: foto ? "#fff" : C.ink, borderColor: C.line }}
              className="border rounded-lg px-3 py-2 text-sm font-semibold flex items-center gap-2">
              <Camera size={15} /> {foto ? "Refazer" : "Tirar foto"}
            </button>
            <input ref={fotoRef} type="file" accept="image/*" capture="environment"
              onChange={onFoto} className="hidden" />
            {foto && <img src={foto} alt="POD" style={{ height: 64, borderRadius: 8 }} />}
          </div>
        </Campo>

        <Campo label="GPS">
          <div className="flex items-center gap-2">
            <button onClick={capturarGps}
              style={{ background: coord ? C.green : "#fff", color: coord ? "#fff" : C.ink, borderColor: C.line }}
              className="border rounded-lg px-3 py-2 text-sm font-semibold flex items-center gap-2">
              <MapPin size={15} /> {coord ? "Recapturar" : "Capturar GPS"}
            </button>
            {coord && (
              <span style={{ color: C.mute }} className="text-xs">
                {coord.lat.toFixed(5)}, {coord.lng.toFixed(5)}
              </span>
            )}
          </div>
        </Campo>

        <Campo label="Assinatura">
          <Assinatura onChange={setAssinatura} />
        </Campo>

        {erro && (
          <div style={{ background: C.red + "14", color: C.red }} className="text-sm rounded-lg p-2 flex items-center gap-2">
            <AlertTriangle size={14} /> {erro}
          </div>
        )}
      </div>

      <div style={{ background: "#fff", borderColor: C.line }} className="fixed bottom-0 left-0 right-0 border-t p-3 flex gap-2">
        <button onClick={tentativa} disabled={busy}
          style={{ borderColor: C.amber, color: C.amber }}
          className="flex-1 border rounded-lg py-3 text-sm font-semibold disabled:opacity-50">
          Tentativa sem êxito
        </button>
        <button onClick={enviar} disabled={busy}
          style={{ background: C.green, color: "#fff" }}
          className="flex-1 rounded-lg py-3 text-sm font-semibold disabled:opacity-50">
          {busy ? "Enviando…" : "Confirmar entrega"}
        </button>
      </div>
    </div>
  );
}

function Campo({ label, children }) {
  return (
    <div>
      <div style={{ color: C.mute }} className="text-xs font-semibold mb-1 uppercase tracking-wide">{label}</div>
      {children}
    </div>
  );
}

function Assinatura({ onChange }) {
  const canvasRef = useRef(null);
  const drawingRef = useRef(false);
  const lastRef = useRef(null);

  useEffect(() => {
    const c = canvasRef.current;
    const ratio = window.devicePixelRatio || 1;
    c.width = c.offsetWidth * ratio;
    c.height = 160 * ratio;
    const ctx = c.getContext("2d");
    ctx.scale(ratio, ratio);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.lineWidth = 2;
    ctx.strokeStyle = C.ink;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, c.width, c.height);
  }, []);

  const pos = (ev) => {
    const c = canvasRef.current;
    const rect = c.getBoundingClientRect();
    const p = ev.touches ? ev.touches[0] : ev;
    return { x: p.clientX - rect.left, y: p.clientY - rect.top };
  };

  const start = (ev) => { ev.preventDefault(); drawingRef.current = true; lastRef.current = pos(ev); };
  const move = (ev) => {
    if (!drawingRef.current) return;
    ev.preventDefault();
    const ctx = canvasRef.current.getContext("2d");
    const p = pos(ev);
    ctx.beginPath();
    ctx.moveTo(lastRef.current.x, lastRef.current.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    lastRef.current = p;
  };
  const end = () => {
    if (!drawingRef.current) return;
    drawingRef.current = false;
    onChange(canvasRef.current.toDataURL("image/png"));
  };

  const limpar = () => {
    const c = canvasRef.current;
    const ctx = c.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, c.width, c.height);
    onChange(null);
  };

  return (
    <div>
      <canvas ref={canvasRef}
        onMouseDown={start} onMouseMove={move} onMouseUp={end} onMouseLeave={end}
        onTouchStart={start} onTouchMove={move} onTouchEnd={end}
        style={{ background: "#fff", borderColor: C.line, width: "100%", height: 160, touchAction: "none" }}
        className="border rounded-lg" />
      <button onClick={limpar} style={{ color: C.mute }} className="text-xs mt-1 flex items-center gap-1">
        <Pen size={12} /> Limpar e assinar de novo
      </button>
    </div>
  );
}
