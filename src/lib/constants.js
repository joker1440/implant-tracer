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

export const IMPLANT_BRAND_OPTIONS = [
  { value: "osstem", label: "Osstem" },
  { value: "astra", label: "Astra" },
  { value: "iti", label: "ITI" }
];

export const IMPLANT_MODEL_OPTIONS_BY_BRAND = {
  osstem: [{ value: "TSIII", label: "TSIII" }],
  astra: [{ value: "TX", label: "TX" }],
  iti: [
    { value: "BLT", label: "BLT" },
    { value: "BLX", label: "BLX" }
  ]
};

export const IMPLANT_DIAMETER_OPTIONS = [
  { value: "3.0", label: "3.0" },
  { value: "3.3", label: "3.3" },
  { value: "3.5", label: "3.5" },
  { value: "4.0", label: "4.0" },
  { value: "4.1", label: "4.1" },
  { value: "4.5", label: "4.5" },
  { value: "4.8", label: "4.8" },
  { value: "5.0", label: "5.0" }
];

export const IMPLANT_LENGTH_OPTIONS = [
  { value: "8.5", label: "8.5" },
  { value: "9", label: "9" },
  { value: "10", label: "10" },
  { value: "11", label: "11" },
  { value: "11.5", label: "11.5" },
  { value: "12", label: "12" },
  { value: "13", label: "13" }
];

export const HEALING_TOGGLE_OPTIONS = [
  { value: "no", label: "否" },
  { value: "yes", label: "是" }
];

export const HEALING_SIZE_OPTIONS = [
  { value: "3.6x2", label: "3.6x2" },
  { value: "3.6x3.5", label: "3.6x3.5" },
  { value: "3.6x5", label: "3.6x5" },
  { value: "4.0x2", label: "4.0x2" },
  { value: "4.0x4", label: "4.0x4" },
  { value: "4.0x5", label: "4.0x5" },
  { value: "4.0x6", label: "4.0x6" },
  { value: "4.5x2", label: "4.5x2" },
  { value: "4.5x4", label: "4.5x4" },
  { value: "4.5x5", label: "4.5x5" },
  { value: "4.5x6", label: "4.5x6" },
  { value: "4.8x2", label: "4.8x2" },
  { value: "4.8x3.5", label: "4.8x3.5" },
  { value: "4.8x5", label: "4.8x5" },
  { value: "5.5x2", label: "5.5x2" },
  { value: "5.5x4", label: "5.5x4" },
  { value: "5.5x5", label: "5.5x5" },
  { value: "5.5x6", label: "5.5x6" },
  { value: "6x2", label: "6x2" },
  { value: "6x4", label: "6x4" },
  { value: "6x6", label: "6x6" },
  { value: "7x7", label: "7x7" }
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
