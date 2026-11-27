-- The team day plan, shared by everyone who opens the app: one row per plan, the whole
-- plan as JSON. Run this once in the Supabase SQL editor (or with `supabase db push`).
--
-- There is no sign-in: the publishable (anon) key in the page may read, add and change
-- plans, but never delete them. Anyone who has the app can change the plan.

create table if not exists public.plans (
  id         text primary key,
  data       jsonb not null,
  -- Goes up by one on every save. A save names the version it builds on and is refused
  -- when the row has moved on, so two planners never overwrite each other unnoticed.
  version    integer not null default 1 check (version > 0),
  updated_at timestamptz not null default now()
);

create or replace function public.plans_touch() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists plans_touch on public.plans;
create trigger plans_touch before update on public.plans
  for each row execute function public.plans_touch();

alter table public.plans enable row level security;

drop policy if exists "Anyone can read plans" on public.plans;
create policy "Anyone can read plans" on public.plans
  for select to anon, authenticated using (true);

drop policy if exists "Anyone can add plans" on public.plans;
create policy "Anyone can add plans" on public.plans
  for insert to anon, authenticated with check (true);

drop policy if exists "Anyone can change plans" on public.plans;
create policy "Anyone can change plans" on public.plans
  for update to anon, authenticated using (true) with check (true);

grant select, insert, update on public.plans to anon, authenticated;
revoke delete on public.plans from anon, authenticated;
