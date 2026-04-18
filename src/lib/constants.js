export const NAV_ITEMS = [
  { key: "dashboard", label: "Dashboard" },
  { key: "patients", label: "病患" },
  { key: "search", label: "搜尋" }
];

export const CASE_STATUS_OPTIONS = [
  { value: "planned", label: "Planned" },
  { value: "active", label: "進行中" },
  { value: "completed", label: "完成" },
  { value: "on_hold", label: "暫停" },
  { value: "cancelled", label: "取消" }
];

export const PLAN_STATUS_OPTIONS = [
  { value: "pending", label: "待執行" },
  { value: "completed", label: "已完成" },
  { value: "skipped", label: "略過" },
  { value: "cancelled", label: "取消" }
];

export const CLINIC_OPTIONS = [
  { value: "擎天", label: "擎天" },
  { value: "明曜", label: "明曜" },
  { value: "精心", label: "精心" },
  { value: "大心", label: "大心" }
];

export const PROCEDURE_OPTIONS = [
  { value: "consultation", label: "Consultation" },
  { value: "extraction", label: "Extraction" },
  { value: "arp", label: "ARP" },
  { value: "gbr", label: "GBR" },
  { value: "sinus_lift", label: "Sinus Lift" },
  { value: "implant_placement", label: "Implant Placement" },
  { value: "fgg_ctg", label: "FGG / CTG" },
  { value: "stage_2_healing_abutment", label: "Stage 2 / Healing Abutment" },
  { value: "impression_scan", label: "Impression / Scan" },
  { value: "provisional", label: "Provisional" },
  { value: "delivery", label: "Delivery" },
  { value: "follow_up", label: "Follow-up" },
  { value: "other", label: "Other" }
];

export const MEMBRANE_OPTIONS = [
  { value: "resorbable", label: "可吸收" },
  { value: "non_resorbable", label: "不可吸收" }
];

export const SINUS_LIFT_APPROACH_OPTIONS = [
  { value: "lateral_window", label: "Lateral Window" },
  { value: "crestal_approach", label: "Crestal Approach" }
];

export const BONE_GRAFT_OPTIONS = [
  "Xenograft",
  "FDBA",
  "DFDBA",
  "Allograft",
  "Alloplast",
  "Autograft"
];

export const PHOTO_LABEL_OPTIONS = [
  "pre-op",
  "post-op",
  "panorama",
  "cbct",
  "healing",
  "delivery"
];

export const TEMPLATE_LABELS = {
  arp_to_implant: "ARP -> Implant",
  gbr_to_implant: "GBR -> Implant",
  iip: "IIP",
  healed_ridge: "Healed Ridge",
  sinus_lift_to_implant: "Sinus Lift -> Implant"
};

export const TEMPLATE_FLOW_PREVIEWS = {
  arp_to_implant: "Extraction -> ARP -> Implant -> FGG/CTG -> Stage -> Impression -> Final",
  gbr_to_implant: "Extraction -> GBR -> Implant -> FGG/CTG -> Stage -> Impression -> Final",
  iip: "Extraction -> Implant -> FGG/CTG -> Stage -> Impression -> Final",
  healed_ridge: "Implant -> FGG/CTG -> Stage -> Impression -> Final",
  sinus_lift_to_implant: "Sinus -> Implant -> FGG/CTG -> Stage -> Impression -> Final"
};

export const PROCEDURE_LABELS = Object.fromEntries(
  PROCEDURE_OPTIONS.map((option) => [option.value, option.label])
);

export const CASE_STATUS_LABELS = Object.fromEntries(
  CASE_STATUS_OPTIONS.map((option) => [option.value, option.label])
);

export const PLAN_STATUS_LABELS = Object.fromEntries(
  PLAN_STATUS_OPTIONS.map((option) => [option.value, option.label])
);

export const TOOTH_ROWS = [
  ["18", "17", "16", "15", "14", "13", "12", "11"],
  ["21", "22", "23", "24", "25", "26", "27", "28"],
  ["38", "37", "36", "35", "34", "33", "32", "31"],
  ["41", "42", "43", "44", "45", "46", "47", "48"]
];
