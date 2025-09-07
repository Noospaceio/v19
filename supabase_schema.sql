-- Suggested Supabase schema (run in SQL editor)
create table if not exists posts (
  id bigint generated always as identity primary key,
  owner text,
  text text,
  reward int,
  resonates int default 0,
  highlighted boolean default false,
  created_at timestamptz default now()
);
create table if not exists balances (
  wallet text primary key,
  balance int default 0
);
create table if not exists unclaimed (
  wallet text primary key,
  amount int default 0
);