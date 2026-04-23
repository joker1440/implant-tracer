alter table public.patients
add column if not exists gender text;

alter table public.patients
drop constraint if exists patients_gender_check;

alter table public.patients
add constraint patients_gender_check
check (
  gender is null
  or gender in ('male', 'female', 'other')
);
