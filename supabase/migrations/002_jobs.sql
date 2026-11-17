-- Road to SDE-2: private job leads and tailored resumes (the /jobs page).
-- Run once in Supabase → SQL Editor, after 001_progress.sql.

-- One row per job posting per user. `data` holds the posting details from the job search;
-- `status` and `notes` are yours and are kept when you re-import.
create table if not exists public.jobs (
  user_id     uuid not null references auth.users (id) on delete cascade,
  key         text not null,                         -- stable id for the posting (its URL)
  data        jsonb not null,                        -- company, title, location, pay, skills match, links…
  status      text not null default 'new' check (status in ('new','applied','interviewing','offer','rejected','skipped')),
  notes       text not null default '',
  imported_at timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  primary key (user_id, key)
);

alter table public.jobs enable row level security;

drop policy if exists "read own jobs"   on public.jobs;
drop policy if exists "insert own jobs" on public.jobs;
drop policy if exists "update own jobs" on public.jobs;
drop policy if exists "delete own jobs" on public.jobs;
create policy "read own jobs"   on public.jobs for select to authenticated using (auth.uid() = user_id);
create policy "insert own jobs" on public.jobs for insert to authenticated with check (auth.uid() = user_id);
create policy "update own jobs" on public.jobs for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "delete own jobs" on public.jobs for delete to authenticated using (auth.uid() = user_id);

-- Private storage bucket for the tailored resume PDFs. Files live under "<your user id>/…",
-- and each user can only read or write their own folder. Links to a file expire after 10 minutes.
insert into storage.buckets (id, name, public)
values ('resumes', 'resumes', false)
on conflict (id) do update set public = false;

drop policy if exists "read own resumes"   on storage.objects;
drop policy if exists "upload own resumes" on storage.objects;
drop policy if exists "update own resumes" on storage.objects;
drop policy if exists "delete own resumes" on storage.objects;
create policy "read own resumes"   on storage.objects for select to authenticated
  using (bucket_id = 'resumes' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "upload own resumes" on storage.objects for insert to authenticated
  with check (bucket_id = 'resumes' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "update own resumes" on storage.objects for update to authenticated
  using (bucket_id = 'resumes' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'resumes' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "delete own resumes" on storage.objects for delete to authenticated
  using (bucket_id = 'resumes' and (storage.foldername(name))[1] = auth.uid()::text);
