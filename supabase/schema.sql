-- ============================================================
-- Mini Gestoria Inteligena B2B - Migracion Supabase
-- Archivo: supabase/schema.sql
--
-- Como aplicarlo:
--   1. Supabase Dashboard -> SQL Editor: pegar este archivo y Run, o
--   2. supabase db push (si usas el CLI con este repo vinculado).
--
-- Tabla public.facturas: libro registro de facturas con emisor,
-- receptor, base imponible, IVA, IRPF, fecha, trimestre fiscal (T1..T4)
-- y estado de verificacion ('Verificada' si base+IVA-IRPF=total,
-- 'Revisar' si no cuadra).
--
-- La app sincroniza con upsert (onConflict: 'id') desde el navegador.
-- El script es idempotente: se puede ejecutar tantas veces como haga
-- falta y solo ASCII para que funcione con cualquier codificacion.
-- ============================================================

create table if not exists public.facturas (
  id                text primary key,
  tipo              text not null check (tipo in ('INGRESO', 'GASTO')),
  numero_factura    text default '',
  fecha             date not null,
  emisor_nombre     text default '',
  emisor_nif        text default '',
  receptor_nombre   text default '',
  receptor_nif      text default '',
  base_imponible    numeric(12, 2) not null default 0,
  porcentaje_iva    numeric(5, 2)  not null default 21,
  cuota_iva         numeric(12, 2) not null default 0,
  porcentaje_irpf   numeric(5, 2)  not null default 0,
  cuota_irpf        numeric(12, 2) not null default 0,
  total             numeric(12, 2) not null default 0,
  categoria         text default 'Otro',
  estado            text default 'Verificada',
  origen            text default 'manual',
  created_at        timestamptz default now()
);

-- Trimestre fiscal (T1..T4): columna GENERADA a partir de fecha.
-- PostgreSQL la calcula sola; el cliente nunca la envia, asi que el
-- upsert desde la app sigue funcionando sin incluirla en las filas.
-- add column if not exists: si la tabla ya existia sin la columna, se anade.
alter table public.facturas
  add column if not exists trimestre text
  generated always as ('T' || ceil(extract(quarter from fecha))::int::text) stored;

create index if not exists facturas_fecha_idx     on public.facturas (fecha desc);
create index if not exists facturas_tipo_idx      on public.facturas (tipo);
create index if not exists facturas_trimestre_idx on public.facturas (trimestre);

-- ============================================================
-- ROW LEVEL SECURITY (RLS) + PERMISOS
-- ============================================================
alter table public.facturas enable row level security;

-- Permisos explicitos para los roles del navegador. En Supabase vienen por
-- defecto (alter default privileges); aqui quedan hechos a mano para que el
-- script funcione igual en cualquier PostgreSQL que tenga esos roles.
grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on public.facturas to anon, authenticated;

-- Politica de demostracion / uso local: acceso completo a los roles del
-- navegador (anon + authenticated). Necesaria para que la app funcione con
-- la clave publica (sb_publishable_...) sin sistema de usuarios.
-- En produccion, sustituila por politicas ligadas a auth.uid():
--
--   alter table public.facturas add column user_id uuid references auth.users;
--   drop policy "facturas por usuario" on public.facturas;
--   create policy "facturas por usuario" on public.facturas
--     for all to authenticated
--     using (user_id = auth.uid())
--     with check (user_id = auth.uid());
--
-- (service_role bypasea RLS; la clave secreta no debe salir del servidor.)
-- ============================================================

drop policy if exists "demo anon full access" on public.facturas;

create policy "demo anon full access"
  on public.facturas
  for all
  to anon, authenticated
  using (true)
  with check (true);
