-- =====================================================================
-- CHAMACARGA — Sprint 5 pt.2
-- Metadado de certificação metrológica RBC/CGCRE (ISO/IEC 17025) por
-- entrega. Requisito ANVISA RDC 430/2020 e RDC 653/2022 pra
-- transportar termolábeis: o sensor de temperatura precisa ter
-- certificado de calibração rastreável ao SI via laboratório
-- acreditado RBC (não é aprovação de modelo — é calibração
-- individual, tipicamente anual).
--
-- Decisão de modelagem: colunas em `entregas`, não tabela `sensores`
-- separada. Motivo — 1 entrega usa 1 logger com seu certificado
-- vigente na hora; guardar o snapshot na entrega captura essa foto
-- no momento certo, imutável. Quando um mesmo sensor for reutilizado
-- em 50 entregas, o certificado será repetido 50x — trade-off aceito
-- pra evitar normalizar cedo demais. Migrar pra tabela `sensores`
-- quando a operação tiver >20 loggers ativos.
--
-- Backfill: colunas ficam NULL para entregas legadas. Dossiê exibe
-- "—" quando ausente. Cron futuro pode alertar quando validade se
-- aproximar (< 30 dias) — não incluído aqui.
-- =====================================================================

alter table entregas
  add column if not exists sensor_certificado_rbc  text,
  add column if not exists sensor_certificado_validade date;

comment on column entregas.sensor_certificado_rbc is
  'Nº do certificado de calibração RBC/CGCRE (ISO 17025) do logger '
  'usado nesta entrega. Requisito ANVISA RDC 430/653 para farma '
  'termolábil.';
comment on column entregas.sensor_certificado_validade is
  'Data de validade da calibração RBC vigente no momento da entrega.';
