update public.treatment_template_steps
set step_order = step_order + 10
where template_key = 'arp_to_implant'
  and step_order >= 3
  and not exists (
    select 1
    from public.treatment_template_steps
    where template_key = 'arp_to_implant'
      and procedure_type = 'fgg_ctg'
  );

insert into public.treatment_template_steps (
  template_key,
  step_order,
  title,
  procedure_type,
  default_offset_days,
  default_note
)
select 'arp_to_implant', 3, 'FGG / CTG', 'fgg_ctg', 60, null
where not exists (
  select 1
  from public.treatment_template_steps
  where template_key = 'arp_to_implant'
    and procedure_type = 'fgg_ctg'
);

update public.treatment_template_steps
set
  step_order = case procedure_type
    when 'stage_2_healing_abutment' then 4
    when 'impression_scan' then 5
    when 'delivery' then 6
    else step_order
  end,
  default_offset_days = case procedure_type
    when 'stage_2_healing_abutment' then 30
    else default_offset_days
  end
where template_key = 'arp_to_implant'
  and procedure_type in ('stage_2_healing_abutment', 'impression_scan', 'delivery');

update public.treatment_template_steps
set step_order = step_order + 10
where template_key = 'gbr_to_implant'
  and step_order >= 3
  and not exists (
    select 1
    from public.treatment_template_steps
    where template_key = 'gbr_to_implant'
      and procedure_type = 'fgg_ctg'
  );

insert into public.treatment_template_steps (
  template_key,
  step_order,
  title,
  procedure_type,
  default_offset_days,
  default_note
)
select 'gbr_to_implant', 3, 'FGG / CTG', 'fgg_ctg', 90, null
where not exists (
  select 1
  from public.treatment_template_steps
  where template_key = 'gbr_to_implant'
    and procedure_type = 'fgg_ctg'
);

update public.treatment_template_steps
set
  step_order = case procedure_type
    when 'stage_2_healing_abutment' then 4
    when 'impression_scan' then 5
    when 'delivery' then 6
    else step_order
  end,
  default_offset_days = case procedure_type
    when 'stage_2_healing_abutment' then 30
    else default_offset_days
  end
where template_key = 'gbr_to_implant'
  and procedure_type in ('stage_2_healing_abutment', 'impression_scan', 'delivery');

update public.treatment_template_steps
set step_order = step_order + 10
where template_key = 'iip'
  and step_order >= 2
  and not exists (
    select 1
    from public.treatment_template_steps
    where template_key = 'iip'
      and procedure_type = 'fgg_ctg'
  );

insert into public.treatment_template_steps (
  template_key,
  step_order,
  title,
  procedure_type,
  default_offset_days,
  default_note
)
select 'iip', 2, 'FGG / CTG', 'fgg_ctg', 60, null
where not exists (
  select 1
  from public.treatment_template_steps
  where template_key = 'iip'
    and procedure_type = 'fgg_ctg'
);

update public.treatment_template_steps
set
  step_order = case procedure_type
    when 'stage_2_healing_abutment' then 3
    when 'impression_scan' then 4
    when 'delivery' then 5
    else step_order
  end,
  default_offset_days = case procedure_type
    when 'stage_2_healing_abutment' then 30
    else default_offset_days
  end
where template_key = 'iip'
  and procedure_type in ('stage_2_healing_abutment', 'impression_scan', 'delivery');

update public.treatment_template_steps
set step_order = step_order + 10
where template_key = 'healed_ridge'
  and step_order >= 2
  and not exists (
    select 1
    from public.treatment_template_steps
    where template_key = 'healed_ridge'
      and procedure_type = 'fgg_ctg'
  );

insert into public.treatment_template_steps (
  template_key,
  step_order,
  title,
  procedure_type,
  default_offset_days,
  default_note
)
select 'healed_ridge', 2, 'FGG / CTG', 'fgg_ctg', 60, null
where not exists (
  select 1
  from public.treatment_template_steps
  where template_key = 'healed_ridge'
    and procedure_type = 'fgg_ctg'
);

update public.treatment_template_steps
set
  step_order = case procedure_type
    when 'stage_2_healing_abutment' then 3
    when 'impression_scan' then 4
    when 'delivery' then 5
    else step_order
  end,
  default_offset_days = case procedure_type
    when 'stage_2_healing_abutment' then 30
    else default_offset_days
  end
where template_key = 'healed_ridge'
  and procedure_type in ('stage_2_healing_abutment', 'impression_scan', 'delivery');

update public.treatment_template_steps
set step_order = step_order + 10
where template_key = 'sinus_lift_to_implant'
  and step_order >= 3
  and not exists (
    select 1
    from public.treatment_template_steps
    where template_key = 'sinus_lift_to_implant'
      and procedure_type = 'fgg_ctg'
  );

insert into public.treatment_template_steps (
  template_key,
  step_order,
  title,
  procedure_type,
  default_offset_days,
  default_note
)
select 'sinus_lift_to_implant', 3, 'FGG / CTG', 'fgg_ctg', 90, null
where not exists (
  select 1
  from public.treatment_template_steps
  where template_key = 'sinus_lift_to_implant'
    and procedure_type = 'fgg_ctg'
);

update public.treatment_template_steps
set
  step_order = case procedure_type
    when 'stage_2_healing_abutment' then 4
    when 'impression_scan' then 5
    when 'delivery' then 6
    else step_order
  end,
  default_offset_days = case procedure_type
    when 'stage_2_healing_abutment' then 30
    else default_offset_days
  end
where template_key = 'sinus_lift_to_implant'
  and procedure_type in ('stage_2_healing_abutment', 'impression_scan', 'delivery');
