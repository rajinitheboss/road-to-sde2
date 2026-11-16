-- Road to SDE-2: one row of study progress per signed-in user.
-- Run once in Supabase → SQL Editor (or `supabase db push` if you use the CLI).

create table if not exists public.progress (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  start      date,                                -- plan start date
  done       jsonb not null default '{}'::jsonb,  -- { "p:two-sum": "2026-11-18", "d3:design": "..." }
  star       jsonb not null default '{}'::jsonb,  -- { "two-sum": true } problems to re-solve
  updated_at timestamptz not null default now()
);

-- Row-level security: each user can only see and change their own row.
alter table public.progress enable row level security;

drop policy if exists "read own progress"   on public.progress;
drop policy if exists "insert own progress" on public.progress;
drop policy if exists "update own progress" on public.progress;
drop policy if exists "delete own progress" on public.progress;

create policy "read own progress"   on public.progress for select to authenticated using (auth.uid() = user_id);
create policy "insert own progress" on public.progress for insert to authenticated with check (auth.uid() = user_id);
create policy "update own progress" on public.progress for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "delete own progress" on public.progress for delete to authenticated using (auth.uid() = user_id);
