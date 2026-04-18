import { PROCEDURE_LABELS, TEMPLATE_LABELS, TOOTH_ROWS } from "./constants";
import { addDays, daysFromToday, formatDate } from "./format";

const TOOTH_ORDER = TOOTH_ROWS.flat();
const TOOTH_ORDER_MAP = new Map(TOOTH_ORDER.map((code, index) => [code, index]));

export function normalizeToothCodes(codes) {
  const list = (Array.isArray(codes) ? codes : [codes])
    .map((code) => String(code || "").trim())
    .filter(Boolean);

  return Array.from(new Set(list)).sort((left, right) => {
    const leftOrder = TOOTH_ORDER_MAP.get(left);
    const rightOrder = TOOTH_ORDER_MAP.get(right);

    if (leftOrder === undefined && rightOrder === undefined) {
      return left.localeCompare(right);
    }

    if (leftOrder === undefined) return 1;
    if (rightOrder === undefined) return -1;
    return leftOrder - rightOrder;
  });
}

export function getCaseToothCodes(caseEntry) {
  if (!caseEntry) {
    return [];
  }

  return normalizeToothCodes(
    caseEntry.tooth_codes?.length ? caseEntry.tooth_codes : caseEntry.tooth_code
  );
}

export function formatCaseToothLabel(caseEntryOrCodes, { withPrefix = false } = {}) {
  const codes = Array.isArray(caseEntryOrCodes)
    ? normalizeToothCodes(caseEntryOrCodes)
    : getCaseToothCodes(caseEntryOrCodes);

  if (!codes.length) {
    return withPrefix ? "Tooth 未設定" : "未設定";
  }

  const label = codes.join(" / ");
  if (!withPrefix) {
    return label;
  }

  return `${codes.length > 1 ? "Teeth" : "Tooth"} ${label}`;
}

export function getOccupiedToothCodes(caseEntries, excludeCaseId = "") {
  return normalizeToothCodes(
    (caseEntries || [])
      .filter((entry) => entry.id !== excludeCaseId)
      .flatMap((entry) => getCaseToothCodes(entry))
  );
}

export function createEmptyPatient() {
  return {
    full_name: "",
    clinic_name: "",
    birth_date: "",
    attention_alert: "",
    general_notes: ""
  };
}

export function createEmptyCase(patientId = "") {
  return {
    patient_id: patientId,
    tooth_codes: [],
    status: "active",
    template_key: "arp_to_implant",
    title: "",
    started_on: "",
    target_restoration_on: "",
    diagnosis_notes: "",
    internal_notes: ""
  };
}

export function createEmptyPlanStep(caseId = "") {
  return {
    case_id: caseId,
    step_order: 1,
    title: PROCEDURE_LABELS.follow_up,
    procedure_type: "follow_up",
    planned_date: "",
    status: "pending",
    note: ""
  };
}

export function createEmptyProcedure(type = "consultation") {
  return {
    procedure_type: type,
    procedure_note: "",
    implant_brand: "",
    implant_model: "",
    implant_diameter_mm: "",
    implant_length_mm: "",
    bone_graft_materials: [],
    membrane_type: "",
    membrane_note: "",
    sinus_lift_approach: "",
    extra_data: {
      healing_used: false,
      healing_size: ""
    }
  };
}

export function createEmptyVisit(caseId = "", planStep = null) {
  return {
    case_id: caseId,
    plan_step_id: planStep?.id || "",
    visited_on: planStep?.planned_date || "",
    summary: "",
    next_note: "",
    next_plan_enabled: false,
    next_plan_step_id: "",
    next_plan_procedure_type: "",
    next_plan_planned_date: "",
    next_plan_note: "",
    procedures: [createEmptyProcedure(planStep?.procedure_type || "consultation")],
    existing_photos: [],
    new_photos: []
  };
}

