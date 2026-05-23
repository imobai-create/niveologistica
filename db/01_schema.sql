-- =====================================================================
-- RASTRO — Modelo de dados (PostgreSQL / Supabase)
-- Núcleo de custódia auditável para last-mile de carga sensível.
-- Princípios: 1 fonte de verdade por entrega; log de eventos imutável;
-- série temporal de temperatura; isolamento por cliente (RLS); LGPD.
-- =====================================================================

create extension if not exists pgcrypto;      -- gen_random_uuid()
-- create extension if not exists timescaledb; -- opcional: ver seção de série temporal

-- ---------------------------------------------------------------------
-- TIPOS
-- ---------------------------------------------------------------------
create type entrega_status as enum (
  'criada','coletada','em_rota','entregue','falha','cancelada','devolvida'
);

create type evento_tipo as enum (
  'criada','coletada','saiu_para_entrega','tentativa','entregue',
  'falha','reagendada','avaria','excursao_termica','observacao'
);

create type faixa_termica as enum (
  'congelado','refrigerado_2_8','controlado_15_30','ambiente'
);

-- ---------------------------------------------------------------------
-- CLIENTES (embarcadores) — ex.: 3PH Medicamentos
-- ---------------------------------------------------------------------
create table clientes (
  id            uuid primary key default gen_random_uuid(),
  razao_social  text not null,
  cnpj          text unique,
  segmento      text,                       -- farma, autopeças, cosmético...
  ativo         boolean not null default true,
  criado_em     timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- DESTINATÁRIOS — dado pessoal (LGPD). Operador trata em nome do cliente.
-- ---------------------------------------------------------------------
create table destinatarios (
  id            uuid primary key default gen_random_uuid(),
  cliente_id    uuid not null references clientes(id) on delete restrict,
  nome          text not null,
  telefone      text,                       -- E.164, ex.: +5531999999999
  documento     text,                       -- mascarar em logs
  endereco_raw  text,                       -- como veio do cliente
  endereco_norm text,                       -- normalizado (Address Intelligence)
  cep           text,
  lat           double precision,
  lng           double precision,
  geocode_score numeric(4,3),               -- confiança do geocoding 0..1
  criado_em     timestamptz not null default now()
);
comment on table destinatarios is 'Dado pessoal — base legal: execução de contrato (LGPD art. 7, V). Retenção limitada.';

-- ---------------------------------------------------------------------
-- MOTORISTAS / VEÍCULOS
-- ---------------------------------------------------------------------
create table motoristas (
  id          uuid primary key default gen_random_uuid(),
  nome        text not null,
  telefone    text,
  ativo       boolean not null default true,
  criado_em   timestamptz not null default now()
);

create table veiculos (
  id          uuid primary key default gen_random_uuid(),
  placa       text unique,
  modelo      text,                          -- ex.: BYD eT3
  eletrico    boolean not null default true,
  criado_em   timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- PEDIDOS — o que o cliente despacha (1 pedido => 1+ entregas/tentativas)
-- ---------------------------------------------------------------------
create table pedidos (
  id               uuid primary key default gen_random_uuid(),
  cliente_id       uuid not null references clientes(id) on delete restrict,
  destinatario_id  uuid not null references destinatarios(id) on delete restrict,
  ref_externa      text,                     -- nº do pedido no sistema do cliente
  valor_declarado  numeric(12,2),            -- base p/ seguro / responsabilidade
  termolabil       boolean not null default false,
  faixa            faixa_termica not null default 'ambiente',
  temp_min         numeric(4,1),             -- ex.: 2.0  (se refrigerado)
  temp_max         numeric(4,1),             -- ex.: 8.0
  janela_inicio    timestamptz,              -- SLA: início da janela
  janela_fim       timestamptz,              -- SLA: fim da janela
  criado_em        timestamptz not null default now(),
  unique (cliente_id, ref_externa)
);
create index on pedidos (cliente_id);
create index on pedidos (destinatario_id);

-- ---------------------------------------------------------------------
-- ENTREGAS — a unidade de custódia (uma execução do pedido)
-- ---------------------------------------------------------------------
create table entregas (
  id            uuid primary key default gen_random_uuid(),
  pedido_id     uuid not null references pedidos(id) on delete restrict,
  motorista_id  uuid references motoristas(id),
  veiculo_id    uuid references veiculos(id),
  logger_id     text,                        -- id do data logger BLE da caixa
  status        entrega_status not null default 'criada',
  coletada_em   timestamptz,
  entregue_em   timestamptz,
  tentativas    int not null default 0,
  sla_cumprido  boolean,                     -- preenchido na conclusão
  distancia_km  numeric,                      -- usado para CO₂ evitado no dossiê
  criado_em     timestamptz not null default now()
);
create index on entregas (pedido_id);
create index on entregas (status);
create index on entregas (criado_em);

-- ---------------------------------------------------------------------
-- EVENTOS — cadeia de custódia (APPEND-ONLY / imutável)
-- É a espinha do "Rastro": cada mudança vira um evento auditável.
-- ---------------------------------------------------------------------
create table eventos (
  id            uuid primary key default gen_random_uuid(),
  entrega_id    uuid not null references entregas(id) on delete restrict,
  tipo          evento_tipo not null,
  ocorrido_em   timestamptz not null default now(),
  autor         text,                         -- motorista | sistema | agente_whatsapp
  lat           double precision,
  lng           double precision,
  detalhe       jsonb not null default '{}',  -- payload flexível por tipo
  criado_em     timestamptz not null default now()
);
create index on eventos (entrega_id, ocorrido_em);
create index on eventos using gin (detalhe);

-- Integridade da custódia: proibir UPDATE/DELETE em eventos (só INSERT).
create or replace function eventos_append_only()
returns trigger language plpgsql as $$
begin
  raise exception 'eventos é append-only: % não permitido', tg_op;
end; $$;
create trigger trg_eventos_imutavel
  before update or delete on eventos
  for each row execute function eventos_append_only();

-- ---------------------------------------------------------------------
-- LEITURAS DE TEMPERATURA — série temporal (Cold-Chain Guard)
-- Vanilla Postgres: tabela + índice composto. Em escala: hypertable.
-- ---------------------------------------------------------------------
create table leituras_temperatura (
  id          bigint generated always as identity,
  entrega_id  uuid not null references entregas(id) on delete restrict,
  lido_em     timestamptz not null,
  temp_c      numeric(4,1) not null,
  umidade     numeric(4,1),
  logger_id   text,
  primary key (entrega_id, lido_em)
);
create index on leituras_temperatura (lido_em);
-- Opcional (TimescaleDB): select create_hypertable('leituras_temperatura','lido_em');

-- ---------------------------------------------------------------------
-- POD — prova de entrega
-- ---------------------------------------------------------------------
create table pods (
  id              uuid primary key default gen_random_uuid(),
  entrega_id      uuid not null references entregas(id) on delete restrict,
  foto_url        text,                       -- object storage
  assinatura_url  text,
  recebedor_nome  text,
  recebedor_doc   text,
  lat             double precision,
  lng             double precision,
  registrado_em   timestamptz not null default now()
);
create index on pods (entrega_id);

-- ---------------------------------------------------------------------
-- ALERTAS — gerados por anomalia (excursão térmica, falha, avaria)
-- ---------------------------------------------------------------------
create table alertas (
  id           uuid primary key default gen_random_uuid(),
  entrega_id   uuid references entregas(id) on delete set null,
  tipo         text not null,               -- excursao_termica | falha_entrega | avaria
  severidade   text not null default 'media', -- baixa | media | alta
  mensagem     text,
  resolvido    boolean not null default false,
  criado_em    timestamptz not null default now()
);
create index on alertas (resolvido, criado_em);

-- ---------------------------------------------------------------------
-- VIEW — status atual + última temperatura (alimenta painel e dossiê)
-- ---------------------------------------------------------------------
create or replace view vw_entrega_resumo as
select
  e.id                as entrega_id,
  c.razao_social      as cliente,
  p.ref_externa,
  p.faixa,
  p.temp_min, p.temp_max,
  e.status,
  e.tentativas,
  e.coletada_em,
  e.entregue_em,
  e.sla_cumprido,
  (select max(lt.temp_c) from leituras_temperatura lt where lt.entrega_id = e.id) as temp_max_lida,
  (select bool_or(lt.temp_c < p.temp_min or lt.temp_c > p.temp_max)
     from leituras_temperatura lt where lt.entrega_id = e.id)                     as houve_excursao
from entregas e
join pedidos p   on p.id = e.pedido_id
join clientes c  on c.id = p.cliente_id;

-- ---------------------------------------------------------------------
-- RLS (Supabase) — isolamento por cliente. Exemplo (ative e adapte):
--   alter table pedidos enable row level security;
--   create policy cliente_isola on pedidos
--     using (cliente_id = (auth.jwt() ->> 'cliente_id')::uuid);
-- Repita o padrão para destinatarios/entregas/pods conforme o acesso.
-- ---------------------------------------------------------------------
