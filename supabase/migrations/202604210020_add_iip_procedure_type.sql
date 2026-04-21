alter type public.procedure_type add value if not exists 'iip';

create or replace function public.sync_case_implant_snapshot()
returns trigger
language plpgsql
as $$
declare
  target_visit_id uuid;
  target_case_id uuid;
  target_owner_id uuid;
  target_visited_on date;
begin
  if tg_op = 'DELETE' then
    target_visit_id := old.visit_id;
  else
    target_visit_id := new.visit_id;
  end if;

  select v.case_id, v.owner_user_id, v.visited_on
    into target_case_id, target_owner_id, target_visited_on
  from public.visits v
  where v.id = target_visit_id;

  if target_case_id is null then
    return coalesce(new, old);
  end if;

  if tg_op = 'DELETE' and old.procedure_type in ('implant_placement', 'iip') then
    delete from public.case_implants
    where case_id = target_case_id
      and source_visit_procedure_id = old.id;

    insert into public.case_implants (
      owner_user_id,
      case_id,
      source_visit_procedure_id,
      brand,
      model,
      diameter_mm,
      length_mm,
      placed_on
    )
    select
      v.owner_user_id,
      v.case_id,
      vp.id,
      vp.implant_brand,
      vp.implant_model,
      vp.implant_diameter_mm,
      vp.implant_length_mm,
      v.visited_on
    from public.visit_procedures vp
    join public.visits v on v.id = vp.visit_id
    where v.case_id = target_case_id
      and vp.procedure_type in ('implant_placement', 'iip')
    order by v.visited_on desc, vp.created_at desc
    limit 1
    on conflict (case_id) do update set
      owner_user_id = excluded.owner_user_id,
      source_visit_procedure_id = excluded.source_visit_procedure_id,
      brand = excluded.brand,
      model = excluded.model,
      diameter_mm = excluded.diameter_mm,
      length_mm = excluded.length_mm,
      placed_on = excluded.placed_on,
      updated_at = now();

    return old;
  end if;

  if tg_op <> 'DELETE' and new.procedure_type in ('implant_placement', 'iip') then
    insert into public.case_implants (
      owner_user_id,
      case_id,
      source_visit_procedure_id,
      brand,
      model,
      diameter_mm,
      length_mm,
      placed_on
    )
    values (
      target_owner_id,
      target_case_id,
      new.id,
      new.implant_brand,
      new.implant_model,
      new.implant_diameter_mm,
      new.implant_length_mm,
      target_visited_on
    )
    on conflict (case_id) do update set
      owner_user_id = excluded.owner_user_id,
      source_visit_procedure_id = excluded.source_visit_procedure_id,
      brand = excluded.brand,
      model = excluded.model,
      diameter_mm = excluded.diameter_mm,
      length_mm = excluded.length_mm,
      placed_on = excluded.placed_on,
      updated_at = now();
  end if;

  return coalesce(new, old);
end;
$$;
