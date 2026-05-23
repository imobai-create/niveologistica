-- =====================================================================
-- RASTRO — Seed mínimo para validar o ciclo da Semana 1.
-- 1 cliente (3PH), 1 destinatário, 1 motorista, 1 veículo, 1 pedido
-- termolábil 2–8°C, 1 entrega. Os IDs ficam disponíveis para chamadas
-- de teste no /docs do backend.
-- =====================================================================

insert into clientes (id, razao_social, cnpj, segmento)
values ('11111111-1111-1111-1111-111111111111', '3PH Medicamentos', '00.000.000/0001-00', 'farma')
on conflict (id) do nothing;

insert into destinatarios (id, cliente_id, nome, telefone, endereco_raw, cep)
values ('22222222-2222-2222-2222-222222222222',
        '11111111-1111-1111-1111-111111111111',
        'Farmácia São Lucas', '+5531999999999',
        'R. dos Inconfidentes, 1200 — Funcionários, BH', '30140-120')
on conflict (id) do nothing;

insert into motoristas (id, nome, telefone)
values ('33333333-3333-3333-3333-333333333333', 'Carla M.', '+5531988887777')
on conflict (id) do nothing;

insert into veiculos (id, placa, modelo, eletrico)
values ('44444444-4444-4444-4444-444444444444', 'PYZ-2E04', 'BYD eT3', true)
on conflict (id) do nothing;

insert into pedidos (id, cliente_id, destinatario_id, ref_externa, valor_declarado,
                     termolabil, faixa, temp_min, temp_max, janela_inicio, janela_fim)
values ('55555555-5555-5555-5555-555555555555',
        '11111111-1111-1111-1111-111111111111',
        '22222222-2222-2222-2222-222222222222',
        '3PH-48217', 4200.00, true, 'refrigerado_2_8', 2.0, 8.0,
        now() + interval '1 day', now() + interval '1 day 4 hours')
on conflict (id) do nothing;

insert into entregas (id, pedido_id, motorista_id, veiculo_id, logger_id, distancia_km)
values ('66666666-6666-6666-6666-666666666666',
        '55555555-5555-5555-5555-555555555555',
        '33333333-3333-3333-3333-333333333333',
        '44444444-4444-4444-4444-444444444444',
        'LG-0098', 13)
on conflict (id) do nothing;

insert into eventos (entrega_id, tipo, autor)
values ('66666666-6666-6666-6666-666666666666', 'criada', 'sistema');