export function buildPlanStepsFromTemplate(templateKey, templateSteps, startedOn) {
  const steps = templateSteps
    .filter((step) => step.template_key === templateKey)
    .sort((left, right) => left.step_order - right.step_order);

  let accumulatedDays = 0;

  return steps.map((step) => {
    accumulatedDays += Number(step.default_offset_days || 0);
    return {
      template_step_id: step.id,
      step_order: step.step_order,
      title: PROCEDURE_LABELS[step.procedure_type] || step.title || step.procedure_type,
      procedure_type: step.procedure_type,
      planned_date: startedOn ? addDays(startedOn, accumulatedDays) : null,
      status: "pending",
      note: step.default_note || ""
    };
  });
}

export function buildCsvFromCases({
  cases,
  patientsById,
  planStepsByCaseId,
  visitsByCaseId,
  caseImplantsByCaseId,
  caseDisplayNoById
}) {
  const rows = cases.map((entry) => {
    const patient = patientsById[entry.patient_id];
    const nextStep = (planStepsByCaseId[entry.id] || [])
      .filter((step) => step.status === "pending")
      .sort((left, right) => {
        if (!left.planned_date) return 1;
        if (!right.planned_date) return -1;
        return left.planned_date.localeCompare(right.planned_date);
      })[0];
    const latestVisit = (visitsByCaseId[entry.id] || [])
      .slice()
      .sort((left, right) => right.visited_on.localeCompare(left.visited_on))[0];
    const implant = caseImplantsByCaseId[entry.id];

    return {
      patient_name: patient?.full_name || "",
      case_no: caseDisplayNoById[entry.id] || "",
      tooth_codes: formatCaseToothLabel(entry),
      case_status: entry.status,
      template: TEMPLATE_LABELS[entry.template_key] || entry.template_key || "",
      next_planned_date: nextStep?.planned_date || "",
      overdue_days:
        nextStep?.planned_date && nextStep.status === "pending"
          ? Math.max(0, -daysFromToday(nextStep.planned_date))
          : "",
      latest_visit_date: latestVisit?.visited_on || "",
      implant_brand: implant?.brand || "",
      implant_model: implant?.model || "",
      implant_diameter_mm: implant?.diameter_mm || "",
      implant_length_mm: implant?.length_mm || "",
      attention_alert: patient?.attention_alert || ""
    };
  });

  const columns = [
    "patient_name",
    "case_no",
    "tooth_codes",
    "case_status",
    "template",
    "next_planned_date",
    "overdue_days",
    "latest_visit_date",
    "implant_brand",
    "implant_model",
    "implant_diameter_mm",
    "implant_length_mm",
    "attention_alert"
  ];

  return [columns.join(",")]
    .concat(
      rows.map((row) =>
        columns
          .map((column) => {
            const value = row[column] ?? "";
            const text = String(value).replace(/"/g, '""');
            return `"${text}"`;
          })
          .join(",")
      )
    )
    .join("\n");
}

export function describeCaseTimeline(caseEntry, patient, nextStep, implant) {
  const timeline = [];

  if (patient?.attention_alert) {
    timeline.push(`注意：${patient.attention_alert}`);
  }

  if (nextStep?.planned_date) {
    timeline.push(
      `下次 ${formatDate(nextStep.planned_date)} / ${
        PROCEDURE_LABELS[nextStep.procedure_type] || nextStep.title
      }`
    );
  }

  if (implant?.brand || implant?.model) {
    timeline.push(
      `植體 ${implant.brand || ""} ${implant.model || ""}`.trim()
    );
  }

  return timeline.join(" · ");
}

export function procedureMatchesSearch(procedures, query) {
  if (!query) {
    return true;
  }

  const normalized = query.toLowerCase();
  return procedures.some((procedure) => {
    const label = PROCEDURE_LABELS[procedure.procedure_type] || procedure.procedure_type;
    return (
      label.toLowerCase().includes(normalized) ||
      (procedure.procedure_note || "").toLowerCase().includes(normalized)
    );
  });
}
