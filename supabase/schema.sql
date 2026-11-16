-- Ejecutar en el SQL Editor de Supabase cuando conectes el proyecto
create table if not exists public.scores (
  id          bigint generated always as identity primary key,
  user_id     uuid references auth.users (id) on delete set null,
  level       int  not null,
  strokes     int  not null check (strokes > 0),
  created_at  timestamptz not null default now()
);

alter table public.scores enable row level security;

-- Cualquiera puede leer el ranking
create policy "scores_select_all" on public.scores
  for select using (true);

-- Cualquiera puede insertar (cámbialo a: with check (auth.uid() = user_id) cuando añadas login)
create policy "scores_insert_all" on public.scores
  for insert with check (true);
