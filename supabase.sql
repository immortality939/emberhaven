create table if not exists eh_accounts(
  email text primary key,
  salt text not null,
  pass text not null,
  rec text not null,
  save jsonb,
  created timestamptz default now()
);
alter table eh_accounts enable row level security;
