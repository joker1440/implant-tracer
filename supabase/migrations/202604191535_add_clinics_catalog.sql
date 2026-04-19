create table if not exists public.clinics (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  sort_order integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_user_id, name)
);

create index if not exists clinics_owner_sort_idx
on public.clinics (owner_user_id, sort_order, name);

drop trigger if exists clinics_set_updated_at on public.clinics;
create trigger clinics_set_updated_at
before update on public.clinics
for each row
execute function public.set_current_timestamp_updated_at();

alter table public.clinics enable row level security;

drop policy if exists "clinics owner access" on public.clinics;
create policy "clinics owner access"
on public.clinics
for all
using (owner_user_id = auth.uid())
with check (owner_user_id = auth.uid());

alter table public.patients
drop constraint if exists patients_clinic_name_check;

insert into public.clinics (owner_user_id, name, sort_order)
select
  users.id,
  defaults.name,
  defaults.sort_order
from auth.users as users
cross join (
  values
    ('擎天', 1),
    ('明曜', 2),
    ('精心', 3),
    ('大心', 4)
) as defaults(name, sort_order)
on conflict (owner_user_id, name) do nothing;

insert into public.clinics (owner_user_id, name, sort_order)
select
  patient_clinics.owner_user_id,
  patient_clinics.clinic_name,
  row_number() over (
    partition by patient_clinics.owner_user_id
    order by patient_clinics.clinic_name
  ) + 100
from (
  select distinct owner_user_id, clinic_name
  from public.patients
  where clinic_name is not null and btrim(clinic_name) <> ''
) as patient_clinics
on conflict (owner_user_id, name) do nothing;
