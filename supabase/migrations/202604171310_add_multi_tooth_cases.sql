alter table public.cases
add column if not exists tooth_codes text[];

update public.cases
set tooth_codes = array[tooth_code]
where tooth_codes is null
   or cardinality(tooth_codes) = 0;

alter table public.cases
alter column tooth_codes set default '{}'::text[];

alter table public.cases
alter column tooth_codes set not null;

alter table public.cases
drop constraint if exists cases_tooth_codes_not_empty;

alter table public.cases
add constraint cases_tooth_codes_not_empty
check (cardinality(tooth_codes) > 0);

create index if not exists cases_tooth_codes_gin_idx
on public.cases using gin (tooth_codes);
