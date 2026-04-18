alter table public.patients
add column if not exists clinic_name text;

alter table public.patients
drop constraint if exists patients_clinic_name_check;

alter table public.patients
add constraint patients_clinic_name_check
check (
  clinic_name is null
  or clinic_name in ('擎天', '明曜', '精心', '大心')
);
