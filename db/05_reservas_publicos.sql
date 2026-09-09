-- =====================================================================
-- CHAMACARGA — Sprint 3
-- Tabelas de suporte às rotas públicas /r/:token e /d/:token +
-- hash-chain de eventos (requisito RDC 430/653 pra log imutável e
-- verificável em auditoria farma).
-- =====================================================================

-- ---------------------------------------------------------------------
-- Hash-chain em eventos
-- ---------------------------------------------------------------------
alter table eventos
  add column if not exists hash_prev text,
  add column if not exists hash_atual text;

comment on column eventos.hash_prev is
  'Hash SHA-256 do evento anterior da mesma entrega (encadeamento imutável).';
comment on column eventos.hash_atual is
  'Hash SHA-256(hash_prev || payload deste evento). Verificável em /d/:token.';

create or replace function eventos_hash_chain() returns trigger language plpgsql as $$
declare
  v_prev text;
  v_payload text;
begin
  select hash_atual into v_prev
    from eventos
    where entrega_id = new.entrega_id
    order by ocorrido_em desc, id desc
    limit 1;

  new.hash_prev := coalesce(v_prev, '');
  v_payload :=
    coalesce(new.entrega_id::text,'')      || '|' ||
    coalesce(new.tipo::text,'')            || '|' ||
    coalesce(new.ocorrido_em::text,'')     || '|' ||
    coalesce(new.autor,'')                 || '|' ||
    coalesce(new.lat::text,'')             || '|' ||
    coalesce(new.lng::text,'')             || '|' ||
    coalesce(new.detalhe::text,'{}');
  new.hash_atual := encode(digest(new.hash_prev || v_payload, 'sha256'), 'hex');
  return new;
end $$;

drop trigger if exists trg_eventos_hash_chain on eventos;
create trigger trg_eventos_hash_chain
  before insert on eventos
  for each row execute function eventos_hash_chain();

-- Backfill: recalcula em cascata para eventos pré-existentes (ordem cronológica).
do $$
declare
  r record;
  v_prev text;
  v_payload text;
begin
  for r in
    select id, entrega_id, tipo, ocorrido_em, autor, lat, lng, detalhe
    from eventos
    where hash_atual is null
    order by entrega_id, ocorrido_em, id
  loop
    select hash_atual into v_prev
      from eventos
      where entrega_id = r.entrega_id
        and (ocorrido_em, id) < (r.ocorrido_em, r.id)
      order by ocorrido_em desc, id desc
      limit 1;
    v_payload :=
      coalesce(r.entrega_id::text,'')  || '|' ||
      coalesce(r.tipo::text,'')        || '|' ||
      coalesce(r.ocorrido_em::text,'') || '|' ||
      coalesce(r.autor,'')             || '|' ||
      coalesce(r.lat::text,'')         || '|' ||
      coalesce(r.lng::text,'')         || '|' ||
      coalesce(r.detalhe::text,'{}');
    update eventos set
      hash_prev = coalesce(v_prev,''),
      hash_atual = encode(digest(coalesce(v_prev,'') || v_payload, 'sha256'), 'hex')
      where id = r.id;
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- Janelas ofertadas — o 3PL cria as opções que o destinatário vê
-- ---------------------------------------------------------------------
create table if not exists janelas_ofertadas (
  id          uuid primary key default gen_random_uuid(),
  entrega_id  uuid not null references entregas(id) on delete cascade,
  inicio      timestamptz not null,
  fim         timestamptz not null,
  capacidade  int not null default 1,
  criado_em   timestamptz not null default now(),
  check (fim > inicio),
  check (capacidade > 0)
);
create index if not exists idx_janelas_entrega on janelas_ofertadas (entrega_id);
create index if not exists idx_janelas_inicio  on janelas_ofertadas (inicio);

-- ---------------------------------------------------------------------
-- Reservas — destinatário confirma uma janela; 1 reserva por (entrega,janela)
-- ---------------------------------------------------------------------
create table if not exists reservas (
  id           uuid primary key default gen_random_uuid(),
  entrega_id   uuid not null references entregas(id) on delete cascade,
  janela_id    uuid not null references janelas_ofertadas(id) on delete restrict,
  criado_em    timestamptz not null default now(),
  expira_em    timestamptz not null,
  ip_hash      text,
  unique (entrega_id, janela_id)
);
create index if not exists idx_reservas_janela on reservas (janela_id);

-- ---------------------------------------------------------------------
-- Tokens públicos — opacos e curtos ("8842-a7f3"), com TTL
-- Tipos: 'r' = /r/:token (destinatário reserva), 'd' = /d/:token (dossiê)
-- ---------------------------------------------------------------------
create table if not exists tokens_publicos (
  id          uuid primary key default gen_random_uuid(),
  token       text unique not null,
  entrega_id  uuid not null references entregas(id) on delete cascade,
  tipo        text not null check (tipo in ('r','d')),
  criado_em   timestamptz not null default now(),
  expira_em   timestamptz not null,
  usado_em    timestamptz
);
create index if not exists idx_tokens_lookup on tokens_publicos (token, tipo, expira_em);
create index if not exists idx_tokens_entrega on tokens_publicos (entrega_id, tipo);

-- ---------------------------------------------------------------------
-- RLS — mesmo padrão do 04, defesa em profundidade.
-- Backend usa service role (bypass); RLS pega qualquer outra conexão.
-- ---------------------------------------------------------------------
alter table janelas_ofertadas enable row level security;
alter table reservas          enable row level security;
alter table tokens_publicos   enable row level security;

drop policy if exists p_janelas_iso on janelas_ofertadas;
create policy p_janelas_iso on janelas_ofertadas
  using (exists (
    select 1 from entregas e join pedidos p on p.id = e.pedido_id
    where e.id = janelas_ofertadas.entrega_id and p.cliente_id = auth_cliente_id()))
  with check (exists (
    select 1 from entregas e join pedidos p on p.id = e.pedido_id
    where e.id = janelas_ofertadas.entrega_id and p.cliente_id = auth_cliente_id()));

drop policy if exists p_reservas_iso on reservas;
create policy p_reservas_iso on reservas
  using (exists (
    select 1 from entregas e join pedidos p on p.id = e.pedido_id
    where e.id = reservas.entrega_id and p.cliente_id = auth_cliente_id()))
  with check (exists (
    select 1 from entregas e join pedidos p on p.id = e.pedido_id
    where e.id = reservas.entrega_id and p.cliente_id = auth_cliente_id()));

drop policy if exists p_tokens_iso on tokens_publicos;
create policy p_tokens_iso on tokens_publicos
  using (exists (
    select 1 from entregas e join pedidos p on p.id = e.pedido_id
    where e.id = tokens_publicos.entrega_id and p.cliente_id = auth_cliente_id()))
  with check (exists (
    select 1 from entregas e join pedidos p on p.id = e.pedido_id
    where e.id = tokens_publicos.entrega_id and p.cliente_id = auth_cliente_id()));
