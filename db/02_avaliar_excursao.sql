-- =====================================================================
-- RASTRO — Função avaliar_excursao(entrega, tolerancia_min)
-- Chamada após cada lote de leituras ingerido pelo backend.
-- Gera UM alerta consolidado + evento imutável quando o tempo fora da
-- faixa excede a tolerância (default 10 min). Lógica do MVP: somatório
-- por gap entre leituras consecutivas fora da faixa + pico de desvio.
-- =====================================================================

create or replace function avaliar_excursao(p_entrega uuid, p_tolerancia_min int default 10)
returns void language plpgsql as $$
declare
  v_min numeric;
  v_max numeric;
  v_seg int;
  v_pico numeric;
begin
  select p.temp_min, p.temp_max into v_min, v_max
  from pedidos p join entregas e on e.pedido_id = p.id
  where e.id = p_entrega;

  if v_min is null then return; end if;

  select coalesce(sum(extract(epoch from gap)), 0)::int,
         max(greatest(v_min - temp_c, temp_c - v_max))
  into v_seg, v_pico
  from (
    select temp_c,
           lido_em - lag(lido_em) over (order by lido_em) as gap
    from leituras_temperatura
    where entrega_id = p_entrega and (temp_c < v_min or temp_c > v_max)
  ) t;

  if v_seg >= p_tolerancia_min * 60 then
    insert into eventos (entrega_id, tipo, autor, detalhe)
    values (p_entrega, 'excursao_termica', 'sistema',
            jsonb_build_object('segundos_fora', v_seg, 'pico_desvio_c', round(v_pico, 1)));

    insert into alertas (entrega_id, tipo, severidade, mensagem)
    select p_entrega, 'excursao_termica',
           case when v_pico > 3 then 'alta' else 'media' end,
           format('Excursão térmica: %s min fora da faixa, pico %.1f°C de desvio', v_seg / 60, v_pico)
    where not exists (
      select 1 from alertas a
      where a.entrega_id = p_entrega
        and a.tipo = 'excursao_termica'
        and a.resolvido = false
    );
  end if;
end; $$;
