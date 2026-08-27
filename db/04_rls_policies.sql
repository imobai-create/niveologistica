-- =====================================================================
-- CHAMACARGA — Row Level Security por cliente_id
-- Sprint 1 (hardening). Defesa em profundidade: o backend já filtra por
-- cliente_id via JWT, mas RLS garante que qualquer outra conexão
-- (dashboard, PostgREST/Supabase Auth, futuro serviço) permaneça isolada.
--
-- Contrato do JWT (Supabase): claim `cliente_id` em top-level OU dentro
-- de `app_metadata`. Configure via Custom Access Token Hook:
--   auth.jwt() ->> 'cliente_id'    -- forma preferida
--
-- Papel `service_role` do Supabase bypassa RLS por padrão — mantém
-- backups, migrations e o backend interno funcionando.
-- =====================================================================

-- Helper: cliente_id do JWT como uuid, ou null se ausente.
create or replace function auth_cliente_id() returns uuid
language sql stable as $$
  select nullif(
    coalesce(
      current_setting('request.jwt.claims', true)::jsonb ->> 'cliente_id',
      (current_setting('request.jwt.claims', true)::jsonb -> 'app_metadata' ->> 'cliente_id')
    ),
    ''
  )::uuid;
$$;

-- ---------------------------------------------------------------------
-- Tabelas com cliente_id direto
-- ---------------------------------------------------------------------
alter table clientes       enable row level security;
alter table destinatarios  enable row level security;
alter table pedidos        enable row level security;

drop policy if exists p_clientes_iso on clientes;
create policy p_clientes_iso on clientes
  using (id = auth_cliente_id())
  with check (id = auth_cliente_id());

drop policy if exists p_destinatarios_iso on destinatarios;
create policy p_destinatarios_iso on destinatarios
  using (cliente_id = auth_cliente_id())
  with check (cliente_id = auth_cliente_id());

drop policy if exists p_pedidos_iso on pedidos;
create policy p_pedidos_iso on pedidos
  using (cliente_id = auth_cliente_id())
  with check (cliente_id = auth_cliente_id());

-- ---------------------------------------------------------------------
-- Tabelas ligadas via entrega → pedido → cliente_id
-- ---------------------------------------------------------------------
alter table entregas             enable row level security;
alter table eventos              enable row level security;
alter table leituras_temperatura enable row level security;
alter table pods                 enable row level security;
alter table alertas              enable row level security;

drop policy if exists p_entregas_iso on entregas;
create policy p_entregas_iso on entregas
  using (exists (
    select 1 from pedidos p
    where p.id = entregas.pedido_id and p.cliente_id = auth_cliente_id()))
  with check (exists (
    select 1 from pedidos p
    where p.id = entregas.pedido_id and p.cliente_id = auth_cliente_id()));

drop policy if exists p_eventos_iso on eventos;
create policy p_eventos_iso on eventos
  using (exists (
    select 1 from entregas e join pedidos p on p.id = e.pedido_id
    where e.id = eventos.entrega_id and p.cliente_id = auth_cliente_id()))
  with check (exists (
    select 1 from entregas e join pedidos p on p.id = e.pedido_id
    where e.id = eventos.entrega_id and p.cliente_id = auth_cliente_id()));

drop policy if exists p_leituras_iso on leituras_temperatura;
create policy p_leituras_iso on leituras_temperatura
  using (exists (
    select 1 from entregas e join pedidos p on p.id = e.pedido_id
    where e.id = leituras_temperatura.entrega_id and p.cliente_id = auth_cliente_id()))
  with check (exists (
    select 1 from entregas e join pedidos p on p.id = e.pedido_id
    where e.id = leituras_temperatura.entrega_id and p.cliente_id = auth_cliente_id()));

drop policy if exists p_pods_iso on pods;
create policy p_pods_iso on pods
  using (exists (
    select 1 from entregas e join pedidos p on p.id = e.pedido_id
    where e.id = pods.entrega_id and p.cliente_id = auth_cliente_id()))
  with check (exists (
    select 1 from entregas e join pedidos p on p.id = e.pedido_id
    where e.id = pods.entrega_id and p.cliente_id = auth_cliente_id()));

drop policy if exists p_alertas_iso on alertas;
create policy p_alertas_iso on alertas
  using (
    entrega_id is null            -- alertas globais (não vinculados) só p/ service_role
    or exists (
      select 1 from entregas e join pedidos p on p.id = e.pedido_id
      where e.id = alertas.entrega_id and p.cliente_id = auth_cliente_id()))
  with check (
    entrega_id is null
    or exists (
      select 1 from entregas e join pedidos p on p.id = e.pedido_id
      where e.id = alertas.entrega_id and p.cliente_id = auth_cliente_id()));

-- ---------------------------------------------------------------------
-- Motoristas / veículos — operacional interno.
-- Sem cliente_id no schema atual; policy default DENY protege até que
-- o modelo evolua (ex.: tabela pivot cliente_motorista, ou coluna).
-- ---------------------------------------------------------------------
alter table motoristas enable row level security;
alter table veiculos   enable row level security;
-- Nenhuma policy = tudo negado para roles não-privilegiadas. O backend
-- consulta essas tabelas com conexão service (postgres direto) e não
-- é afetado. Ajustar quando existir modelo multi-tenant explícito.

-- ---------------------------------------------------------------------
-- View vw_entrega_resumo — herda RLS das tabelas base em Postgres 15+
-- via security_invoker. Em versões anteriores, considere converter em
-- security barrier ou substituir por função SQL SECURITY DEFINER.
-- ---------------------------------------------------------------------
do $$
begin
  if current_setting('server_version_num')::int >= 150000 then
    execute 'alter view vw_entrega_resumo set (security_invoker = true)';
  end if;
end $$;
