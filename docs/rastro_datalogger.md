# RASTRO — Integração do Data Logger de Temperatura (Cold-Chain Guard)

Como a curva de temperatura sai do sensor BLE, entra em `leituras_temperatura`
e dispara o alerta de excursão térmica.

## 1. Modo de operação do logger — escolha do MVP

Loggers BLE comerciais operam em dois modos:

- **Store-and-forward (recomendado p/ MVP):** o sensor grava leituras na memória
  interna em intervalo fixo (ex.: a cada 2 min). No fim da rota, o app do motorista
  conecta via Bluetooth e descarrega a curva inteira. Não exige conectividade em
  trânsito — mais barato e simples.
- **Gateway em tempo real (Fase 2):** o logger transmite e um gateway (celular na
  van) lê continuamente e envia à nuvem. Mais caro e complexo. Só quando o cliente
  exigir alerta em tempo real durante o transporte.

## 2. ⚠️ Restrição de hardware que decide o app (resolver ANTES de codar)

O **Web Bluetooth** funciona no Chrome Android e Chrome Desktop, mas **NÃO funciona
em nenhum navegador no iOS** (Safari e Chrome do iPhone não suportam). Implicação:

- Motoristas com **Android** → PWA com Web Bluetooth resolve. ✅
- Motoristas com **iPhone** → precisa app nativo (React Native/Flutter) **ou** usar o
  app do fabricante do logger para exportar (CSV) e importar.

Decisão pragmática para o piloto: **padronize os motoristas em Android**, ou escolha
um logger cujo app do fabricante exporte CSV/PDF. Não descubra isso depois de construir.

## 3. Fluxo de dados

```
Logger BLE  →  App do motorista (sync no fim da rota)  →  POST /leituras
   →  upsert em leituras_temperatura  →  avaliar_excursao()
   →  se excursão: INSERT em eventos (imutável) + alertas + push p/ operação
```

Vincule o logger à entrega gravando `logger_id` em `entregas` na coleta.

## 4. App do motorista — sincronização (pseudocódigo)

```js
// Android PWA (Web Bluetooth) ou app nativo
const device = await navigator.bluetooth.requestDevice({ filters: [{ name: loggerId }] });
const server = await device.gatt.connect();
const leituras = await lerBufferDoLogger(server);   // SDK/GATT do fabricante
// leituras: [{ lido_em: ISO8601, temp_c: number, umidade?: number }]

await fetch(`/api/entregas/${entregaId}/leituras`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ logger_id: loggerId, leituras })
});
```

## 5. Endpoint de ingestão (idempotente)

Reenviar a mesma curva não pode duplicar dados — por isso o `on conflict do nothing`
(a PK de `leituras_temperatura` é `(entrega_id, lido_em)`).

```sql
-- chamado pelo endpoint, em transação, para cada lote:
insert into leituras_temperatura (entrega_id, lido_em, temp_c, umidade, logger_id)
values (:entrega_id, :lido_em, :temp_c, :umidade, :logger_id)
on conflict (entrega_id, lido_em) do nothing;

-- após inserir o lote:
select avaliar_excursao(:entrega_id);
```

## 6. Detecção de excursão (SQL — roda após o sync)

Gera UM alerta consolidado (não um por leitura) e registra o evento imutável na
cadeia de custódia. Tolerância em minutos fora da faixa evita alarme por blip único.

```sql
create or replace function avaliar_excursao(p_entrega uuid, p_tolerancia_min int default 10)
returns void language plpgsql as $$
declare v_min numeric; v_max numeric; v_seg int; v_pico numeric;
begin
  select p.temp_min, p.temp_max into v_min, v_max
  from pedidos p join entregas e on e.pedido_id = p.id
  where e.id = p_entrega;

  if v_min is null then return; end if;       -- carga não-termolábil: ignora

  -- tempo total (s) fora da faixa + maior desvio observado
  select coalesce(sum(extract(epoch from gap)),0)::int,
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
            jsonb_build_object('segundos_fora', v_seg, 'pico_desvio_c', round(v_pico,1)));

    insert into alertas (entrega_id, tipo, severidade, mensagem)
    select p_entrega, 'excursao_termica',
           case when v_pico > 3 then 'alta' else 'media' end,
           format('Excursão térmica: %s min fora da faixa, pico %.1f°C de desvio', v_seg/60, v_pico)
    where not exists (
      select 1 from alertas a
      where a.entrega_id = p_entrega and a.tipo = 'excursao_termica' and a.resolvido = false
    );
  end if;
end; $$;
```

Nota: o cálculo por `lag` é uma aproximação simples (boa para o MVP). Ajuste a
`p_tolerancia_min` por faixa de carga.

## 7. Fase 2 — MKT (Mean Kinetic Temperature)

Para farma de alto rigor, o padrão-ouro não é min/max simples e sim a **MKT**
(temperatura cinética média), que pondera o efeito do tempo em cada temperatura.
No MVP, duração-fora-da-faixa basta; migre para MKT quando um cliente exigir.

## 8. Checklist de escolha do logger

- [ ] Tem SDK documentado (Android) **ou** exporta CSV/PDF pelo app do fabricante?
- [ ] Faixa e precisão adequadas (ex.: ±0,5°C para 2–8°C)?
- [ ] Memória suficiente para uma rota inteira no intervalo escolhido?
- [ ] Bateria/recarga compatível com o uso diário?
- [ ] Custo por unidade dentro do CAPEX (~R$ 150–400)?
- [ ] Certificado/calibração rastreável (exigência de auditoria ANVISA)?
