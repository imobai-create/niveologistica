# Rastro — Roteiro de Execução (6 semanas)

Ordem de montagem do MVP, com o que validar em cada etapa (o "gate" que libera a
próxima). A trilha **legal/comercial** roda em paralelo desde a Semana 0 — não espere
o software ficar pronto pra começar a vender.

---

## Semana 0 — Pré-obra (decisões que travam tudo)

Resolva ANTES de escrever qualquer linha:

- [ ] **Celular dos motoristas: Android.** O Web Bluetooth não roda em iPhone — se a
      frota for Android, o app de leitura do logger é um PWA simples. (ver `rastro_datalogger.md`)
- [ ] **Escolher o data logger** com SDK/export E **certificado de calibração** (exigência de auditoria).
- [ ] **Conta Supabase** (banco) + **chave da API Anthropic** (agente).
- [ ] **1 conta-âncora** definida para o piloto (alvo: 3PH Medicamentos).

**Gate:** as 4 decisões acima tomadas. Sem isso, não comece a codar.

---

## Semana 1 — Banco de dados

- [ ] Rodar `rastro_schema.sql` no SQL Editor do Supabase.
- [ ] `alter table entregas add column if not exists distancia_km numeric;`
- [ ] Inserir 1 cliente e 1 destinatário de teste via SQL.
- [ ] Planejar (ainda não ativar) as policies de RLS por cliente.

**Gate:** consegue criar um pedido manualmente e a view `vw_entrega_resumo` responde.

---

## Semana 2 — Backend (API)

- [ ] Subir `main.py` local (`uvicorn main:app --reload`), `.env` apontando ao Supabase.
- [ ] Em `/docs`, percorrer o fluxo: criar pedido → entrega → enviar leituras → ver excursão → dossiê.
- [ ] Testar `/agente/responder` com a chave Anthropic.

**Gate:** o ciclo completo funciona pela API e `avaliar_excursao()` dispara o alerta
quando você manda uma leitura fora da faixa.

---

## Semana 3 — Front-end

- [ ] Pegar `RastroMVP.jsx` e trocar o seed/`window.storage` por `fetch` aos endpoints
      (`GET /entregas`, `GET /entregas/{id}`, dossiê).
- [ ] App do motorista mínimo para POD (foto + GPS + assinatura) — PWA simples.

**Gate:** o painel mostra dados reais vindos do banco; o motorista registra um POD.

---

## Semana 4 — Logger + WhatsApp

- [ ] Integração BLE: app do motorista lê a curva do logger e faz `POST /entregas/{id}/leituras`.
- [ ] Plugar o agente no WhatsApp via um BSP (em ambiente sandbox primeiro).

**Gate:** a curva real entra no banco e gera excursão quando há desvio; o agente
responde no WhatsApp sandbox e aplica a ação (REAGENDAR/ESCALAR).

---

## Semana 5 — Deploy + endurecimento (NÃO PULAR)

- [ ] Hospedar o backend (Render / Railway / Fly).
- [ ] **Autenticação** em todos os endpoints (API key/JWT).
- [ ] **CORS** travado nos seus domínios (tirar o `*`).
- [ ] **Rate limit** no `/agente/responder` (controle de custo de API).
- [ ] **Ativar RLS** por cliente no Supabase.
- [ ] Definir **retenção e mascaramento LGPD** de dado pessoal.

**Gate:** ambiente protegido — nada mais aberto ao público.

---

## Semana 6 — Piloto real

- [ ] Rodar com a conta-âncora (3PH), região-piloto definida.
- [ ] Gerar o **primeiro dossiê real** e entregar ao cliente.
- [ ] Medir SLA (janela, sucesso 1ª tentativa, excursões).

**Gate:** 1ª entrega real com custódia + dossiê entregue ao cliente. É a prova da tese.

---

## Trilha paralela — Legal & Comercial (desde a Semana 0)

- [ ] Abrir empresa (CNAE 4930-2) + **RNTRC ativo na ANTT**.
- [ ] Cotar seguros **RCTR-C** e **RC-DC**.
- [ ] Validar tributação com contador (Simples pode derrubar a alíquota que usamos).
- [ ] Validar o **contrato de piloto** (`Contrato_Piloto_LastMile.docx`) com advogado ativo.
- [ ] Enviar a **proposta** (`Proposta_Comercial_LastMile.docx`) à 3PH e marcar o piloto.

---

## O que NÃO fazer ainda (evita queimar tempo/dinheiro)

- POD Vision (detecção de avaria por foto), previsão de ETA/falha, IoT de temperatura
  em tempo real, MKT, roteirização própria. Tudo Fase 2 — só com dados e escala.
- Comprar os 3 furgões antes de ter o contrato-âncora assinado.

---

## Arquivos do projeto

| Arquivo | Para quê |
|---|---|
| `rastro_schema.sql` | Banco (Supabase) |
| `main.py` + `requirements.txt` + `README_rastro_api.md` | Backend (API) |
| `RastroMVP.jsx` | Front-end (painel) |
| `rastro_agente_whatsapp.md` | Prompt do agente |
| `rastro_datalogger.md` | Integração do sensor de temperatura |
| `Rastro_Arquitetura.svg` | Diagrama de arquitetura |
| `Proposta_Comercial_LastMile.docx` · `Contrato_Piloto_LastMile.docx` | Comercial/jurídico |
| `IMOBAI_LastMile_3furgoes_VIAVEL.xlsx` | Viabilidade financeira |
