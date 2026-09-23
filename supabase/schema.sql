-- ============================================================
-- Mini Gestoría Inteligente B2B — Migración Supabase
-- Archivo: supabase/schema.sql
--
-- Cómo aplicarlo:
--   1. Supabase Dashboard → SQL Editor → pegar y ejecutar, o
--   2. `supabase db push` si usas el CLI con este repo como proyecto.
--
-- Tabla: public.facturas — libro registro de facturas (emisor, receptor,
-- base imponible, IVA, IRPF, fecha, trimestre fiscal y estado de verificación).
-- La app hace upsert con `onConflict: 'id'` desde el navegador (modo demo/nube).
-- ============================================================

create table if not exists public.facturas (
  id                text primary key,
  tipo              text not null check (tipo in ('INGRESO', 'GASTO')),
  numero_factura    text default '',
  fecha             date not null,

  -- Receptor y emisor (datos fiscales de ambas partes)
  emisor_nombre     text default '',
  emisor_nif        text default '',
  receptor_nombre   text default '',
  receptor_nif      text default '',

  -- Base imponible, IVA e IRPF
  base_imponible    numeric(12, 2) not null default 0,
  porcentaje_iva    numeric(5, 2)  not null default 21,
  cuota_iva         numeric(12, 2) not null default 0,
  porcentaje_irpf   numeric(5, 2)  not null default 0,
  cuota_irpf        numeric(12, 2) not null default 0,
  total             numeric(12, 2) not null default 0,

  -- Metadatos de negocio
  categoria         text default 'Otro',
  -- Estado de verificación: 'Verificada' (cuadra base+IVA−IRPF=total) o 'Revisar'
  estado            text default 'Verificada',
  origen            text default 'manual',
  created_at        timestamptz default now()
);

-- ------------------------------------------------------------
-- Trimestre fiscal (T1..T4): columna GENERADA a partir de `fecha`.
-- PostgreSQL la calcula solo; el cliente nunca la envía, así que el
-- upsert desde la app sigue funcionando sin incluirla en las filas.
-- Idempotente: si la tabla ya existía sin esta columna, se añade aquí.
-- ------------------------------------------------------------
alter table public.facturas
  add column if not exists trimestre text
  generated always as ('T' || ceil(extract(quarter from fecha))::int::text) stored;

create index if not exists facturas_fecha_idx     on public.facturas (fecha desc);
create index if not exists facturas_tipo_idx      on public.facturas (tipo);
create index if not exists facturas_trimestre_idx on public.facturas (trimestre);

-- ============================================================
-- ROW LEVEL SECURITY (RLS)
-- ============================================================
alter table public.facturas enable row level security;

-- POLÍTICA DE DEMOSTRACIÓN / USO LOCAL: acceso completo a los roles del
-- navegador (anon + authenticated). Necesaria para que la app funcione con
-- la clave pública (sb_publishable_...) sin sistema de usuarios.
-- ATENCIÓN: solo válida para uso propio/local. En producción, sustitúyela
-- por políticas ligadas a auth.uid() y añade una columna user_id:
--
--   alter table public.facturas add column user_id uuid references auth.users;
--   drop policy "facturas por usuario" on public.facturas;
--   create policy "facturas por usuario" on public.facturas
--     for all to authenticated
--     using (user_id = auth.uid())
--     with check (user_id = auth.uid());
--
-- (service_role siempre bypasea RLS; la clave secreta no debe salir del servidor.)
-- ============================================================
drop policy if exists "demo anon full access" on public.facturas;
create policy "demo anon full access"
  on public.facturas
  to anon, authenticated
  for all
  using (true)
  with check (true);
