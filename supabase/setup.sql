-- VibeChat one-time Supabase setup.
-- Run this whole file once in Supabase SQL Editor.

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  display_name text not null default 'User',
  avatar_url text,
  about text,
  is_admin boolean not null default false,
  theme text not null default 'midnight',
  last_seen timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  title text,
  is_group boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.conversation_members (
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (conversation_id,user_id)
);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  sender_id uuid not null references public.profiles(id) on delete cascade,
  content text,
  attachments jsonb not null default '[]'::jsonb,
  reply_to_id uuid references public.messages(id) on delete set null,
  read_at timestamptz,
  edited_at timestamptz,
  created_at timestamptz not null default now(),
  constraint message_has_content check (content is not null or attachments <> '[]'::jsonb)
);

create index if not exists messages_conversation_created_idx on public.messages(conversation_id,created_at);
create index if not exists members_user_idx on public.conversation_members(user_id);

create or replace function public.is_member(p_conversation uuid, p_user uuid default auth.uid())
returns boolean language sql stable security definer set search_path=public as $$
  select exists(select 1 from public.conversation_members where conversation_id=p_conversation and user_id=p_user);
$$;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path=public as $$
  select coalesce((select is_admin from public.profiles where id=auth.uid()),false);
$$;

create or replace function public.touch_conversation()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  update public.conversations set updated_at=now() where id=new.conversation_id;
  return new;
end $$;

drop trigger if exists messages_touch_conversation on public.messages;
create trigger messages_touch_conversation after insert on public.messages
for each row execute function public.touch_conversation();

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  insert into public.profiles(id,email,display_name)
  values(new.id,new.email,coalesce(new.raw_user_meta_data->>'display_name',split_part(new.email,'@',1)))
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
for each row execute function public.handle_new_user();

alter table public.profiles enable row level security;
alter table public.conversations enable row level security;
alter table public.conversation_members enable row level security;
alter table public.messages enable row level security;

drop policy if exists "profiles readable by authenticated users" on public.profiles;
create policy "profiles readable by authenticated users" on public.profiles
for select to authenticated using (true);

drop policy if exists "users update own profile" on public.profiles;
create policy "users update own profile" on public.profiles
for update to authenticated using (id=auth.uid()) with check (id=auth.uid());

drop policy if exists "members read conversations" on public.conversations;
create policy "members read conversations" on public.conversations
for select to authenticated using (public.is_member(id));

drop policy if exists "members create conversations" on public.conversations;
create policy "members create conversations" on public.conversations
for insert to authenticated with check (true);

drop policy if exists "members read membership" on public.conversation_members;
create policy "members read membership" on public.conversation_members
for select to authenticated using (public.is_member(conversation_id));

drop policy if exists "users add themselves or other member to new conversation" on public.conversation_members;
create policy "users add themselves or other member to new conversation" on public.conversation_members
for insert to authenticated with check (
  user_id=auth.uid()
  or exists(select 1 from public.conversation_members cm where cm.conversation_id=conversation_id and cm.user_id=auth.uid())
);

drop policy if exists "members read messages" on public.messages;
create policy "members read messages" on public.messages
for select to authenticated using (public.is_member(conversation_id));

drop policy if exists "members send messages" on public.messages;
create policy "members send messages" on public.messages
for insert to authenticated with check (sender_id=auth.uid() and public.is_member(conversation_id));

drop policy if exists "users edit own messages" on public.messages;
create policy "users edit own messages" on public.messages
for update to authenticated using (sender_id=auth.uid()) with check (sender_id=auth.uid());

drop policy if exists "users delete own messages" on public.messages;
create policy "users delete own messages" on public.messages
for delete to authenticated using (sender_id=auth.uid());

-- Storage bucket for chat attachments.
insert into storage.buckets (id,name,public)
values ('chat-files','chat-files',true)
on conflict (id) do update set public=true;

drop policy if exists "authenticated upload chat files" on storage.objects;
create policy "authenticated upload chat files" on storage.objects
for insert to authenticated with check (bucket_id='chat-files' and (storage.foldername(name))[1]=auth.uid()::text);

drop policy if exists "authenticated read chat files" on storage.objects;
create policy "authenticated read chat files" on storage.objects
for select to authenticated using (bucket_id='chat-files');

-- Enable realtime for messages.
do $$
begin
  alter publication supabase_realtime add table public.messages;
exception when duplicate_object then null;
end $$;

-- IMPORTANT:
-- After creating your first admin account in Supabase Dashboard,
-- run:
--
-- update public.profiles
-- set is_admin=true
-- where email='YOUR_ADMIN_EMAIL_HERE';
--
-- Then use the Admin panel to create everyone else.
