create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  created_at timestamptz not null default now()
);

create table if not exists public.folders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  color text not null default '#7dd3fc',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  folder_id uuid references public.folders(id) on delete set null,
  title text not null default 'Новая заметка',
  tags text[] not null default '{}',
  content_json jsonb not null default '{"type":"doc","content":[{"type":"paragraph"}]}'::jsonb,
  plain_text text not null default '',
  is_pinned boolean not null default false,
  is_archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  version integer not null default 1,
  last_synced_version integer not null default 1
);

create table if not exists public.note_attachments (
  id uuid primary key default gen_random_uuid(),
  note_id uuid not null references public.notes(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('image')),
  name text not null,
  source_url text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.reminders (
  id uuid primary key default gen_random_uuid(),
  note_id uuid not null references public.notes(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  fire_at_utc timestamptz not null,
  timezone text not null,
  repeat_rule text not null default 'none' check (repeat_rule in ('none', 'daily', 'weekly')),
  is_enabled boolean not null default true,
  last_sent_at timestamptz
);

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  device_name text not null,
  user_agent text,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email)
  on conflict (id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute procedure public.handle_new_user();

alter table public.profiles enable row level security;
alter table public.folders enable row level security;
alter table public.notes enable row level security;
alter table public.note_attachments enable row level security;
alter table public.reminders enable row level security;
alter table public.push_subscriptions enable row level security;

create policy "Profiles are private"
on public.profiles
for all
using (auth.uid() = id)
with check (auth.uid() = id);

create policy "Folders are private"
on public.folders
for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "Notes are private"
on public.notes
for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "Attachments are private"
on public.note_attachments
for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "Reminders are private"
on public.reminders
for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "Push subscriptions are private"
on public.push_subscriptions
for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);
