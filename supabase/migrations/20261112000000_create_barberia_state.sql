create table if not exists public.barberia_state (
  key text primary key check (key = 'shared-state'),
  state jsonb not null
);

alter table public.barberia_state enable row level security;
revoke all on public.barberia_state from anon, authenticated;
grant all on public.barberia_state to service_role;

insert into public.barberia_state (key, state)
values (
  'shared-state',
  '{
    "appointments": [],
    "barbers": [],
    "services": [
      {"name":"Corte","price":20000,"minutes":30},
      {"name":"Corte con Barba","price":25000,"minutes":30},
      {"name":"Cerquicovi","price":12000,"minutes":15},
      {"name":"Barba","price":5000,"minutes":5},
      {"name":"Cejas","price":5000,"minutes":5},
      {"name":"Figuras","price":3000,"minutes":5},
      {"name":"Cerquillo","price":5000,"minutes":5}
    ],
    "blockedSlots": [],
    "schedule": [
      {"day":1,"enabled":true,"open":"08:00","close":"19:00"},
      {"day":2,"enabled":true,"open":"08:00","close":"19:00"},
      {"day":3,"enabled":true,"open":"08:00","close":"19:00"},
      {"day":4,"enabled":true,"open":"08:00","close":"19:00"},
      {"day":5,"enabled":true,"open":"08:00","close":"19:00"},
      {"day":6,"enabled":true,"open":"08:00","close":"19:00"},
      {"day":0,"enabled":false,"open":"08:00","close":"19:00"}
    ]
  }'::jsonb
)
on conflict (key) do nothing;

create table if not exists public.barberia_settings (
  key text primary key check (key = 'admin-password'),
  value text not null
);

alter table public.barberia_settings enable row level security;
revoke all on public.barberia_settings from anon, authenticated;
grant all on public.barberia_settings to service_role;
