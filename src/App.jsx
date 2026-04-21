import { useDeferredValue, useEffect, useState } from "react";
import DateInput from "./components/DateInput";
import Modal from "./components/Modal";
import PillSelect from "./components/PillSelect";
import ToothPicker from "./components/ToothPicker";
import {
  CLINIC_OPTIONS,
  BONE_GRAFT_OPTIONS,
  CASE_STATUS_LABELS,
  CASE_STATUS_OPTIONS,
  HEALING_SIZE_OPTIONS,
  HEALING_TOGGLE_OPTIONS,
  IMPLANT_BRAND_OPTIONS,
  IMPLANT_DIAMETER_OPTIONS,
  IMPLANT_LENGTH_OPTIONS,
  IMPLANT_MODEL_OPTIONS_BY_BRAND,
  MEMBRANE_OPTIONS,
  NAV_ITEMS,
  PHOTO_LABEL_OPTIONS,
  PLAN_STATUS_LABELS,
  PROCEDURE_LABELS,
  PROCEDURE_OPTIONS,
  SINUS_LIFT_APPROACH_OPTIONS
} from "./lib/constants";
import {
  createEmptyCase,
  createEmptyPatient,
  createEmptyPlanStep,
  createEmptyProcedure,
  createEmptyVisit,
  formatCaseToothLabel,
  getCaseToothCodes,
  getOccupiedToothCodes,
  normalizeToothCodes,
  procedureMatchesSearch
} from "./lib/caseHelpers";
import {
  addDays,
  addMonths,
  calculateAge,
  cx,
  daysFromToday,
  formatDate,
  formatDateTime,
  formatMonthDayYearChip,
  formatShortMonthDay,
  slugifyFileName,
  todayIso
} from "./lib/format";
import { isSupabaseConfigured, supabase } from "./lib/supabase";

const INITIAL_RECORDS = {
  patients: [],
  clinics: [],
  cases: [],
  planSteps: [],
  visits: [],
  visitProcedures: [],
  visitPhotos: [],
  caseImplants: [],
  toothPositions: [],
  templates: [],
  templateSteps: []
};

function groupBy(items, getKey) {
  return items.reduce((accumulator, item) => {
    const key = getKey(item);
    if (!accumulator[key]) {
      accumulator[key] = [];
    }
    accumulator[key].push(item);
    return accumulator;
  }, {});
}

function normalizeText(value) {
  const nextValue = typeof value === "string" ? value.trim() : value;
  return nextValue ? nextValue : null;
}

function createClientId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `local-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function numberOrNull(value) {
  if (value === "" || value === null || value === undefined) {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeHealingSize(value) {
  if (value === "6.2") {
    return "6x2";
  }
  return value || "";
}

function createEmptyToothImplantConfig(toothCode = "") {
  return {
    tooth_code: toothCode,
    implant_brand: "",
    implant_model: "",
    implant_diameter_mm: "",
    implant_length_mm: "",
    healing_used: false,
    healing_size: ""
  };
}

function deriveToothImplants(procedure, toothCodes) {
  const safeToothCodes = toothCodes?.length ? toothCodes : [];
  if (!safeToothCodes.length) {
    return [];
  }

  const savedToothImplants = Array.isArray(procedure?.extra_data?.tooth_implants)
    ? procedure.extra_data.tooth_implants
    : [];

  return safeToothCodes.map((toothCode, index) => {
    const saved =
      savedToothImplants.find((item) => item?.tooth_code === toothCode) ||
      (savedToothImplants.length === 1 && index === 0 ? savedToothImplants[0] : null);

    if (saved) {
      return {
        ...createEmptyToothImplantConfig(toothCode),
        ...saved,
        tooth_code: toothCode,
        healing_used: Boolean(saved.healing_used),
        healing_size: normalizeHealingSize(saved.healing_size)
      };
    }

    if (safeToothCodes.length === 1) {
      return {
        tooth_code: toothCode,
        implant_brand: procedure?.implant_brand || "",
        implant_model: procedure?.implant_model || "",
        implant_diameter_mm: procedure?.implant_diameter_mm ?? "",
        implant_length_mm: procedure?.implant_length_mm ?? "",
        healing_used: Boolean(procedure?.extra_data?.healing_used),
        healing_size: normalizeHealingSize(procedure?.extra_data?.healing_size)
      };
    }

    return createEmptyToothImplantConfig(toothCode);
  });
}

function syncProcedureToothImplants(procedure, toothImplants) {
  const normalizedToothImplants = toothImplants.map((item) => ({
    ...createEmptyToothImplantConfig(item.tooth_code),
    ...item,
    healing_used: Boolean(item.healing_used),
    healing_size: normalizeHealingSize(item.healing_size)
  }));

  const primaryToothImplant =
    normalizedToothImplants.find(
      (item) =>
        item.implant_brand ||
        item.implant_model ||
        item.implant_diameter_mm ||
        item.implant_length_mm ||
        item.healing_used ||
        item.healing_size
    ) || normalizedToothImplants[0];

  return {
    ...procedure,
    implant_brand: primaryToothImplant?.implant_brand || "",
    implant_model: primaryToothImplant?.implant_model || "",
    implant_diameter_mm: primaryToothImplant?.implant_diameter_mm || "",
    implant_length_mm: primaryToothImplant?.implant_length_mm || "",
    extra_data: {
      ...procedure.extra_data,
      healing_used: Boolean(primaryToothImplant?.healing_used),
      healing_size: normalizeHealingSize(primaryToothImplant?.healing_size),
      tooth_implants: normalizedToothImplants
    }
  };
}

const NON_PROGRESS_PROCEDURE_TYPES = new Set(["consultation", "follow_up", "other"]);
const PROCEDURE_OPTION_ORDER = new Map(
  PROCEDURE_OPTIONS.map((option, index) => [option.value, index])
);

function isImplantProcedureType(procedureType) {
  return procedureType === "implant_placement" || procedureType === "iip";
}

function normalizeProcedureTypeSelection(values) {
  const list = (Array.isArray(values) ? values : [values])
    .map((value) => String(value || "").trim())
    .filter(Boolean);

  return Array.from(new Set(list)).sort((left, right) => {
    const leftOrder = PROCEDURE_OPTION_ORDER.get(left);
    const rightOrder = PROCEDURE_OPTION_ORDER.get(right);

    if (leftOrder === undefined && rightOrder === undefined) {
      return left.localeCompare(right);
    }

    if (leftOrder === undefined) return 1;
    if (rightOrder === undefined) return -1;
    return leftOrder - rightOrder;
  });
}

function compareVisitsByTimeline(left, right) {
  return (
    String(left.visited_on || "").localeCompare(String(right.visited_on || "")) ||
    String(left.created_at || "").localeCompare(String(right.created_at || "")) ||
    String(left.id || "").localeCompare(String(right.id || ""))
  );
}

function compareVisitProceduresByTimeline(left, right) {
  return (
    Number(left.procedure_order || 0) - Number(right.procedure_order || 0) ||
    String(left.created_at || "").localeCompare(String(right.created_at || "")) ||
    String(left.id || "").localeCompare(String(right.id || ""))
  );
}

function dedupeTimelineItemsByPatientTooth(items) {
  const seenKeys = new Set();

  return items.filter((entry) => {
    const toothKey = getCaseToothCodes(entry.caseEntry).join("|");
    const caseKey = `${entry.patient.id}::${toothKey}`;

    if (seenKeys.has(caseKey)) {
      return false;
    }

    seenKeys.add(caseKey);
    return true;
  });
}

function getPendingPlanSummary(planSteps) {
  const pendingSteps = (planSteps || [])
    .filter((step) => step.status === "pending")
    .slice()
    .sort(comparePlanStepsByTimeline);

  if (!pendingSteps.length) {
    return null;
  }

  const [primaryStep] = pendingSteps;
  const primaryDate = String(primaryStep.planned_date || "");
  const steps = pendingSteps.filter((step) => String(step.planned_date || "") === primaryDate);

  return {
    planned_date: primaryStep.planned_date || "",
    steps,
    primaryStep
  };
}

function photoTitle(photo) {
  if (!photo) {
    return "未選";
  }

  return photo.photo_label || photo.caption || "Clinical Photo";
}

function photoSortDate(photo, visitsById) {
  const visit = visitsById[photo.visit_id];
  return photo.taken_at || visit?.visited_on || photo.created_at || "";
}

function cloneVisitPhotos(photos) {
  return photos.map((photo) => ({
    ...photo,
    taken_at: photo.taken_at ? photo.taken_at.slice(0, 16) : "",
    marked_for_delete: false
  }));
}

function revokeDraftPhotoUrls(visitDraft) {
  for (const photo of visitDraft.new_photos || []) {
    if (photo.preview_url) {
      URL.revokeObjectURL(photo.preview_url);
    }
  }
}

function comparePlanStepsByTimeline(left, right) {
  if (!left.planned_date && !right.planned_date) {
    return (left.step_order || 0) - (right.step_order || 0) || String(left.id || "").localeCompare(String(right.id || ""));
  }
  if (!left.planned_date) return 1;
  if (!right.planned_date) return -1;

  return (
    left.planned_date.localeCompare(right.planned_date) ||
    (left.step_order || 0) - (right.step_order || 0) ||
    String(left.id || "").localeCompare(String(right.id || ""))
  );
}

function deriveNextPlanStep(caseSteps, currentPlanStepId, referenceDate) {
  const sortedSteps = (caseSteps || []).slice().sort(comparePlanStepsByTimeline);

  if (currentPlanStepId) {
    const currentIndex = sortedSteps.findIndex((step) => step.id === currentPlanStepId);
    if (currentIndex >= 0) {
      return sortedSteps
        .slice(currentIndex + 1)
        .find((step) => step.status === "pending") || null;
    }
  }

  if (referenceDate) {
    return (
      sortedSteps.find(
        (step) => step.status === "pending" && step.planned_date && step.planned_date >= referenceDate
      ) || sortedSteps.find((step) => step.status === "pending") || null
    );
  }

  return sortedSteps.find((step) => step.status === "pending") || null;
}

export default function App() {
  const [session, setSession] = useState(null);
  const [authReady, setAuthReady] = useState(!isSupabaseConfigured);
  const [loginForm, setLoginForm] = useState({ email: "", password: "" });
  const [authError, setAuthError] = useState("");
  const [records, setRecords] = useState(INITIAL_RECORDS);
  const [loadingData, setLoadingData] = useState(false);
  const [busyLabel, setBusyLabel] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [noticeMessage, setNoticeMessage] = useState("");
  const [lastSyncedAt, setLastSyncedAt] = useState("");
  const [activeView, setActiveView] = useState("dashboard");
  const [isTopbarCondensed, setIsTopbarCondensed] = useState(false);
  const [selectedPatientId, setSelectedPatientId] = useState("");
  const [selectedCaseId, setSelectedCaseId] = useState("");
  const [patientQuery, setPatientQuery] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [procedureFilter, setProcedureFilter] = useState("");
  const [casePhotoCompare, setCasePhotoCompare] = useState({
    selectedIds: [],
    open: false
  });
  const [photoPreview, setPhotoPreview] = useState({
    open: false,
    photoId: ""
  });
  const [draftPhotoEditor, setDraftPhotoEditor] = useState({
    open: false,
    kind: "existing",
    index: -1
  });
  const [patientSheetOpen, setPatientSheetOpen] = useState(false);
  const [patientActionsOpen, setPatientActionsOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [searchFiltersOpen, setSearchFiltersOpen] = useState(false);
  const [clinicCatalogFallback, setClinicCatalogFallback] = useState(false);
  const [patientModal, setPatientModal] = useState({
    open: false,
    mode: "create",
    patientId: "",
    clinicDraft: "",
    values: createEmptyPatient()
  });
  const [caseModal, setCaseModal] = useState({
    open: false,
    mode: "create",
    caseId: "",
    values: createEmptyCase()
  });
  const [planModal, setPlanModal] = useState({
    open: false,
    mode: "create",
    stepId: "",
    values: createEmptyPlanStep()
  });
  const [visitModal, setVisitModal] = useState({
    open: false,
    mode: "create",
    visitId: "",
    values: createEmptyVisit()
  });
  const deferredPatientQuery = useDeferredValue(patientQuery);
  const deferredSearchQuery = useDeferredValue(searchQuery);

  useEffect(() => {
    const handleScroll = () => {
      setIsTopbarCondensed(window.scrollY > 36);
    };

    handleScroll();
    window.addEventListener("scroll", handleScroll, { passive: true });

    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  useEffect(() => {
    if (!isSupabaseConfigured) {
      return undefined;
    }

    let isMounted = true;

    supabase.auth.getSession().then(({ data, error }) => {
      if (!isMounted) {
        return;
      }

      if (error) {
        setAuthError(error.message);
      }

      setSession(data.session || null);
      setAuthReady(true);
    });

    const {
      data: { subscription }
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession || null);
      setAuthReady(true);
    });

    return () => {
      isMounted = false;
      subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    setPatientSheetOpen(false);
    setPatientActionsOpen(false);
    setMobileMenuOpen(false);
  }, [activeView]);

  function getNextPlanStepOrder(stepEntries) {
    return (
      (stepEntries || []).reduce(
        (maxOrder, step) => Math.max(maxOrder, Number(step.step_order) || 0),
        0
      ) + 1
    );
  }

  async function loadAppData() {
    if (!session?.user || !supabase) {
      return;
    }

    setLoadingData(true);
    setErrorMessage("");

    const queries = [
      supabase.from("patients").select("*").order("created_at", { ascending: false }),
      supabase
        .from("clinics")
        .select("*")
        .order("sort_order", { ascending: true })
        .order("name", { ascending: true }),
      supabase.from("cases").select("*").order("created_at", { ascending: false }),
      supabase
        .from("case_plan_steps")
        .select("*")
        .order("planned_date", { ascending: true, nullsFirst: false }),
      supabase.from("visits").select("*").order("visited_on", { ascending: false }),
      supabase
        .from("visit_procedures")
        .select("*")
        .order("procedure_order", { ascending: true }),
      supabase.from("visit_photos").select("*").order("created_at", { ascending: false }),
      supabase.from("case_implants").select("*"),
      supabase.from("tooth_positions").select("*").order("sort_order", { ascending: true }),
      supabase.from("treatment_templates").select("*").order("label", { ascending: true }),
      supabase
        .from("treatment_template_steps")
        .select("*")
        .order("template_key", { ascending: true })
        .order("step_order", { ascending: true })
    ];

    const [
      patientsResult,
      clinicsResult,
      casesResult,
      planStepsResult,
      visitsResult,
      proceduresResult,
      photosResult,
      implantsResult,
      toothPositionsResult,
      templatesResult,
      templateStepsResult
    ] = await Promise.all(queries);

    const firstError = [
      patientsResult.error,
      casesResult.error,
      planStepsResult.error,
      visitsResult.error,
      proceduresResult.error,
      photosResult.error,
      implantsResult.error,
      toothPositionsResult.error,
      templatesResult.error,
      templateStepsResult.error
    ].find(Boolean);

    if (firstError) {
      setErrorMessage(firstError.message);
      setLoadingData(false);
      return;
    }

    const clinicCatalogMissing = Boolean(
      clinicsResult?.error &&
        (
          clinicsResult.error.code === "42P01" ||
          clinicsResult.error.code === "PGRST205" ||
          /clinics/i.test(clinicsResult.error.message || "")
        )
    );

    if (clinicsResult?.error && !clinicCatalogMissing) {
      setErrorMessage(clinicsResult.error.message);
      setLoadingData(false);
      return;
    }

    setClinicCatalogFallback(clinicCatalogMissing);

    const hydratedPhotos = await Promise.all(
      (photosResult.data || []).map(async (photo) => {
        const signedUrlResult = await supabase.storage
          .from(photo.bucket_name)
          .createSignedUrl(photo.storage_path, 3600);
        return {
          ...photo,
          signed_url: signedUrlResult.data?.signedUrl || ""
        };
      })
    );

    setRecords({
      patients: patientsResult.data || [],
      clinics: clinicCatalogMissing ? [] : clinicsResult.data || [],
      cases: casesResult.data || [],
      planSteps: planStepsResult.data || [],
      visits: visitsResult.data || [],
      visitProcedures: proceduresResult.data || [],
      visitPhotos: hydratedPhotos,
      caseImplants: implantsResult.data || [],
      toothPositions: toothPositionsResult.data || [],
      templates: templatesResult.data || [],
      templateSteps: templateStepsResult.data || []
    });
    setLastSyncedAt(new Date().toISOString());

    setLoadingData(false);
  }

  useEffect(() => {
    if (session?.user) {
      loadAppData();
    } else {
      setRecords(INITIAL_RECORDS);
      setSelectedPatientId("");
      setSelectedCaseId("");
    }
  }, [session?.user?.id]);

  useEffect(() => {
    if (!records.patients.length) {
      if (selectedPatientId) {
        setSelectedPatientId("");
      }
      return;
    }

    const hasSelectedPatient = records.patients.some(
      (patient) => patient.id === selectedPatientId
    );
    if (!hasSelectedPatient) {
      setSelectedPatientId(records.patients[0].id);
    }
  }, [records.patients, selectedPatientId]);

  useEffect(() => {
    if (!selectedPatientId) {
      if (selectedCaseId) {
        setSelectedCaseId("");
      }
      return;
    }

    const casesForPatient = records.cases.filter(
      (entry) => entry.patient_id === selectedPatientId
    );

    if (!casesForPatient.length) {
      if (selectedCaseId) {
        setSelectedCaseId("");
      }
      return;
    }

    const hasSelectedCase = casesForPatient.some((entry) => entry.id === selectedCaseId);
    if (!hasSelectedCase) {
      setSelectedCaseId(casesForPatient[0].id);
    }
  }, [records.cases, selectedPatientId, selectedCaseId]);

  const patientsById = Object.fromEntries(records.patients.map((item) => [item.id, item]));
  const casesById = Object.fromEntries(records.cases.map((item) => [item.id, item]));
  const visitsById = Object.fromEntries(records.visits.map((item) => [item.id, item]));
  const caseImplantsByCaseId = Object.fromEntries(
    records.caseImplants.map((item) => [item.case_id, item])
  );
  const planStepsByCaseId = groupBy(records.planSteps, (item) => item.case_id);
  const visitsByCaseId = groupBy(records.visits, (item) => item.case_id);
  const proceduresByVisitId = groupBy(records.visitProcedures, (item) => item.visit_id);
  const photosByVisitId = groupBy(records.visitPhotos, (item) => item.visit_id);
  const photosByCaseId = groupBy(records.visitPhotos, (item) => item.case_id);
  const proceduresByCaseId = records.visitProcedures.reduce((accumulator, procedure) => {
    const visit = visitsById[procedure.visit_id];
    if (!visit) {
      return accumulator;
    }

    if (!accumulator[visit.case_id]) {
      accumulator[visit.case_id] = [];
    }

    accumulator[visit.case_id].push(procedure);
    return accumulator;
  }, {});
  const completedProcedureTypesByCaseId = records.cases.reduce((accumulator, caseEntry) => {
    const seenTypes = new Set();
    const completedTypes = [];

    ((visitsByCaseId[caseEntry.id] || []).slice().sort(compareVisitsByTimeline) || []).forEach((visit) => {
      ((proceduresByVisitId[visit.id] || []).slice().sort(compareVisitProceduresByTimeline) || []).forEach(
        (procedure) => {
          if (
            !procedure.procedure_type ||
            NON_PROGRESS_PROCEDURE_TYPES.has(procedure.procedure_type) ||
            seenTypes.has(procedure.procedure_type)
          ) {
            return;
          }

          seenTypes.add(procedure.procedure_type);
          completedTypes.push(procedure.procedure_type);
        }
      );
    });

    accumulator[caseEntry.id] = completedTypes;
    return accumulator;
  }, {});
  const nextPendingPlanSummaryByCaseId = records.cases.reduce((accumulator, caseEntry) => {
    accumulator[caseEntry.id] = getPendingPlanSummary(planStepsByCaseId[caseEntry.id] || []);
    return accumulator;
  }, {});

  const deferredPatientQueryText = deferredPatientQuery.trim().toLowerCase();
  const filteredPatients = records.patients.filter((patient) => {
    if (!deferredPatientQueryText) {
      return true;
    }

    return (
      patient.full_name.toLowerCase().includes(deferredPatientQueryText) ||
      (patient.attention_alert || "").toLowerCase().includes(deferredPatientQueryText)
    );
  });

  const selectedPatient = patientsById[selectedPatientId] || null;
  const selectedCase = casesById[selectedCaseId] || null;
  const selectedPatientCases = records.cases
    .filter((entry) => entry.patient_id === selectedPatientId)
    .sort((left, right) => {
      const rightDate = right.started_on || right.created_at;
      const leftDate = left.started_on || left.created_at;
      return rightDate.localeCompare(leftDate);
    });
  const selectedCasePlanSteps = (planStepsByCaseId[selectedCaseId] || [])
    .slice()
    .sort((left, right) => comparePlanStepsByTimeline(right, left));
  const selectedCaseVisits = (visitsByCaseId[selectedCaseId] || [])
    .slice()
    .sort((left, right) => right.visited_on.localeCompare(left.visited_on));
  const selectedCaseImplant = selectedCaseId ? caseImplantsByCaseId[selectedCaseId] : null;
  const selectedCaseDeliveryDate =
    selectedCaseVisits
      .filter((visit) =>
        (proceduresByVisitId[visit.id] || []).some(
          (procedure) => procedure.procedure_type === "delivery"
        )
      )
      .map((visit) => visit.visited_on)
      .sort((left, right) => right.localeCompare(left))[0] || null;
  const selectedCaseLatestImplantProcedure =
    selectedCaseVisits
      .flatMap((visit) =>
        (proceduresByVisitId[visit.id] || [])
          .filter((procedure) => isImplantProcedureType(procedure.procedure_type))
          .map((procedure) => ({
            ...procedure,
            visited_on: visit.visited_on
          }))
      )
      .sort((left, right) => {
        return (
          right.visited_on.localeCompare(left.visited_on) ||
          String(right.created_at || "").localeCompare(String(left.created_at || ""))
        );
      })[0] || null;
  const selectedCasePhotos = (photosByCaseId[selectedCaseId] || []).slice();
  const selectedCaseToothLabel = formatCaseToothLabel(selectedCase);
  const selectedCaseToothHeading = formatCaseToothLabel(selectedCase, { withPrefix: true });
  const selectedCaseImplantEntries = (() => {
    const caseToothCodes = getCaseToothCodes(selectedCase);

    if (selectedCaseLatestImplantProcedure) {
      const toothImplants = deriveToothImplants(selectedCaseLatestImplantProcedure, caseToothCodes)
        .filter(
          (item) =>
            item.implant_brand ||
            item.implant_model ||
            item.implant_diameter_mm ||
            item.implant_length_mm ||
            item.healing_used ||
            item.healing_size
        )
        .map((item) => ({
          ...item,
          placed_on: selectedCaseLatestImplantProcedure.visited_on || selectedCaseImplant?.placed_on || null
        }));

      if (toothImplants.length) {
        return toothImplants;
      }
    }

    if (!selectedCaseImplant) {
      return [];
    }

    return [
      {
        tooth_code: caseToothCodes[0] || "",
        implant_brand: selectedCaseImplant.brand || "",
        implant_model: selectedCaseImplant.model || "",
        implant_diameter_mm: selectedCaseImplant.diameter_mm ?? "",
        implant_length_mm: selectedCaseImplant.length_mm ?? "",
        placed_on: selectedCaseImplant.placed_on || null
      }
    ];
  })();
  const getPlanStepLabel = (step) =>
    PROCEDURE_LABELS[step?.procedure_type] || step?.title || "";
  const getProcedureToneClass = (procedureType) => {
    switch (procedureType) {
      case "extraction":
        return "pill--rose";
      case "arp":
        return "pill--sand";
      case "gbr":
        return "pill--mist";
      case "sinus_lift":
        return "pill--amber";
      case "remove_membrane":
        return "pill--sand";
      case "iip":
      case "implant_placement":
        return "pill--green";
      case "fgg_ctg":
        return "pill--petal";
      case "stage_2_healing_abutment":
        return "pill--mint";
      case "impression_scan":
        return "pill--lavender";
      case "provisional":
        return "pill--sky";
      case "delivery":
        return "pill--gold";
      case "follow_up":
        return "pill--sage";
      default:
        return "pill--stone";
    }
  };
  const getCaseStatusToneClass = (status) => {
    switch (status) {
      case "active":
        return "pill--green";
      case "completed":
        return "pill--sky";
      case "on_hold":
        return "pill--amber";
      case "cancelled":
        return "pill--rose";
      case "planned":
      default:
        return "pill--stone";
    }
  };
  const getMembraneToneClass = (membraneType) => {
    switch (membraneType) {
      case "resorbable":
        return "pill--mint";
      case "non_resorbable":
        return "pill--amber";
      default:
        return "pill--stone";
    }
  };
  const getImplantBrandToneClass = (brand) => {
    switch (brand) {
      case "osstem":
        return "pill--sand";
      case "astra":
        return "pill--mint";
      case "iti":
        return "pill--mist";
      default:
        return "pill--stone";
    }
  };
  const getHealingToggleToneClass = (value) => {
    switch (value) {
      case "yes":
        return "pill--sage";
      case "no":
      default:
        return "pill--stone";
    }
  };
  const getPhotoLabelToneClass = (label) => {
    switch (label) {
      case "pre-op":
        return "pill--rose";
      case "post-op":
        return "pill--mint";
      case "panorama":
        return "pill--mist";
      case "cbct":
        return "pill--sky";
      case "healing":
        return "pill--sage";
      case "delivery":
        return "pill--gold";
      default:
        return "pill--stone";
    }
  };
  const caseDisplayNoById = Object.fromEntries(
    Object.values(groupBy(records.cases, (entry) => entry.patient_id)).flatMap((patientCases) =>
      patientCases
        .slice()
        .sort((left, right) => {
          const leftKey = left.created_at || left.started_on || left.id;
          const rightKey = right.created_at || right.started_on || right.id;
          return leftKey.localeCompare(rightKey);
        })
        .map((entry, index) => [entry.id, index + 1])
    )
  );
  const selectedPatientCaseToothCodes = selectedPatient
    ? getOccupiedToothCodes(
        records.cases.filter((entry) => entry.patient_id === selectedPatient.id),
        caseModal.caseId
      )
    : [];
  const selectedCasePhotoGroups = selectedCaseVisits
    .map((visit) => ({
      visit,
      procedures: proceduresByVisitId[visit.id] || [],
      photos: (photosByVisitId[visit.id] || [])
        .slice()
        .sort((left, right) => {
          const leftDate = photoSortDate(left, visitsById);
          const rightDate = photoSortDate(right, visitsById);
          return rightDate.localeCompare(leftDate) || String(right.id).localeCompare(String(left.id));
        })
    }))
    .filter((group) => group.photos.length > 0);

  const pendingPlanSteps = records.cases
    .map((caseEntry) => {
      const patient = patientsById[caseEntry.patient_id];
      const summary = getPendingPlanSummary(planStepsByCaseId[caseEntry.id] || []);

      if (!patient || !summary) {
        return null;
      }

      return {
        ...summary,
        caseEntry,
        patient,
        diffDays: summary.planned_date ? daysFromToday(summary.planned_date) : null
      };
    })
    .filter(Boolean);

  const overdueItems = dedupeTimelineItemsByPatientTooth(
    pendingPlanSteps
      .filter((entry) => entry.diffDays !== null && entry.diffDays < 0)
      .sort((left, right) => left.diffDays - right.diffDays)
  );

  const upcomingItems = dedupeTimelineItemsByPatientTooth(
    pendingPlanSteps
      .filter((entry) => entry.diffDays !== null && entry.diffDays >= 0)
      .sort((left, right) => left.diffDays - right.diffDays)
  );

  const stats = {
    totalCases: records.cases.length,
    activeCases: records.cases.filter((entry) => entry.status === "active").length,
    totalPatients: records.patients.length
  };
  const clinicStats = (() => {
    const clinicMap = new Map();

    const ensureClinic = (clinicName) => {
      const key = clinicName || "未設定";
      if (!clinicMap.has(key)) {
        clinicMap.set(key, {
          clinicName: key,
          patientCount: 0,
          caseCount: 0,
          activeCaseCount: 0,
          upcomingCount: 0,
          overdueCount: 0
        });
      }
      return clinicMap.get(key);
    };

    records.patients.forEach((patient) => {
      ensureClinic(patient.clinic_name).patientCount += 1;
    });

    records.cases.forEach((caseEntry) => {
      const clinicName = patientsById[caseEntry.patient_id]?.clinic_name || "未設定";
      const clinic = ensureClinic(clinicName);
      clinic.caseCount += 1;
      if (caseEntry.status === "active") {
        clinic.activeCaseCount += 1;
      }
    });

    upcomingItems.forEach((item) => {
      ensureClinic(item.patient.clinic_name).upcomingCount += 1;
    });

    overdueItems.forEach((item) => {
      ensureClinic(item.patient.clinic_name).overdueCount += 1;
    });

    return Array.from(clinicMap.values()).sort((left, right) => {
      return (
        right.caseCount - left.caseCount ||
        right.patientCount - left.patientCount ||
        left.clinicName.localeCompare(right.clinicName)
      );
    });
  })();
  const procedureStats = Object.entries(
    records.visitProcedures.reduce((accumulator, procedure) => {
      const nextCount = accumulator[procedure.procedure_type] || 0;
      accumulator[procedure.procedure_type] = nextCount + 1;
      return accumulator;
    }, {})
  )
    .map(([procedureType, count]) => ({
      procedureType,
      label: PROCEDURE_LABELS[procedureType] || procedureType,
      count
    }))
    .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label));
  const analyticsStats = {
    totalClinics: clinicStats.length,
    totalUpcoming: upcomingItems.length,
    totalOverdue: overdueItems.length
  };
  const procedureFilterOptions = [
    { value: "", label: "全部治療內容" },
    ...PROCEDURE_OPTIONS
  ];
  const persistedClinicOptions = records.clinics.map((clinic) => ({
    value: clinic.name,
    label: clinic.name
  }));
  const clinicBaseOptions =
    clinicCatalogFallback && !records.clinics.length ? CLINIC_OPTIONS : persistedClinicOptions;
  const clinicSelectionOptions = [{ value: "", label: "未設定" }, ...clinicBaseOptions];
  if (
    patientModal.values.clinic_name &&
    !clinicSelectionOptions.some((option) => option.value === patientModal.values.clinic_name)
  ) {
    clinicSelectionOptions.push({
      value: patientModal.values.clinic_name,
      label: patientModal.values.clinic_name
    });
  }
  const membraneSelectionOptions = [{ value: "", label: "未設定" }, ...MEMBRANE_OPTIONS];
  const photoLabelSelectionOptions = [{ value: "", label: "未設定" }, ...PHOTO_LABEL_OPTIONS.map((option) => ({
    value: option,
    label: option
  }))];
  const healingSizeGroups = Array.from(
    HEALING_SIZE_OPTIONS.reduce((groupMap, option) => {
      const groupLabel =
        option.groupLabel || (option.value.includes("x") ? option.value.split("x")[0] : option.value);
      const groupItems = groupMap.get(groupLabel) || [];
      groupItems.push(option);
      groupMap.set(groupLabel, groupItems);
      return groupMap;
    }, new Map())
  );
  const nextPlanModeOptions = [
    { value: "off", label: "先不安排" },
    { value: "on", label: "安排下次" }
  ];
  const todayDate = todayIso();
  const todayShortcuts = [{ label: "今天", value: todayDate }];
  const visitFollowUpBaseDate = visitModal.values.visited_on || todayDate;
  const followUpShortcuts = [
    { label: "今天", value: todayDate },
    { label: "+1M", value: addMonths(todayDate, 1) },
    { label: "+2M", value: addMonths(todayDate, 2) },
    { label: "+3M", value: addMonths(todayDate, 3) },
    { label: "+4M", value: addMonths(todayDate, 4) },
    { label: "+6M", value: addMonths(todayDate, 6) }
  ];
  const visitFollowUpShortcuts = [
    { label: "當天", value: visitFollowUpBaseDate },
    { label: "+1M", value: addMonths(visitFollowUpBaseDate, 1) },
    { label: "+2M", value: addMonths(visitFollowUpBaseDate, 2) },
    { label: "+3M", value: addMonths(visitFollowUpBaseDate, 3) },
    { label: "+4M", value: addMonths(visitFollowUpBaseDate, 4) },
    { label: "+6M", value: addMonths(visitFollowUpBaseDate, 6) }
  ];

  const searchText = deferredSearchQuery.trim().toLowerCase();
  const searchResults = records.cases.filter((entry) => {
    const patient = patientsById[entry.patient_id];
    const caseProcedures = proceduresByCaseId[entry.id] || [];
    const casePlanSteps = planStepsByCaseId[entry.id] || [];
    const completedProcedureTypes = completedProcedureTypesByCaseId[entry.id] || [];

    const matchesKeyword =
      !searchText ||
      patient?.full_name?.toLowerCase().includes(searchText) ||
      String(caseDisplayNoById[entry.id] || "").includes(searchText) ||
      getCaseToothCodes(entry).some((code) => code.toLowerCase().includes(searchText)) ||
      procedureMatchesSearch(caseProcedures, searchText) ||
      completedProcedureTypes.some((procedureType) =>
        (PROCEDURE_LABELS[procedureType] || procedureType).toLowerCase().includes(searchText)
      ) ||
      casePlanSteps.some((step) => {
        const label = getPlanStepLabel(step);
        return (
          label.toLowerCase().includes(searchText) ||
          (step.note || "").toLowerCase().includes(searchText)
        );
      });

    const matchesProcedure =
      !procedureFilter ||
      completedProcedureTypes.includes(procedureFilter) ||
      caseProcedures.some((procedure) => procedure.procedure_type === procedureFilter) ||
      casePlanSteps.some((step) => step.procedure_type === procedureFilter);

    return matchesKeyword && matchesProcedure;
  });

  const selectedComparePhotos = casePhotoCompare.selectedIds
    .map((photoId) => selectedCasePhotos.find((photo) => photo.id === photoId))
    .filter(Boolean)
    .sort((left, right) => {
      const leftDate = photoSortDate(left, visitsById);
      const rightDate = photoSortDate(right, visitsById);

      return rightDate.localeCompare(leftDate) || String(right.id).localeCompare(String(left.id));
    });
  const previewPhoto = selectedCasePhotos.find((photo) => photo.id === photoPreview.photoId);
  const previewPhotoVisit = previewPhoto ? visitsById[previewPhoto.visit_id] : null;
  const previewPhotoProcedures = previewPhotoVisit ? proceduresByVisitId[previewPhotoVisit.id] || [] : [];
  const currentUserEmail = session?.user?.email || "";
  const showNoDataHint = Boolean(
    authReady && session?.user && !loadingData && !records.patients.length
  );
  const activeDraftPhoto =
    draftPhotoEditor.kind === "existing"
      ? visitModal.values.existing_photos[draftPhotoEditor.index]
      : visitModal.values.new_photos[draftPhotoEditor.index];

  useEffect(() => {
    const selectedIds = new Set(selectedCasePhotos.map((photo) => photo.id));

    setCasePhotoCompare((current) => {
      const nextSelectedIds = current.selectedIds.filter((photoId) => selectedIds.has(photoId));
      const nextOpen = current.open && nextSelectedIds.length >= 2;

      if (
        current.selectedIds.length === nextSelectedIds.length &&
        current.selectedIds.every((photoId, index) => photoId === nextSelectedIds[index]) &&
        current.open === nextOpen
      ) {
        return current;
      }

      return {
        selectedIds: nextSelectedIds,
        open: Boolean(nextOpen)
      };
    });
  }, [selectedCaseId, selectedCasePhotos]);

  function openPatientModal(mode, patient = null) {
    setPatientModal({
      open: true,
      mode,
      patientId: patient?.id || "",
      clinicDraft: "",
      values: patient
        ? {
            full_name: patient.full_name || "",
            clinic_name: patient.clinic_name || "",
            birth_date: patient.birth_date || "",
            attention_alert: patient.attention_alert || "",
            general_notes: patient.general_notes || ""
          }
        : createEmptyPatient()
    });
  }

  function closePatientModal() {
    setPatientModal((current) => ({ ...current, open: false }));
  }

  async function handleCreateClinic() {
    if (!supabase || !session?.user) {
      return;
    }

    if (clinicCatalogFallback) {
      setErrorMessage("請先執行 clinics migration，才能新增自訂診所。");
      return;
    }

    const clinicName = patientModal.clinicDraft.trim();
    if (!clinicName) {
      return;
    }

    const existingClinic = records.clinics.find((clinic) => clinic.name === clinicName);
    if (existingClinic) {
      setPatientModal((current) => ({
        ...current,
        clinicDraft: "",
        values: { ...current.values, clinic_name: clinicName }
      }));
      return;
    }

    setBusyLabel("新增診所中");
    setErrorMessage("");

    const nextSortOrder =
      records.clinics.reduce(
        (maxSortOrder, clinic) => Math.max(maxSortOrder, Number(clinic.sort_order) || 0),
        0
      ) + 1;

    const { data, error } = await supabase
      .from("clinics")
      .insert({
        owner_user_id: session.user.id,
        name: clinicName,
        sort_order: nextSortOrder
      })
      .select("*")
      .single();

    setBusyLabel("");

    if (error) {
      setErrorMessage(error.message);
      return;
    }

    setRecords((current) => ({
      ...current,
      clinics: [...current.clinics, data].sort((left, right) => {
        const leftSort = Number(left.sort_order) || 0;
        const rightSort = Number(right.sort_order) || 0;
        return leftSort - rightSort || left.name.localeCompare(right.name);
      })
    }));
    setPatientModal((current) => ({
      ...current,
      clinicDraft: "",
      values: { ...current.values, clinic_name: clinicName }
    }));
  }

  async function handleDeleteClinic(clinicName) {
    if (!supabase || !session?.user || !clinicName) {
      return;
    }

    if (clinicCatalogFallback) {
      setErrorMessage("請先執行 clinics migration，才能管理自訂診所。");
      return;
    }

    const confirmed = window.confirm(
      "刪除此診所後，之後新增或編輯病患時將不再顯示這個診所；已經存在的病患資料不會被清空。確定刪除嗎？"
    );
    if (!confirmed) {
      return;
    }

    setBusyLabel("刪除診所中");
    setErrorMessage("");

    const { error } = await supabase
      .from("clinics")
      .delete()
      .eq("owner_user_id", session.user.id)
      .eq("name", clinicName);

    setBusyLabel("");

    if (error) {
      setErrorMessage(error.message);
      return;
    }

    setRecords((current) => ({
      ...current,
      clinics: current.clinics.filter((clinic) => clinic.name !== clinicName)
    }));
    setPatientModal((current) => ({
      ...current,
      values: {
        ...current.values,
        clinic_name: current.values.clinic_name === clinicName ? "" : current.values.clinic_name
      }
    }));
  }

  function renderPatientList(onPatientSelect) {
    return (
      <div className="patient-list">
        {filteredPatients.map((patient) => {
          const patientCases = records.cases.filter((entry) => entry.patient_id === patient.id);

          return (
            <button
              key={patient.id}
              className={cx("patient-item", selectedPatientId === patient.id && "is-selected")}
              type="button"
              onClick={() => {
                setSelectedPatientId(patient.id);
                setActiveView("patients");
                onPatientSelect?.();
              }}
            >
              <div className="patient-item__title">
                <strong>{patient.full_name}</strong>
                {patient.attention_alert ? <span className="warning-dot" /> : null}
              </div>
              <div className="patient-item__meta">
                <span>
                  {patient.birth_date
                    ? `${calculateAge(patient.birth_date) ?? "-"} 歲`
                    : "未設定生日"}
                </span>
                <span>{patientCases.length} case(s)</span>
              </div>
            </button>
          );
        })}
        {!filteredPatients.length ? <div className="empty-state">查無病患。</div> : null}
      </div>
    );
  }

  function openCaseModal(mode, caseEntry = null, patientId = selectedPatientId) {
    const toothCodes = getCaseToothCodes(caseEntry);

    setCaseModal({
      open: true,
      mode,
      caseId: caseEntry?.id || "",
      values: caseEntry
        ? {
            patient_id: caseEntry.patient_id,
            tooth_codes: toothCodes,
            status: caseEntry.status || "active",
            template_key: caseEntry.template_key || "",
            initial_procedure_types: [],
            title: caseEntry.title || "",
            started_on: caseEntry.started_on || "",
            target_restoration_on: caseEntry.target_restoration_on || "",
            diagnosis_notes: caseEntry.diagnosis_notes || "",
            internal_notes: caseEntry.internal_notes || ""
          }
        : {
            ...createEmptyCase(patientId),
            started_on: todayIso()
          }
    });
  }

  function closeCaseModal() {
    setCaseModal((current) => ({ ...current, open: false }));
  }

  function openPlanModal(mode, step = null, caseId = selectedCaseId) {
    const caseSteps = (planStepsByCaseId[caseId] || []).slice();
    const latestDatedStep = caseSteps
      .filter((item) => item.planned_date)
      .sort(comparePlanStepsByTimeline)
      .at(-1);

    setPlanModal({
      open: true,
      mode,
      stepId: step?.id || "",
      values: step
        ? {
            case_id: step.case_id,
            step_order: step.step_order,
            title: PROCEDURE_LABELS[step.procedure_type] || step.title || "",
            procedure_type: step.procedure_type || "follow_up",
            planned_date: step.planned_date || "",
            status: step.status || "pending",
            note: step.note || ""
          }
        : {
            ...createEmptyPlanStep(caseId),
            planned_date: latestDatedStep?.planned_date
              ? addDays(latestDatedStep.planned_date, 14)
              : selectedCase?.started_on
                ? addDays(selectedCase.started_on, 14)
                : ""
          }
    });
  }

  function closePlanModal() {
    setPlanModal((current) => ({ ...current, open: false }));
  }

  function openVisitModal(mode, caseId = selectedCaseId, visit = null, planStep = null) {
    if (visitModal.open) {
      revokeDraftPhotoUrls(visitModal.values);
    }

    const caseSteps = planStepsByCaseId[caseId] || [];
    const existingPhotos = visit
      ? cloneVisitPhotos(photosByVisitId[visit.id] || [])
      : [];
    const procedures = visit
      ? (proceduresByVisitId[visit.id] || []).map((procedure) => ({
          ...procedure,
          implant_diameter_mm: procedure.implant_diameter_mm ?? "",
          implant_length_mm: procedure.implant_length_mm ?? "",
          bone_graft_materials: procedure.bone_graft_materials || [],
          membrane_type: procedure.membrane_type || "",
          membrane_note: procedure.membrane_note || "",
          sinus_lift_approach: procedure.sinus_lift_approach || "",
          extra_data: {
            healing_used: Boolean(procedure.extra_data?.healing_used),
            healing_size:
              normalizeHealingSize(procedure.extra_data?.healing_size),
            tooth_implants: Array.isArray(procedure.extra_data?.tooth_implants)
              ? procedure.extra_data.tooth_implants.map((item) => ({
                  ...item,
                  healing_used: Boolean(item?.healing_used),
                  healing_size: normalizeHealingSize(item?.healing_size)
                }))
              : []
          }
        }))
      : [createEmptyProcedure(planStep?.procedure_type || "consultation")];
    const referenceStepId = visit?.plan_step_id || planStep?.id || "";
    const referenceDate = visit?.visited_on || planStep?.planned_date || todayIso();
    const nextPlanStep = deriveNextPlanStep(caseSteps, referenceStepId, referenceDate);

    setVisitModal({
      open: true,
      mode,
      visitId: visit?.id || "",
      values: visit
        ? {
            case_id: visit.case_id,
            plan_step_id: visit.plan_step_id || "",
            visited_on: visit.visited_on || "",
            summary: visit.summary || "",
            next_note: visit.next_note || "",
            next_plan_enabled: Boolean(nextPlanStep),
            next_plan_step_id: nextPlanStep?.id || "",
            next_plan_procedure_type: nextPlanStep?.procedure_type || "",
            next_plan_planned_date: nextPlanStep?.planned_date || "",
            next_plan_note: nextPlanStep?.note || "",
            procedures,
            existing_photos: existingPhotos,
            new_photos: []
          }
        : {
            ...createEmptyVisit(caseId, planStep),
            visited_on: planStep?.planned_date || todayIso(),
            next_plan_enabled: Boolean(nextPlanStep),
            next_plan_step_id: nextPlanStep?.id || "",
            next_plan_procedure_type: nextPlanStep?.procedure_type || "",
            next_plan_planned_date:
              nextPlanStep?.planned_date || addDays(planStep?.planned_date || todayIso(), 14),
            next_plan_note: nextPlanStep?.note || ""
          }
    });
  }

  function closeVisitModal() {
    revokeDraftPhotoUrls(visitModal.values);
    setDraftPhotoEditor({
      open: false,
      kind: "existing",
      index: -1
    });
    setVisitModal((current) => ({ ...current, open: false }));
  }

  function updateVisitProcedureAt(index, updater) {
    setVisitModal((current) => ({
      ...current,
      values: {
        ...current.values,
        procedures: current.values.procedures.map((item, innerIndex) =>
          innerIndex === index ? updater(item) : item
        )
      }
    }));
  }

  function openDraftPhotoEditor(kind, index) {
    setDraftPhotoEditor({
      open: true,
      kind,
      index
    });
  }

  function closeDraftPhotoEditor() {
    setDraftPhotoEditor({
      open: false,
      kind: "existing",
      index: -1
    });
  }

  function updateDraftPhoto(kind, index, patch) {
    setVisitModal((current) => ({
      ...current,
      values: {
        ...current.values,
        [kind === "existing" ? "existing_photos" : "new_photos"]: current.values[
          kind === "existing" ? "existing_photos" : "new_photos"
        ].map((item, innerIndex) => (innerIndex === index ? { ...item, ...patch } : item))
      }
    }));
  }

  function toggleExistingPhotoDelete(index) {
    setVisitModal((current) => ({
      ...current,
      values: {
        ...current.values,
        existing_photos: current.values.existing_photos.map((item, innerIndex) =>
          innerIndex === index
            ? {
                ...item,
                marked_for_delete: !item.marked_for_delete
              }
            : item
        )
      }
    }));
  }

  function removeNewPhotoDraft(index) {
    setVisitModal((current) => {
      const target = current.values.new_photos[index];
      if (target?.preview_url) {
        URL.revokeObjectURL(target.preview_url);
      }
      return {
        ...current,
        values: {
          ...current.values,
          new_photos: current.values.new_photos.filter(
            (_item, innerIndex) => innerIndex !== index
          )
        }
      };
    });

    closeDraftPhotoEditor();
  }

  function toggleCaseComparePhoto(photoId) {
    setCasePhotoCompare((current) => {
      const alreadySelected = current.selectedIds.includes(photoId);
      const nextSelectedIds = alreadySelected
        ? current.selectedIds.filter((id) => id !== photoId)
        : [...current.selectedIds, photoId];

      return {
        ...current,
        selectedIds: nextSelectedIds,
        open: current.open && nextSelectedIds.length >= 2
      };
    });
  }

  async function handleSignIn(event) {
    event.preventDefault();
    if (!supabase) {
      return;
    }

    setAuthError("");
    setBusyLabel("登入中");

    const { error } = await supabase.auth.signInWithPassword({
      email: loginForm.email,
      password: loginForm.password
    });

    setBusyLabel("");

    if (error) {
      setAuthError(error.message);
    }
  }

  async function handleSignOut() {
    if (!supabase) {
      return;
    }
    await supabase.auth.signOut();
  }

  async function removeStorageObjects(photoEntries) {
    const paths = photoEntries.map((photo) => photo.storage_path).filter(Boolean);
    if (!paths.length) {
      return;
    }

    const { error } = await supabase.storage.from("case-photos").remove(paths);
    if (error) {
      throw error;
    }
  }

  async function handlePatientSubmit(event) {
    event.preventDefault();
    if (!supabase || !session?.user) {
      return;
    }

    setBusyLabel(patientModal.mode === "create" ? "建立病患中" : "更新病患中");
    setErrorMessage("");

    const payload = {
      owner_user_id: session.user.id,
      full_name: patientModal.values.full_name.trim(),
      clinic_name: patientModal.values.clinic_name || null,
      birth_date: patientModal.values.birth_date || null,
      attention_alert: normalizeText(patientModal.values.attention_alert),
      general_notes: normalizeText(patientModal.values.general_notes)
    };

    const request =
      patientModal.mode === "create"
        ? supabase.from("patients").insert(payload)
        : supabase.from("patients").update(payload).eq("id", patientModal.patientId);

    const { error } = await request;
    setBusyLabel("");

    if (error) {
      setErrorMessage(error.message);
      return;
    }

    closePatientModal();
    await loadAppData();
  }

  async function handleDeletePatient(patientId) {
    if (!supabase || !patientId) {
      return;
    }

    const confirmed = window.confirm("刪除此病患後，所有 case / 回診 / 照片都會一起刪除，確定嗎？");
    if (!confirmed) {
      return;
    }

    try {
      setBusyLabel("刪除病患中");
      const patientCaseIds = records.cases
        .filter((entry) => entry.patient_id === patientId)
        .map((entry) => entry.id);
      const photos = records.visitPhotos.filter((photo) => patientCaseIds.includes(photo.case_id));
      await removeStorageObjects(photos);

      const { error } = await supabase.from("patients").delete().eq("id", patientId);
      if (error) {
        throw error;
      }

      await loadAppData();
    } catch (error) {
      setErrorMessage(error.message);
    } finally {
      setBusyLabel("");
    }
  }

  async function handleCaseSubmit(event) {
    event.preventDefault();
    if (!supabase || !session?.user) {
      return;
    }

    try {
      setBusyLabel(caseModal.mode === "create" ? "建立 case 中" : "更新 case 中");
      setErrorMessage("");

      const toothCodes = normalizeToothCodes(caseModal.values.tooth_codes);

      if (!toothCodes.length) {
        setBusyLabel("");
        setErrorMessage("請至少選擇一個牙位。");
        return;
      }

      const initialProcedureTypes = normalizeProcedureTypeSelection(
        caseModal.values.initial_procedure_types
      );

      if (caseModal.mode === "create" && !initialProcedureTypes.length) {
        setBusyLabel("");
        setErrorMessage("請選擇第一次治療內容。");
        return;
      }

      const payload = {
        owner_user_id: session.user.id,
        patient_id: caseModal.values.patient_id,
        tooth_code: toothCodes[0],
        tooth_codes: toothCodes,
        status: caseModal.values.status,
        template_key: caseModal.mode === "create" ? null : caseModal.values.template_key || null,
        title: normalizeText(caseModal.values.title),
        started_on: caseModal.values.started_on || null,
        target_restoration_on: caseModal.values.target_restoration_on || null,
        diagnosis_notes: normalizeText(caseModal.values.diagnosis_notes),
        internal_notes: normalizeText(caseModal.values.internal_notes)
      };

      if (caseModal.mode === "create") {
        const { data, error } = await supabase
          .from("cases")
          .insert(payload)
          .select("*")
          .single();

        if (error) {
          throw error;
        }

        const initialPlanSteps = initialProcedureTypes.map((procedureType, index) => ({
          owner_user_id: session.user.id,
          case_id: data.id,
          step_order: index + 1,
          title: PROCEDURE_LABELS[procedureType] || procedureType,
          procedure_type: procedureType,
          planned_date: caseModal.values.started_on || null,
          status: "pending",
          note: ""
        }));

        for (const initialPlanStep of initialPlanSteps) {
          const { error: planError } = await supabase.from("case_plan_steps").insert(initialPlanStep);
          if (planError) {
            await supabase.from("cases").delete().eq("id", data.id);
            throw planError;
          }
        }

        setSelectedPatientId(data.patient_id);
        setSelectedCaseId(data.id);
      } else {
        const { error } = await supabase
          .from("cases")
          .update(payload)
          .eq("id", caseModal.caseId);
        if (error) {
          throw error;
        }
      }

      closeCaseModal();
      await loadAppData();
    } catch (error) {
      setErrorMessage(error.message);
    } finally {
      setBusyLabel("");
    }
  }

  async function handleDeleteCase(caseId) {
    if (!supabase || !caseId) {
      return;
    }

    const confirmed = window.confirm("刪除此 case 後，所有計畫 / 回診 / 照片都會一起刪除，確定嗎？");
    if (!confirmed) {
      return;
    }

    try {
      setBusyLabel("刪除 case 中");
      await removeStorageObjects(records.visitPhotos.filter((photo) => photo.case_id === caseId));

      const { error } = await supabase.from("cases").delete().eq("id", caseId);
      if (error) {
        throw error;
      }

      await loadAppData();
    } catch (error) {
      setErrorMessage(error.message);
    } finally {
      setBusyLabel("");
    }
  }

  async function handlePlanSubmit(event) {
    event.preventDefault();
    if (!supabase || !session?.user) {
      return;
    }

    try {
      setBusyLabel(planModal.mode === "create" ? "新增計畫中" : "更新計畫中");
      setErrorMessage("");

      const existingStep =
        planModal.mode === "edit"
          ? records.planSteps.find((step) => step.id === planModal.stepId) || null
          : null;
      const currentCaseSteps = (planStepsByCaseId[planModal.values.case_id] || []).filter(
        (step) => step.id !== planModal.stepId
      );

      const payloadBase = {
        owner_user_id: session.user.id,
        case_id: planModal.values.case_id,
        title: PROCEDURE_LABELS[planModal.values.procedure_type] || planModal.values.procedure_type,
        procedure_type: planModal.values.procedure_type,
        planned_date: planModal.values.planned_date || null,
        status: planModal.values.status || "pending",
        note: normalizeText(planModal.values.note)
      };

      const payload =
        planModal.mode === "create"
          ? {
              ...payloadBase,
              step_order: getNextPlanStepOrder(currentCaseSteps)
            }
          : {
              ...payloadBase,
              step_order: existingStep?.step_order || getNextPlanStepOrder(currentCaseSteps)
            };

      const request =
        planModal.mode === "create"
          ? supabase.from("case_plan_steps").insert(payload).select().single()
          : supabase.from("case_plan_steps").update(payload).eq("id", planModal.stepId).select().single();

      const { data: savedStep, error } = await request;
      if (error) {
        throw error;
      }

      closePlanModal();
      await loadAppData();
    } catch (error) {
      setErrorMessage(error.message);
    } finally {
      setBusyLabel("");
    }
  }

  async function handleDeletePlanStep(stepId) {
    if (!supabase || !stepId) {
      return;
    }

    const confirmed = window.confirm("刪除此計畫步驟嗎？");
    if (!confirmed) {
      return;
    }

    try {
      setBusyLabel("刪除計畫中");
      const deletedStep = records.planSteps.find((step) => step.id === stepId);
      const { error } = await supabase.from("case_plan_steps").delete().eq("id", stepId);
      if (error) {
        throw error;
      }

      if (deletedStep?.case_id) {
        // Keep existing step_order values as a stable tiebreaker; timeline is sorted by planned_date.
      }

      await loadAppData();
    } catch (error) {
      setErrorMessage(error.message);
    } finally {
      setBusyLabel("");
    }
  }

  function pushNewPhotoDrafts(fileList) {
    if (!fileList?.length) {
      return;
    }

    const nextDrafts = Array.from(fileList || []).map((file) => ({
      local_id: createClientId(),
      file,
      caption: "",
      photo_label: "",
      taken_at: "",
      preview_url: URL.createObjectURL(file)
    }));

    setVisitModal((current) => ({
      ...current,
      values: {
        ...current.values,
        new_photos: current.values.new_photos.concat(nextDrafts)
      }
    }));
  }

  async function uploadVisitPhotos(visitId, caseId, patientId, drafts, onProgress) {
    if (!supabase || !session?.user || !drafts.length) {
      return { uploadedCount: 0, failedCount: 0 };
    }

    if (!patientId) {
      throw new Error("找不到病患資料，無法上傳照片。");
    }

    let settledCount = 0;
    let failedCount = 0;

    const results = await Promise.allSettled(
      drafts.map(async (draft, index) => {
        const extension = draft.file.name.split(".").pop() || "jpg";
        const safeName = slugifyFileName(
          `${createClientId()}-${draft.file.name.replace(/\.[^.]+$/, "")}.${extension}`
        );
        const storagePath = `${session.user.id}/${patientId}/${caseId}/${visitId}/${safeName}`;

        try {
          const uploadResult = await supabase.storage
            .from("case-photos")
            .upload(storagePath, draft.file, {
              contentType: draft.file.type,
              upsert: false
            });

          if (uploadResult.error) {
            throw uploadResult.error;
          }

          const { error } = await supabase.from("visit_photos").insert({
            owner_user_id: session.user.id,
            visit_id: visitId,
            case_id: caseId,
            storage_path: storagePath,
            file_name: draft.file.name,
            mime_type: draft.file.type,
            caption: normalizeText(draft.caption),
            photo_label: normalizeText(draft.photo_label),
            sort_order: index + 1
          });

          if (error) {
            await supabase.storage.from("case-photos").remove([storagePath]);
            throw error;
          }
        } finally {
          settledCount += 1;
          onProgress?.({
            settledCount,
            totalCount: drafts.length,
            failedCount
          });
        }
      }).map((task) =>
        task.catch((error) => {
          failedCount += 1;
          throw error;
        })
      )
    );

    const errors = results
      .filter((result) => result.status === "rejected")
      .map((result) => result.reason?.message || "照片同步失敗");

    if (errors.length) {
      throw new Error(errors.join("；"));
    }

    return {
      uploadedCount: drafts.length,
      failedCount: 0
    };
  }

  async function handleVisitSubmit(event) {
    event.preventDefault();
    if (!supabase || !session?.user) {
      return;
    }

    try {
      setBusyLabel(visitModal.mode === "create" ? "建立回診中" : "更新回診中");
      setErrorMessage("");
      setNoticeMessage("");

      const visitDraft = {
        ...visitModal.values,
        procedures: visitModal.values.procedures.map((procedure) => ({
          ...procedure,
          bone_graft_materials: [...(procedure.bone_graft_materials || [])],
          extra_data: procedure.extra_data || {}
        })),
        existing_photos: visitModal.values.existing_photos.map((photo) => ({ ...photo })),
        new_photos: visitModal.values.new_photos.map((photo) => ({ ...photo }))
      };

      const visitPayload = {
        owner_user_id: session.user.id,
        case_id: visitDraft.case_id,
        plan_step_id: visitDraft.plan_step_id || null,
        visited_on: visitDraft.visited_on,
        summary: normalizeText(visitDraft.summary),
        next_note: normalizeText(visitDraft.next_note)
      };
      const caseEntry = casesById[visitDraft.case_id];
      const patientId = caseEntry?.patient_id || selectedPatientId;
      const visitCaseToothCodes = getCaseToothCodes(caseEntry);

      let visitId = visitModal.visitId;

      if (visitModal.mode === "create") {
        const { data, error } = await supabase
          .from("visits")
          .insert(visitPayload)
          .select("*")
          .single();

        if (error) {
          throw error;
        }
        visitId = data.id;
      } else {
        const { error } = await supabase
          .from("visits")
          .update(visitPayload)
          .eq("id", visitId);
        if (error) {
          throw error;
        }
      }

      const { error: deleteProceduresError } = await supabase
        .from("visit_procedures")
        .delete()
        .eq("visit_id", visitId);
      if (deleteProceduresError) {
        throw deleteProceduresError;
      }

      const normalizedProcedures = visitDraft.procedures
        .filter((procedure) => procedure.procedure_type)
        .map((procedure, index) => {
          const toothImplants =
            isImplantProcedureType(procedure.procedure_type)
              ? deriveToothImplants(procedure, visitCaseToothCodes).map((item) => ({
                  tooth_code: item.tooth_code,
                  implant_brand: normalizeText(item.implant_brand),
                  implant_model: normalizeText(item.implant_model),
                  implant_diameter_mm: numberOrNull(item.implant_diameter_mm),
                  implant_length_mm: numberOrNull(item.implant_length_mm),
                  healing_used: Boolean(item.healing_used),
                  healing_size: normalizeHealingSize(item.healing_size)
                }))
              : [];

          const primaryToothImplant =
            toothImplants.find(
              (item) =>
                item.implant_brand ||
                item.implant_model ||
                item.implant_diameter_mm !== null ||
                item.implant_length_mm !== null ||
                item.healing_used ||
                item.healing_size
            ) || toothImplants[0];

          return {
            owner_user_id: session.user.id,
            visit_id: visitId,
            procedure_order: index + 1,
            procedure_type: procedure.procedure_type,
            procedure_note: normalizeText(procedure.procedure_note),
            implant_brand: normalizeText(
              primaryToothImplant?.implant_brand || procedure.implant_brand
            ),
            implant_model: normalizeText(
              primaryToothImplant?.implant_model || procedure.implant_model
            ),
            implant_diameter_mm: numberOrNull(
              primaryToothImplant?.implant_diameter_mm ?? procedure.implant_diameter_mm
            ),
            implant_length_mm: numberOrNull(
              primaryToothImplant?.implant_length_mm ?? procedure.implant_length_mm
            ),
            bone_graft_materials: procedure.bone_graft_materials || [],
            membrane_type: procedure.membrane_type || null,
            membrane_note: normalizeText(procedure.membrane_note),
            sinus_lift_approach: procedure.sinus_lift_approach || null,
            extra_data: {
              ...(procedure.extra_data || {}),
              healing_used:
                primaryToothImplant?.healing_used ?? Boolean(procedure.extra_data?.healing_used),
              healing_size:
                primaryToothImplant?.healing_size ||
                normalizeHealingSize(procedure.extra_data?.healing_size),
              ...(isImplantProcedureType(procedure.procedure_type)
                ? { tooth_implants: toothImplants }
                : {})
            }
          };
        });

      if (normalizedProcedures.length) {
        const { error } = await supabase
          .from("visit_procedures")
          .insert(normalizedProcedures);
        if (error) {
          throw error;
        }
      }

      closeVisitModal();
      await loadAppData();

      let backgroundError = "";
      let uploadedPhotoCount = 0;

      try {
        if (visitDraft.plan_step_id) {
          const { error } = await supabase
            .from("case_plan_steps")
            .update({
              status: "completed",
              completed_visit_id: visitId,
              completed_at: new Date().toISOString()
            })
            .eq("id", visitDraft.plan_step_id);
          if (error) {
            throw error;
          }
        }

        if (
          visitDraft.next_plan_enabled &&
          visitDraft.next_plan_procedure_type &&
          visitDraft.next_plan_planned_date
        ) {
          const caseSteps = (planStepsByCaseId[visitDraft.case_id] || []).filter(
            (step) => step.id !== visitDraft.plan_step_id
          );
          const pendingCaseSteps = caseSteps
            .filter((step) => step.status === "pending")
            .sort(comparePlanStepsByTimeline);
          const explicitNextStep = visitDraft.next_plan_step_id
            ? pendingCaseSteps.find((step) => step.id === visitDraft.next_plan_step_id) || null
            : null;
          const matchedPendingStep =
            pendingCaseSteps.find(
              (step) =>
                step.procedure_type === visitDraft.next_plan_procedure_type &&
                step.id !== explicitNextStep?.id
            ) || null;
          const targetNextStep = explicitNextStep || matchedPendingStep;
          const nextPlanPayloadBase = {
            owner_user_id: session.user.id,
            case_id: visitDraft.case_id,
            title:
              PROCEDURE_LABELS[visitDraft.next_plan_procedure_type] ||
              visitDraft.next_plan_procedure_type,
            procedure_type: visitDraft.next_plan_procedure_type,
            planned_date: visitDraft.next_plan_planned_date,
            status: "pending",
            note: normalizeText(visitDraft.next_plan_note)
          };

          const nextPlanRequest = targetNextStep
            ? supabase
                .from("case_plan_steps")
                .update({
                  ...nextPlanPayloadBase,
                  step_order: targetNextStep.step_order
                })
                .eq("id", targetNextStep.id)
                .select()
                .single()
            : supabase
                .from("case_plan_steps")
                .insert({
                  ...nextPlanPayloadBase,
                  step_order: getNextPlanStepOrder(caseSteps)
                })
                .select()
                .single();

          const { data: savedNextStep, error: nextPlanError } = await nextPlanRequest;
          if (nextPlanError) {
            throw nextPlanError;
          }
        }
      } catch (backgroundStepError) {
        backgroundError = backgroundStepError.message;
      }

      if (visitDraft.new_photos.length) {
        setBusyLabel(`同步照片中 0/${visitDraft.new_photos.length}`);
      }

      const photosToDelete = visitDraft.existing_photos.filter((photo) => photo.marked_for_delete);
      if (photosToDelete.length) {
        await removeStorageObjects(photosToDelete);
        const deletePhotoIds = photosToDelete.map((photo) => photo.id);
        const { error } = await supabase.from("visit_photos").delete().in("id", deletePhotoIds);
        if (error) {
          throw error;
        }
      }

      const photosToUpdate = visitDraft.existing_photos.filter((photo) => !photo.marked_for_delete);
      for (const [index, photo] of photosToUpdate.entries()) {
        const { error } = await supabase
          .from("visit_photos")
          .update({
            caption: normalizeText(photo.caption),
            photo_label: normalizeText(photo.photo_label),
            sort_order: index + 1
          })
          .eq("id", photo.id);
        if (error) {
          throw error;
        }
      }

      try {
        const uploadResult = await uploadVisitPhotos(
          visitId,
          visitDraft.case_id,
          patientId,
          visitDraft.new_photos,
          ({ settledCount, totalCount, failedCount }) => {
            const failureSuffix = failedCount ? `（${failedCount} 張失敗）` : "";
            setBusyLabel(`同步照片中 ${settledCount}/${totalCount}${failureSuffix}`);
          }
        );
        uploadedPhotoCount = uploadResult.uploadedCount;
      } catch (photoError) {
        backgroundError = backgroundError
          ? `${backgroundError}；照片同步失敗：${photoError.message}`
          : `照片同步失敗：${photoError.message}`;
      }

      await loadAppData();
      if (backgroundError) {
        setErrorMessage(`回診已儲存，但仍有部分同步未完成：${backgroundError}`);
      } else if (uploadedPhotoCount) {
        setNoticeMessage(`照片已同步完成，共 ${uploadedPhotoCount} 張。`);
      }
    } catch (error) {
      setErrorMessage(error.message);
    } finally {
      setBusyLabel("");
    }
  }

  async function handleDeleteVisit(visit) {
    if (!supabase || !visit?.id) {
      return;
    }

    const confirmed = window.confirm("刪除此回診紀錄嗎？");
    if (!confirmed) {
      return;
    }

    try {
      setBusyLabel("刪除回診中");
      const visitPhotos = records.visitPhotos.filter((photo) => photo.visit_id === visit.id);
      await removeStorageObjects(visitPhotos);

      if (visit.plan_step_id) {
        const { error: stepError } = await supabase
          .from("case_plan_steps")
          .update({
            status: "pending",
            completed_visit_id: null,
            completed_at: null
          })
          .eq("id", visit.plan_step_id);
        if (stepError) {
          throw stepError;
        }
      }

      const { error } = await supabase.from("visits").delete().eq("id", visit.id);
      if (error) {
        throw error;
      }

      await loadAppData();
    } catch (error) {
      setErrorMessage(error.message);
    } finally {
      setBusyLabel("");
    }
  }

  async function handleDeletePhoto(photo) {
    if (!supabase || !photo?.id) {
      return;
    }

    const confirmed = window.confirm("刪除此照片嗎？");
    if (!confirmed) {
      return;
    }

    try {
      setBusyLabel("刪除照片中");
      await removeStorageObjects([photo]);
      const { error } = await supabase.from("visit_photos").delete().eq("id", photo.id);
      if (error) {
        throw error;
      }
      await loadAppData();
    } catch (error) {
      setErrorMessage(error.message);
    } finally {
      setBusyLabel("");
    }
  }

  if (!isSupabaseConfigured) {
    return (
      <main className="setup-screen">
        <section className="setup-card">
          <div className="brand-block">
            <span className="brand-mark">IT</span>
            <div>
              <p className="eyebrow">Implant Tracker</p>
              <h1>Supabase 尚未設定</h1>
            </div>
          </div>
          <p>
            請先在專案根目錄建立 <code>.env</code>，並填入 <code>VITE_SUPABASE_URL</code> 與{" "}
            <code>VITE_SUPABASE_ANON_KEY</code>。
          </p>
          <p>
            SQL migration 已放在{" "}
            <code>supabase/migrations/202604160020_init_implant_case_manager.sql</code>。
          </p>
        </section>
      </main>
    );
  }

  if (!authReady) {
    return <div className="loading-screen">讀取登入狀態中...</div>;
  }

  if (!session) {
    return (
      <main className="auth-screen">
        <section className="auth-card">
          <div className="brand-block">
            <span className="brand-mark">IT</span>
            <div>
              <p className="eyebrow">Implant Tracker</p>
              <h1>植牙 Case 管理系統</h1>
            </div>
          </div>
          <p className="auth-copy">
            使用 Supabase Auth 的 email / password 登入。這版預設單人使用，但資料與 Storage
            都已經做好 owner-based 權限。
          </p>
          <form className="auth-form" onSubmit={handleSignIn}>
            <label className="field">
              <span>Email</span>
              <input
                type="email"
                value={loginForm.email}
                onChange={(event) =>
                  setLoginForm((current) => ({ ...current, email: event.target.value }))
                }
                placeholder="doctor@example.com"
                required
              />
            </label>
            <label className="field">
              <span>Password</span>
              <input
                type="password"
                value={loginForm.password}
                onChange={(event) =>
                  setLoginForm((current) => ({ ...current, password: event.target.value }))
                }
                placeholder="••••••••"
                required
              />
            </label>
            {authError ? <p className="error-text">{authError}</p> : null}
            <button className="primary-button" type="submit" disabled={Boolean(busyLabel)}>
              {busyLabel || "登入"}
            </button>
          </form>
        </section>
      </main>
    );
  }

  return (
    <div className="app-shell">
      <div className="topbar-shell">
        <header className={cx("topbar", isTopbarCondensed && "is-condensed")}>
          <div className="topbar__left">
            <div className="brand-block brand-block--compact">
              <span className="brand-mark">IT</span>
              <div>
                <p className="eyebrow">Implant Tracker</p>
                <h1>Case Board</h1>
              </div>
            </div>
            <nav className="nav-pills">
              {NAV_ITEMS.map((item) => (
                <button
                  key={item.key}
                  className={cx("nav-pill", activeView === item.key && "is-active")}
                  type="button"
                  onClick={() => setActiveView(item.key)}
                >
                  {item.label}
                </button>
              ))}
            </nav>
          </div>

          <div className="topbar__actions desktop-only">
            <button className="ghost-button" type="button" onClick={loadAppData}>
              重新整理
            </button>
            <div className="date-chip">{formatDate(todayIso())}</div>
            <button className="ghost-button" type="button" onClick={handleSignOut}>
              登出
            </button>
          </div>
          <button
            className="ghost-button mobile-topbar-only topbar__mobile-trigger"
            type="button"
            onClick={() => setMobileMenuOpen(true)}
          >
            更多
          </button>
        </header>
      </div>

      {errorMessage ? <div className="flash flash--error">{errorMessage}</div> : null}
      {noticeMessage || busyLabel ? (
        <div className="flash-stack flash-stack--floating">
          {noticeMessage ? <div className="flash flash--busy">{noticeMessage}</div> : null}
          {busyLabel ? <div className="flash flash--busy">{busyLabel}...</div> : null}
        </div>
      ) : null}
      {showNoDataHint ? (
        <div className="flash flash--info">
          {`目前登入帳號：${currentUserEmail || "未顯示"}。這個帳號目前沒有病患資料；如果你原本應該看得到資料，請確認是否登入正確帳號，或按一次「重新整理」。`}
        </div>
      ) : null}

      <main className="page">
        {activeView === "dashboard" ? (
          <section className="view-stack">
            <section className="stats-grid">
              <article className="stat-card">
                <span className="stat-value">{stats.totalCases}</span>
                <span className="stat-label">總 Cases</span>
              </article>
              <article className="stat-card">
                <span className="stat-value">{stats.activeCases}</span>
                <span className="stat-label">進行中</span>
              </article>
              <article className="stat-card">
                <span className="stat-value">{stats.totalPatients}</span>
                <span className="stat-label">病患數</span>
              </article>
            </section>

            <section className="dual-columns">
              <section className="panel">
                <div className="panel-heading">
                  <div>
                    <p className="eyebrow">Upcoming</p>
                    <h3>即將回診</h3>
                  </div>
                </div>
                {upcomingItems.length ? (
                  <div className="agenda-list">
                    {upcomingItems.map((item) => {
                      const chipDate = formatMonthDayYearChip(item.planned_date);

                      return (
                        <button
                          key={`${item.caseEntry.id}-${item.planned_date || "undated"}`}
                          className="agenda-item agenda-item--upcoming"
                          type="button"
                          onClick={() => {
                            setActiveView("patients");
                            setSelectedPatientId(item.patient.id);
                            setSelectedCaseId(item.caseEntry.id);
                          }}
                        >
                          <div className="calendar-chip calendar-chip--soft">
                            <span className="calendar-chip__year">{chipDate.year}</span>
                            <strong className="calendar-chip__value">{chipDate.monthDay}</strong>
                          </div>
                          <div className="agenda-item__body">
                            <div className="agenda-item__row">
                              <div className="agenda-item__person">
                                <strong>{item.patient.full_name}</strong>
                                {item.patient.clinic_name ? (
                                  <span className="muted-text">{item.patient.clinic_name}</span>
                                ) : null}
                              </div>
                              <div className="agenda-item__procedure">
                                <div className="chip-row">
                                  {item.steps.map((step) => (
                                    <span
                                      className={cx("pill", getProcedureToneClass(step.procedure_type))}
                                      key={step.id || `${item.caseEntry.id}-${step.procedure_type}`}
                                    >
                                      {getPlanStepLabel(step)}
                                    </span>
                                  ))}
                                </div>
                              </div>
                            </div>
                          </div>
                          <span className="tag agenda-item__tooth-tag">
                            <span className="agenda-item__tooth-label">牙位</span>
                            <strong className="agenda-item__tooth-value">
                              {formatCaseToothLabel(item.caseEntry)}
                            </strong>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <div className="empty-state">目前沒有待回診病患。</div>
                )}
              </section>

              <section className="panel">
                <div className="panel-heading panel-heading--danger">
                  <div>
                    <p className="eyebrow">Overdue</p>
                    <h3>逾期未回診 ({overdueItems.length})</h3>
                  </div>
                </div>
                {overdueItems.length ? (
                  <div className="agenda-list">
                    {overdueItems.map((item) => {
                      const monthDay = formatShortMonthDay(item.planned_date);
                      return (
                        <button
                          key={`${item.caseEntry.id}-${item.planned_date || "undated"}`}
                          className="agenda-item"
                          type="button"
                          onClick={() => {
                            setActiveView("patients");
                            setSelectedPatientId(item.patient.id);
                            setSelectedCaseId(item.caseEntry.id);
                          }}
                        >
                          <div className="calendar-chip">
                            <span>{monthDay.month}</span>
                            <strong>{monthDay.day}</strong>
                          </div>
                          <div className="agenda-item__body">
                            <div className="agenda-item__row">
                              <div className="agenda-item__person">
                                <strong>{item.patient.full_name}</strong>
                                {item.patient.clinic_name ? (
                                  <span className="muted-text">{item.patient.clinic_name}</span>
                                ) : null}
                              </div>
                              <div className="agenda-item__procedure">
                                <div className="chip-row">
                                  {item.steps.map((step) => (
                                    <span
                                      className={cx("pill", getProcedureToneClass(step.procedure_type))}
                                      key={step.id || `${item.caseEntry.id}-${step.procedure_type}`}
                                    >
                                      {getPlanStepLabel(step)}
                                    </span>
                                  ))}
                                </div>
                              </div>
                            </div>
                          </div>
                          <span className="tag agenda-item__tooth-tag">
                            <span className="agenda-item__tooth-label">牙位</span>
                            <strong className="agenda-item__tooth-value">
                              {formatCaseToothLabel(item.caseEntry)}
                            </strong>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <div className="empty-state">目前沒有逾期個案。</div>
                )}
              </section>
            </section>
          </section>
        ) : null}

        {activeView === "patients" ? (
          <section className="patients-layout">
            <aside className="panel sidebar">
              <div className="panel-heading">
                <div>
                  <p className="eyebrow">Patients</p>
                  <h3>病患名單</h3>
                </div>
                <button className="primary-button" type="button" onClick={() => openPatientModal("create")}>
                  新增病患
                </button>
              </div>

              <label className="field">
                <span>搜尋病患</span>
                <input
                  value={patientQuery}
                  onChange={(event) => setPatientQuery(event.target.value)}
                  placeholder="姓名 / 生日 / 注意事項"
                />
              </label>
              {renderPatientList()}
            </aside>

            <section className="view-stack">
              {selectedPatient ? (
                <>
                  <section className="panel">
                    <div className="panel-heading">
                      <div>
                        <p className="eyebrow">Patient Detail</p>
                        <h3>{selectedPatient.full_name}</h3>
                      </div>
                      <div className="inline-actions">
                        <button
                          className="secondary-button mobile-only"
                          type="button"
                          onClick={() => setPatientSheetOpen(true)}
                        >
                          切換病患
                        </button>
                        <button
                          className="secondary-button patient-detail-actions__desktop"
                          type="button"
                          onClick={() => openPatientModal("edit", selectedPatient)}
                        >
                          編輯病患
                        </button>
                        <button
                          className="danger-button patient-detail-actions__desktop"
                          type="button"
                          onClick={() => handleDeletePatient(selectedPatient.id)}
                        >
                          刪除病患
                        </button>
                        <button
                          className="ghost-button mobile-only"
                          type="button"
                          onClick={() => setPatientActionsOpen(true)}
                        >
                          管理病患
                        </button>
                      </div>
                    </div>

                    <div className="detail-grid">
                      <div className="detail-card">
                        <span className="detail-label">診所</span>
                        <strong>{selectedPatient.clinic_name || "未設定"}</strong>
                      </div>
                      <div className="detail-card">
                        <span className="detail-label">生日</span>
                        <strong>
                          {selectedPatient.birth_date
                            ? formatDate(selectedPatient.birth_date)
                            : "未設定"}
                        </strong>
                      </div>
                      <div className="detail-card">
                        <span className="detail-label">年齡</span>
                        <strong>
                          {selectedPatient.birth_date
                            ? `${calculateAge(selectedPatient.birth_date) ?? "-"} 歲`
                            : "未設定"}
                        </strong>
                      </div>
                    </div>

                    {selectedPatient.attention_alert ? (
                      <div className="alert-banner">
                        <strong>注意事項</strong>
                        <p>{selectedPatient.attention_alert}</p>
                      </div>
                    ) : null}

                    {selectedPatient.general_notes ? (
                      <div className="note-block">
                        <span className="detail-label">病患備註</span>
                        <p>{selectedPatient.general_notes}</p>
                      </div>
                    ) : null}
                  </section>

                  <section className="panel">
                    <div className="panel-heading">
                      <div>
                        <p className="eyebrow">Cases</p>
                        <h3>個案列表</h3>
                      </div>
                      <button
                        className="primary-button"
                        type="button"
                        onClick={() => openCaseModal("create", null, selectedPatient.id)}
                      >
                        新增 Case
                      </button>
                    </div>

                    <div className="case-grid">
                      {selectedPatientCases.map((entry) => {
                        const caseSteps = (planStepsByCaseId[entry.id] || []).slice().sort(comparePlanStepsByTimeline);
                        const nextStep = nextPendingPlanSummaryByCaseId[entry.id];
                        const completedProcedureTypes = completedProcedureTypesByCaseId[entry.id] || [];
                        const earliestKnownStep = caseSteps[0] || null;
                        const caseDisplayTitle =
                          entry.title ||
                          getPlanStepLabel(earliestKnownStep) ||
                          (completedProcedureTypes[0]
                            ? PROCEDURE_LABELS[completedProcedureTypes[0]]
                            : "") ||
                          "Implant Case";

                        return (
                          <button
                            key={entry.id}
                            className={cx("case-card", selectedCaseId === entry.id && "is-selected")}
                            type="button"
                            onClick={() => setSelectedCaseId(entry.id)}
                          >
                            <div className="case-card__header">
                              <div className="chip-row">
                                <span className="tag">#{caseDisplayNoById[entry.id]}</span>
                                <span className="tag case-card__tooth-tag">
                                  牙位 {formatCaseToothLabel(entry)}
                                </span>
                              </div>
                              <span className={cx("pill", getCaseStatusToneClass(entry.status))}>
                                {CASE_STATUS_LABELS[entry.status]}
                              </span>
                            </div>
                            <div className="case-card__title-row">
                              <strong>{caseDisplayTitle}</strong>
                            </div>
                            <div className="case-card__section">
                              <span className="case-card__section-label">已完成</span>
                              {completedProcedureTypes.length ? (
                                <div className="case-card__completed-row chip-row" aria-label="已完成治療內容">
                                  {completedProcedureTypes.map((procedureType) => (
                                    <span
                                      className={cx("pill", getProcedureToneClass(procedureType))}
                                      key={`${entry.id}-${procedureType}`}
                                    >
                                      {PROCEDURE_LABELS[procedureType]}
                                    </span>
                                  ))}
                                </div>
                              ) : (
                                <span className="muted-text">尚未完成主要治療</span>
                              )}
                            </div>
                            <div className="case-card__section case-card__section--next">
                              <span className="case-card__section-label">下一步</span>
                              {nextStep ? (
                                <div className="case-card__next-row">
                                  <span className="case-card__next-date">
                                    {nextStep.planned_date ? formatDate(nextStep.planned_date) : "未排日期"}
                                  </span>
                                  <div className="chip-row case-card__completed-row">
                                    {nextStep.steps.map((step) => (
                                      <span
                                        className={cx("pill", getProcedureToneClass(step.procedure_type))}
                                        key={step.id || `${entry.id}-${step.procedure_type}`}
                                      >
                                        {getPlanStepLabel(step)}
                                      </span>
                                    ))}
                                  </div>
                                </div>
                              ) : (
                                <span className="muted-text">尚未安排下次回診</span>
                              )}
                            </div>
                          </button>
                        );
                      })}
                      {!selectedPatientCases.length ? (
                        <div className="empty-state">這位病患尚未建立 case。</div>
                      ) : null}
                    </div>
                  </section>

                  {selectedCase ? (
                    <>
                      <section className="panel">
                        <div className="panel-heading">
                          <div>
                            <p className="eyebrow">Case Detail</p>
                            <h3>
                              #{caseDisplayNoById[selectedCase.id]} / {selectedCaseToothHeading}
                            </h3>
                          </div>
                          <div className="inline-actions">
                            <button
                              className="secondary-button"
                              type="button"
                              onClick={() => openCaseModal("edit", selectedCase)}
                            >
                              編輯 Case
                            </button>
                            <button
                              className="danger-button"
                              type="button"
                              onClick={() => handleDeleteCase(selectedCase.id)}
                            >
                              刪除 Case
                            </button>
                          </div>
                        </div>

                        <div className="detail-grid">
                          <div className="detail-card">
                            <span className="detail-label">開始日期</span>
                            <strong>{selectedCase.started_on ? formatDate(selectedCase.started_on) : "未設定"}</strong>
                          </div>
                          <div className="detail-card">
                            <span className="detail-label">結束日期</span>
                            <strong>{selectedCaseDeliveryDate ? formatDate(selectedCaseDeliveryDate) : "未完成"}</strong>
                          </div>
                        </div>

                        {selectedCase.diagnosis_notes ? (
                          <div className="note-block">
                            <span className="detail-label">初診備註</span>
                            <p>{selectedCase.diagnosis_notes}</p>
                          </div>
                        ) : null}

                        {selectedCase.internal_notes ? (
                          <div className="note-block">
                            <span className="detail-label">內部備註</span>
                            <p>{selectedCase.internal_notes}</p>
                          </div>
                        ) : null}

                        {selectedCaseImplantEntries.length ? (
                          <div className="implant-snapshot implant-snapshot--inline">
                            <span className="detail-label implant-snapshot__title">植體資訊</span>
                            <div className="implant-snapshot__stack">
                              {selectedCaseImplantEntries.map((implantEntry, index) => (
                                <div
                                  className="implant-snapshot__grid implant-snapshot__row"
                                  key={`${implantEntry.tooth_code || "implant"}-${index}`}
                                >
                                  <div>
                                    <span className="detail-label">牙位</span>
                                    <strong>{implantEntry.tooth_code || selectedCaseToothLabel}</strong>
                                  </div>
                                  <div>
                                    <span className="detail-label">廠牌</span>
                                    <strong>
                                      {implantEntry.implant_brand || "-"} {implantEntry.implant_model || ""}
                                    </strong>
                                  </div>
                                  <div>
                                    <span className="detail-label">直徑 / 長度</span>
                                    <strong>
                                      {implantEntry.implant_diameter_mm || "-"} /{" "}
                                      {implantEntry.implant_length_mm || "-"} mm
                                    </strong>
                                  </div>
                                  <div>
                                    <span className="detail-label">植入</span>
                                    <strong>
                                      {implantEntry.placed_on ? formatDate(implantEntry.placed_on) : "未設定"}
                                    </strong>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        ) : null}
                      </section>

                      <section className="dual-columns">
                        <section className="panel">
                          <div className="panel-heading">
                            <div>
                              <p className="eyebrow">Plan</p>
                              <h3>治療計劃</h3>
                            </div>
                            <button
                              className="secondary-button"
                              type="button"
                              onClick={() => openPlanModal("create")}
                            >
                              新增計畫
                            </button>
                          </div>

                          <div className="timeline-list">
                            {selectedCasePlanSteps.map((step) => (
                              <article key={step.id} className="visit-card timeline-item">
                                <div className="visit-card__header timeline-item__header">
                                  <div className="timeline-item__main">
                                    <div className="timeline-item__headline">
                                      <strong>{getPlanStepLabel(step)}</strong>
                                      <span className="timeline-item__date">
                                        {step.planned_date ? formatDate(step.planned_date) : "未排日期"}
                                      </span>
                                    </div>
                                    <div className="chip-row">
                                      <span
                                        className={cx(
                                          "pill",
                                          step.status === "completed" && "pill--green",
                                          step.status === "pending" &&
                                            step.planned_date &&
                                            daysFromToday(step.planned_date) < 0 &&
                                            "pill--danger"
                                        )}
                                      >
                                        {PLAN_STATUS_LABELS[step.status]}
                                      </span>
                                    </div>
                                  </div>
                                  <div className="inline-actions timeline-item__actions">
                                    {step.status === "pending" ? (
                                      <button
                                        className="primary-button"
                                        type="button"
                                        onClick={() => openVisitModal("create", selectedCase.id, null, step)}
                                      >
                                        完成此步驟
                                      </button>
                                    ) : null}
                                    <button
                                      className="ghost-button"
                                      type="button"
                                      onClick={() => openPlanModal("edit", step)}
                                    >
                                      編輯
                                    </button>
                                    <button
                                      className="danger-button danger-button--ghost"
                                      type="button"
                                      onClick={() => handleDeletePlanStep(step.id)}
                                    >
                                      刪除
                                    </button>
                                  </div>
                                </div>
                                {step.note ? <p className="muted-text">{step.note}</p> : null}
                              </article>
                            ))}
                            {!selectedCasePlanSteps.length ? (
                              <div className="empty-state">尚未建立計畫步驟。</div>
                            ) : null}
                          </div>
                        </section>

                        <section className="panel">
                          <div className="panel-heading">
                            <div>
                              <p className="eyebrow">Visits</p>
                              <h3>回診紀錄</h3>
                            </div>
                            <button
                              className="primary-button"
                              type="button"
                              onClick={() => openVisitModal("create")}
                            >
                              新增回診
                            </button>
                          </div>

                          <div className="visit-list">
                            {selectedCaseVisits.map((visit) => {
                              const procedures = proceduresByVisitId[visit.id] || [];
                              const photos = photosByVisitId[visit.id] || [];
                              return (
                                <article key={visit.id} className="visit-card">
                                  <div className="visit-card__header">
                                    <div>
                                      <strong>{formatDate(visit.visited_on)}</strong>
                                      <div className="chip-row">
                                        {procedures.map((procedure) => (
                                          <span
                                            className={cx(
                                              "pill",
                                              getProcedureToneClass(procedure.procedure_type)
                                            )}
                                            key={procedure.id}
                                          >
                                            {PROCEDURE_LABELS[procedure.procedure_type]}
                                          </span>
                                        ))}
                                      </div>
                                    </div>
                                    <div className="inline-actions">
                                      <button
                                        className="ghost-button"
                                        type="button"
                                        onClick={() => openVisitModal("edit", selectedCase.id, visit)}
                                      >
                                        編輯
                                      </button>
                                      <button
                                        className="danger-button danger-button--ghost"
                                        type="button"
                                        onClick={() => handleDeleteVisit(visit)}
                                      >
                                        刪除
                                      </button>
                                    </div>
                                  </div>
                                  {visit.summary ? <p>{visit.summary}</p> : null}
                                  {visit.next_note ? (
                                    <p className="muted-text">下次提醒：{visit.next_note}</p>
                                  ) : null}
                                  <div className="visit-card__footer">
                                    <span>{photos.length} 張照片</span>
                                    {visit.plan_step_id ? <span>來自計畫步驟</span> : null}
                                  </div>
                                </article>
                              );
                            })}
                            {!selectedCaseVisits.length ? (
                              <div className="empty-state">尚未建立回診紀錄。</div>
                            ) : null}
                          </div>
                        </section>
                      </section>

                      <section className="panel">
                          <div className="panel-heading">
                            <div>
                              <p className="eyebrow">Gallery</p>
                              <h3>這個 Case（{selectedCaseToothLabel}）的照片總覽</h3>
                            </div>
                          <div className="inline-actions">
                            <div className="compare-status">
                              <span>{`已選 ${selectedComparePhotos.length} 張照片`}</span>
                            </div>
                            <button
                              className="secondary-button"
                              type="button"
                              disabled={selectedComparePhotos.length < 2}
                              onClick={() =>
                                setCasePhotoCompare((current) => ({
                                  ...current,
                                  open: true
                                }))
                              }
                            >
                              查看比較
                            </button>
                          </div>
                        </div>
                        {selectedCasePhotoGroups.length ? (
                          <div className="visit-photo-groups">
                            {selectedCasePhotoGroups.map((group) => (
                              <section className="visit-photo-group" key={group.visit.id}>
                                <div className="visit-photo-group__header">
                                  <div>
                                    <strong>{formatDate(group.visit.visited_on)}</strong>
                                    <div className="chip-row">
                                      {group.procedures.map((procedure) => (
                                        <span
                                          className={cx(
                                            "pill",
                                            getProcedureToneClass(procedure.procedure_type)
                                          )}
                                          key={procedure.id}
                                        >
                                          {PROCEDURE_LABELS[procedure.procedure_type]}
                                        </span>
                                      ))}
                                    </div>
                                  </div>
                                  <div className="visit-photo-group__meta">
                                    <span>{group.photos.length} 張照片</span>
                                    {group.visit.summary ? (
                                      <span>{group.visit.summary}</span>
                                    ) : null}
                                  </div>
                                </div>
                                <div className="photo-grid">
                                  {group.photos.map((photo) => (
                                    <article
                                      className={cx(
                                        "photo-card",
                                        casePhotoCompare.selectedIds.includes(photo.id) &&
                                          "photo-card--selected"
                                      )}
                                      key={photo.id}
                                      role="button"
                                      tabIndex={0}
                                      aria-pressed={casePhotoCompare.selectedIds.includes(photo.id)}
                                      onClick={() => toggleCaseComparePhoto(photo.id)}
                                      onKeyDown={(event) => {
                                        if (event.key === "Enter" || event.key === " ") {
                                          event.preventDefault();
                                          toggleCaseComparePhoto(photo.id);
                                        }
                                      }}
                                    >
                                      {photo.signed_url ? (
                                        <div className="photo-preview-trigger">
                                          <img src={photo.signed_url} alt={photo.file_name} />
                                        </div>
                                      ) : (
                                        <div className="photo-placeholder">No preview</div>
                                      )}
                                      <div className="photo-card__body">
                                        <div className="photo-card__meta">
                                          <strong>
                                            {visitsById[photo.visit_id]?.visited_on
                                              ? formatDate(visitsById[photo.visit_id].visited_on)
                                              : "未指定日期"}
                                          </strong>
                                          <div className="chip-row">
                                            {(proceduresByVisitId[photo.visit_id] || []).map((procedure) => (
                                              <span
                                                className={cx(
                                                  "pill",
                                                  getProcedureToneClass(procedure.procedure_type)
                                                )}
                                                key={procedure.id}
                                              >
                                                {PROCEDURE_LABELS[procedure.procedure_type]}
                                              </span>
                                            ))}
                                          </div>
                                        </div>
                                        <div className="photo-card__actions">
                                          <span
                                            className={cx(
                                              "photo-selection-chip",
                                              casePhotoCompare.selectedIds.includes(photo.id) &&
                                                "photo-selection-chip--selected"
                                            )}
                                          >
                                            {casePhotoCompare.selectedIds.includes(photo.id)
                                              ? "已選取比較"
                                              : "點卡片選取"}
                                          </span>
                                          <button
                                            className="photo-action-button"
                                            type="button"
                                            onClick={(event) => {
                                              event.stopPropagation();
                                              setPhotoPreview({
                                                open: true,
                                                photoId: photo.id
                                              });
                                            }}
                                          >
                                            查看大圖
                                          </button>
                                          <button
                                            className="photo-action-button photo-action-button--delete"
                                            type="button"
                                            onClick={(event) => {
                                              event.stopPropagation();
                                              handleDeletePhoto(photo);
                                            }}
                                          >
                                            刪除
                                          </button>
                                        </div>
                                      </div>
                                    </article>
                                  ))}
                                </div>
                              </section>
                            ))}
                          </div>
                        ) : (
                          <div className="empty-state">這個 case 還沒有照片。</div>
                        )}
                      </section>
                    </>
                  ) : (
                    <section className="panel empty-state">請先選一個 case。</section>
                  )}
                </>
              ) : (
                <section className="panel empty-state">請先建立病患。</section>
              )}
            </section>
          </section>
        ) : null}

        {activeView === "search" ? (
          <section className="view-stack">
            <section className="panel">
              <div className="panel-heading">
                <div>
                  <p className="eyebrow">Search</p>
                  <h3>病患姓名或治療內容搜尋</h3>
                </div>
              </div>
              <div className="toolbar-grid">
                <label className="field field--full">
                  <span>關鍵字</span>
                  <input
                    value={searchQuery}
                    onChange={(event) => setSearchQuery(event.target.value)}
                    placeholder="病患姓名 / 牙位 / case 編號 / 備註"
                  />
                </label>
                <div className="field field--full mobile-only">
                  <span>進階篩選</span>
                  <button
                    className="ghost-button search-filter-toggle"
                    type="button"
                    onClick={() => setSearchFiltersOpen((current) => !current)}
                  >
                    {searchFiltersOpen ? "收起篩選" : "展開篩選"}
                  </button>
                </div>
                <div
                  className={cx(
                    "field field--full search-filters-panel",
                    !searchFiltersOpen && "search-filters-panel--collapsed-mobile"
                  )}
                >
                  <span>治療內容篩選</span>
                  <PillSelect
                    value={procedureFilter}
                    options={procedureFilterOptions}
                    onChange={setProcedureFilter}
                    getToneClass={getProcedureToneClass}
                  />
                </div>
              </div>

              <div className="search-results">
                {searchResults.map((entry) => {
                  const patient = patientsById[entry.patient_id];
                  const nextStep = nextPendingPlanSummaryByCaseId[entry.id];
                  const completedProcedureTypes = completedProcedureTypesByCaseId[entry.id] || [];

                  return (
                    <button
                      className="search-card"
                      key={entry.id}
                      type="button"
                      onClick={() => {
                        setSelectedPatientId(entry.patient_id);
                        setSelectedCaseId(entry.id);
                        setActiveView("patients");
                      }}
                    >
                      <div className="search-card__header">
                        <div className="search-card__identity">
                          <strong>{patient?.full_name || "Unknown patient"}</strong>
                          {patient?.clinic_name ? (
                            <span className="muted-text">{patient.clinic_name}</span>
                          ) : null}
                        </div>
                        <div className="chip-row search-card__chips">
                          <span className="tag">#{caseDisplayNoById[entry.id]}</span>
                          <span className="tag">牙位 {formatCaseToothLabel(entry)}</span>
                        </div>
                      </div>
                      <div className="search-card__meta">
                        <span>{CASE_STATUS_LABELS[entry.status]}</span>
                        {nextStep ? (
                          <span>
                            下次 {nextStep.planned_date ? formatDate(nextStep.planned_date) : "未排日期"} /{" "}
                            {nextStep.steps.map((step) => getPlanStepLabel(step)).join(" / ")}
                          </span>
                        ) : (
                          <span>尚未安排下次回診</span>
                        )}
                      </div>
                      <div className="search-card__section">
                        <span className="case-card__section-label">已完成</span>
                        {completedProcedureTypes.length ? (
                          <div className="chip-row search-card__procedure-row">
                            {completedProcedureTypes.map((procedureType) => (
                              <span
                                className={cx("pill", getProcedureToneClass(procedureType))}
                                key={`${entry.id}-${procedureType}`}
                              >
                                {PROCEDURE_LABELS[procedureType]}
                              </span>
                            ))}
                          </div>
                        ) : (
                          <span className="muted-text">尚未完成主要治療</span>
                        )}
                      </div>
                    </button>
                  );
                })}

                {!searchResults.length ? (
                  <div className="empty-state">找不到符合條件的 case。</div>
                ) : null}
              </div>
            </section>
          </section>
        ) : null}

        {activeView === "analytics" ? (
          <section className="view-stack">
            <section className="stats-grid">
              <article className="stat-card">
                <span className="stat-value">{analyticsStats.totalClinics}</span>
                <span className="stat-label">診所數</span>
              </article>
              <article className="stat-card">
                <span className="stat-value">{stats.totalCases}</span>
                <span className="stat-label">總 Cases</span>
              </article>
              <article className="stat-card">
                <span className="stat-value">{analyticsStats.totalUpcoming}</span>
                <span className="stat-label">即將回診</span>
              </article>
            </section>

            <section className="panel">
              <div className="panel-heading">
                <div>
                  <p className="eyebrow">Analytics</p>
                  <h3>各診所 Case 統計</h3>
                </div>
              </div>

              {clinicStats.length ? (
                <div className="analytics-clinic-grid">
                  {clinicStats.map((clinic) => (
                    <article className="analytics-card" key={clinic.clinicName}>
                      <div className="analytics-card__header">
                        <strong>{clinic.clinicName}</strong>
                        <span className="tag">{clinic.caseCount} cases</span>
                      </div>
                      <div className="analytics-card__hero">
                        <span className="analytics-card__value">{clinic.caseCount}</span>
                        <span className="analytics-card__label">Case 數量</span>
                      </div>
                      <div className="analytics-card__meta">
                        <span>病患 {clinic.patientCount}</span>
                        <span>進行中 {clinic.activeCaseCount}</span>
                        <span>即將回診 {clinic.upcomingCount}</span>
                        <span>逾期 {clinic.overdueCount}</span>
                      </div>
                    </article>
                  ))}
                </div>
              ) : (
                <div className="empty-state">目前沒有可統計的診所資料。</div>
              )}
            </section>

            <section className="dual-columns">
              <section className="panel">
                <div className="panel-heading">
                  <div>
                    <p className="eyebrow">Breakdown</p>
                    <h3>各診所明細</h3>
                  </div>
                </div>
                {clinicStats.length ? (
                  <div className="analytics-table">
                    {clinicStats.map((clinic) => (
                      <div className="analytics-table__row" key={clinic.clinicName}>
                        <strong>{clinic.clinicName}</strong>
                        <span>{clinic.patientCount} 位病患</span>
                        <span>{clinic.caseCount} 個 case</span>
                        <span>{clinic.activeCaseCount} 進行中</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="empty-state">尚無診所明細。</div>
                )}
              </section>

              <section className="panel">
                <div className="panel-heading">
                  <div>
                    <p className="eyebrow">Procedures</p>
                    <h3>治療內容累計</h3>
                  </div>
                </div>
                {procedureStats.length ? (
                  <div className="analytics-chip-grid">
                    {procedureStats.map((item) => (
                      <div className="analytics-chip-card" key={item.procedureType}>
                        <span className={cx("pill", getProcedureToneClass(item.procedureType))}>
                          {item.label}
                        </span>
                        <strong>{item.count}</strong>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="empty-state">尚無治療內容紀錄可統計。</div>
                )}
              </section>
            </section>
          </section>
        ) : null}

      </main>

      <Modal
        open={patientModal.open}
        title={patientModal.mode === "create" ? "新增病患" : "編輯病患"}
        subtitle="病患的注意事項會做成全域警示欄位。"
        onClose={closePatientModal}
      >
        <form className="form-grid" onSubmit={handlePatientSubmit}>
          <label className="field">
            <span>姓名</span>
            <input
              required
              value={patientModal.values.full_name}
              onChange={(event) =>
                setPatientModal((current) => ({
                  ...current,
                  values: { ...current.values, full_name: event.target.value }
                }))
              }
            />
          </label>
          <label className="field">
            <span>生日</span>
            <DateInput
              value={patientModal.values.birth_date}
              onChange={(nextValue) =>
                setPatientModal((current) => ({
                  ...current,
                  values: { ...current.values, birth_date: nextValue }
                }))
              }
            />
            {patientModal.values.birth_date ? (
              <p className="muted-text">
                自動計算年齡：{calculateAge(patientModal.values.birth_date) ?? "-"} 歲
              </p>
            ) : null}
          </label>
          <div className="field field--full">
            <span>診所</span>
            <div className="clinic-builder">
              <PillSelect
                value={patientModal.values.clinic_name}
                options={clinicSelectionOptions}
                onChange={(nextValue) =>
                  setPatientModal((current) => ({
                    ...current,
                    values: { ...current.values, clinic_name: nextValue }
                  }))
                }
                onDeleteOption={handleDeleteClinic}
                isOptionDeletable={(optionValue) =>
                  Boolean(optionValue) && !clinicCatalogFallback
                }
              />
              <div className="clinic-builder__row">
                <input
                  value={patientModal.clinicDraft}
                  onChange={(event) =>
                    setPatientModal((current) => ({
                      ...current,
                      clinicDraft: event.target.value
                    }))
                  }
                  placeholder="新增診所名稱"
                />
                <button className="secondary-button" type="button" onClick={handleCreateClinic}>
                  新增診所
                </button>
              </div>
            </div>
          </div>
          <label className="field field--full">
            <span>注意事項</span>
            <textarea
              rows="3"
              value={patientModal.values.attention_alert}
              onChange={(event) =>
                setPatientModal((current) => ({
                  ...current,
                  values: { ...current.values, attention_alert: event.target.value }
                }))
              }
              placeholder="例如：高血壓、抗凝血藥物、藥物過敏..."
            />
          </label>
          <label className="field field--full">
            <span>一般備註</span>
            <textarea
              rows="4"
              value={patientModal.values.general_notes}
              onChange={(event) =>
                setPatientModal((current) => ({
                  ...current,
                  values: { ...current.values, general_notes: event.target.value }
                }))
              }
            />
          </label>
          <div className="modal-actions">
            <button className="secondary-button" type="button" onClick={closePatientModal}>
              取消
            </button>
            <button className="primary-button" type="submit">
              儲存病患
            </button>
          </div>
        </form>
      </Modal>

      {activeView === "patients" && patientSheetOpen ? (
        <div
          className="mobile-sheet-backdrop"
          onClick={() => setPatientSheetOpen(false)}
          role="presentation"
        >
          <section
            className="mobile-sheet"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mobile-sheet__grabber" />
            <div className="mobile-sheet__header">
              <div>
                <p className="eyebrow">Patients</p>
                <h3>切換病患</h3>
              </div>
              <div className="inline-actions">
                <button
                  className="primary-button"
                  type="button"
                  onClick={() => {
                    setPatientSheetOpen(false);
                    openPatientModal("create");
                  }}
                >
                  新增病患
                </button>
                <button
                  className="ghost-button"
                  type="button"
                  onClick={() => setPatientSheetOpen(false)}
                >
                  關閉
                </button>
              </div>
            </div>
            <label className="field mobile-sheet__search">
              <span>搜尋病患</span>
              <input
                value={patientQuery}
                onChange={(event) => setPatientQuery(event.target.value)}
                placeholder="姓名 / 生日 / 注意事項"
              />
            </label>
            {renderPatientList(() => setPatientSheetOpen(false))}
          </section>
        </div>
      ) : null}

      {activeView === "patients" && selectedPatient && patientActionsOpen ? (
        <div
          className="mobile-sheet-backdrop"
          onClick={() => setPatientActionsOpen(false)}
          role="presentation"
        >
          <section className="mobile-sheet mobile-sheet--compact" onClick={(event) => event.stopPropagation()}>
            <div className="mobile-sheet__grabber" />
            <div className="mobile-sheet__header">
              <div>
                <p className="eyebrow">Patient</p>
                <h3>管理病患</h3>
              </div>
              <button
                className="ghost-button"
                type="button"
                onClick={() => setPatientActionsOpen(false)}
              >
                關閉
              </button>
            </div>
            <div className="mobile-menu-list">
              <button
                className="secondary-button"
                type="button"
                onClick={() => {
                  setPatientActionsOpen(false);
                  openPatientModal("edit", selectedPatient);
                }}
              >
                編輯病患
              </button>
              <button
                className="danger-button"
                type="button"
                onClick={() => {
                  setPatientActionsOpen(false);
                  handleDeletePatient(selectedPatient.id);
                }}
              >
                刪除病患
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {mobileMenuOpen ? (
        <div
          className="mobile-sheet-backdrop"
          onClick={() => setMobileMenuOpen(false)}
          role="presentation"
        >
          <section className="mobile-sheet mobile-sheet--compact" onClick={(event) => event.stopPropagation()}>
            <div className="mobile-sheet__grabber" />
            <div className="mobile-sheet__header">
              <div>
                <p className="eyebrow">Menu</p>
                <h3>更多操作</h3>
              </div>
              <button
                className="ghost-button"
                type="button"
                onClick={() => setMobileMenuOpen(false)}
              >
                關閉
              </button>
            </div>
            <div className="mobile-menu-list">
              <button
                className="ghost-button"
                type="button"
                onClick={() => {
                  setMobileMenuOpen(false);
                  loadAppData();
                }}
              >
                重新整理
              </button>
              <div className="date-chip mobile-menu-date">{formatDate(todayIso())}</div>
              <button
                className="ghost-button"
                type="button"
                onClick={() => {
                  setMobileMenuOpen(false);
                  handleSignOut();
                }}
              >
                登出
              </button>
            </div>
          </section>
        </div>
      ) : null}

      <Modal
        open={caseModal.open}
        title={caseModal.mode === "create" ? "新增 Case" : "編輯 Case"}
        subtitle={
          caseModal.mode === "create"
            ? "先選牙位，再設定第一次治療日期與內容。"
            : "編輯 case 基本資料與牙位。"
        }
        onClose={closeCaseModal}
        width="xwide"
      >
        <form className="form-grid" onSubmit={handleCaseSubmit}>
          {caseModal.mode === "create" ? (
            <>
              <div className="field field--full">
                <span>選擇牙位（可複選，灰色 = 已有 Case）</span>
                <ToothPicker
                  value={caseModal.values.tooth_codes}
                  multiple
                  occupiedCodes={selectedPatientCaseToothCodes}
                  onChange={(codes) =>
                    setCaseModal((current) => ({
                      ...current,
                      values: { ...current.values, tooth_codes: codes }
                    }))
                  }
                />
                <span className="muted-text">
                  已選牙位：{formatCaseToothLabel(caseModal.values.tooth_codes)}
                </span>
              </div>

              <div className="field field--full">
                <span>第一次治療內容（可複選）</span>
                <PillSelect
                  value={caseModal.values.initial_procedure_types}
                  options={PROCEDURE_OPTIONS}
                  onChange={(nextValue) =>
                    setCaseModal((current) => ({
                      ...current,
                      values: {
                        ...current.values,
                        initial_procedure_types: normalizeProcedureTypeSelection(nextValue)
                      }
                    }))
                  }
                  getToneClass={getProcedureToneClass}
                  multiple
                />
              </div>

              <label className="field">
                <span>開始日期</span>
                <DateInput
                  value={caseModal.values.started_on}
                  shortcuts={todayShortcuts}
                  onChange={(nextValue) =>
                    setCaseModal((current) => ({
                      ...current,
                      values: { ...current.values, started_on: nextValue }
                    }))
                  }
                />
              </label>

              <label className="field field--full">
                <span>備註</span>
                <textarea
                  rows="4"
                  value={caseModal.values.diagnosis_notes}
                  onChange={(event) =>
                    setCaseModal((current) => ({
                      ...current,
                      values: { ...current.values, diagnosis_notes: event.target.value }
                    }))
                  }
                  placeholder="初始狀況描述..."
                />
              </label>
            </>
          ) : (
            <>
              <div className="field">
                <span>病患</span>
                <div className="readonly-field">
                  {patientsById[caseModal.values.patient_id]?.full_name || "未指定病患"}
                </div>
              </div>

              <label className="field">
                <span>Case 標題</span>
                <input
                  value={caseModal.values.title}
                  onChange={(event) =>
                    setCaseModal((current) => ({
                      ...current,
                      values: { ...current.values, title: event.target.value }
                    }))
                  }
                  placeholder="例如：#36 implant rehab"
                />
              </label>

              <div className="field field--full">
                <span>Status</span>
                <PillSelect
                  value={caseModal.values.status}
                  options={CASE_STATUS_OPTIONS}
                  onChange={(nextValue) =>
                    setCaseModal((current) => ({
                      ...current,
                      values: { ...current.values, status: nextValue }
                    }))
                  }
                  getToneClass={getCaseStatusToneClass}
                />
              </div>

              <label className="field">
                <span>開始日期</span>
                <DateInput
                  value={caseModal.values.started_on}
                  shortcuts={todayShortcuts}
                  onChange={(nextValue) =>
                    setCaseModal((current) => ({
                      ...current,
                      values: { ...current.values, started_on: nextValue }
                    }))
                  }
                />
              </label>

              <div className="field field--full">
                <span>牙位</span>
                <ToothPicker
                  value={caseModal.values.tooth_codes}
                  multiple
                  occupiedCodes={selectedPatientCaseToothCodes}
                  allowOccupiedValue
                  onChange={(codes) =>
                    setCaseModal((current) => ({
                      ...current,
                      values: { ...current.values, tooth_codes: codes }
                    }))
                  }
                />
                <span className="muted-text">
                  已選牙位：{formatCaseToothLabel(caseModal.values.tooth_codes)}
                </span>
              </div>

              <label className="field field--full">
                <span>初診備註</span>
                <textarea
                  rows="3"
                  value={caseModal.values.diagnosis_notes}
                  onChange={(event) =>
                    setCaseModal((current) => ({
                      ...current,
                      values: { ...current.values, diagnosis_notes: event.target.value }
                    }))
                  }
                />
              </label>

              <label className="field field--full">
                <span>內部備註</span>
                <textarea
                  rows="3"
                  value={caseModal.values.internal_notes}
                  onChange={(event) =>
                    setCaseModal((current) => ({
                      ...current,
                      values: { ...current.values, internal_notes: event.target.value }
                    }))
                  }
                />
              </label>
            </>
          )}

          <div className="modal-actions">
            <button className="secondary-button" type="button" onClick={closeCaseModal}>
              取消
            </button>
            <button
              className="primary-button"
              type="submit"
              disabled={
                Boolean(busyLabel) ||
                !caseModal.values.tooth_codes?.length ||
                !caseModal.values.patient_id ||
                (caseModal.mode === "create" && !caseModal.values.initial_procedure_types?.length)
              }
            >
              儲存 Case
            </button>
          </div>
        </form>
      </Modal>

      <Modal
        open={planModal.open}
        title={planModal.mode === "create" ? "新增治療計劃步驟" : "編輯治療計劃步驟"}
        subtitle="可手動新增或調整治療計劃。"
        onClose={closePlanModal}
      >
        <form className="form-grid" onSubmit={handlePlanSubmit}>
          <div className="field field--full">
            <span>治療內容</span>
            <PillSelect
              value={planModal.values.procedure_type}
              options={PROCEDURE_OPTIONS}
              onChange={(nextValue) =>
                setPlanModal((current) => ({
                  ...current,
                  values: {
                    ...current.values,
                    procedure_type: nextValue,
                    title: PROCEDURE_LABELS[nextValue] || nextValue
                  }
                }))
              }
              getToneClass={getProcedureToneClass}
            />
          </div>
          <label className="field">
            <span>預計日期</span>
            <DateInput
              value={planModal.values.planned_date}
              shortcuts={followUpShortcuts}
              onChange={(nextValue) =>
                setPlanModal((current) => ({
                  ...current,
                  values: { ...current.values, planned_date: nextValue }
                }))
              }
            />
          </label>
          <label className="field field--full">
            <span>備註</span>
            <textarea
              rows="3"
              value={planModal.values.note}
              onChange={(event) =>
                setPlanModal((current) => ({
                  ...current,
                  values: { ...current.values, note: event.target.value }
                }))
              }
            />
          </label>
          <div className="modal-actions">
            <button className="secondary-button" type="button" onClick={closePlanModal}>
              取消
            </button>
            <button className="primary-button" type="submit">
              儲存計畫
            </button>
          </div>
        </form>
      </Modal>

      <Modal
        open={visitModal.open}
        title={visitModal.mode === "create" ? "新增回診紀錄" : "編輯回診紀錄"}
        subtitle="可一次紀錄多個治療內容、植體細節、骨粉 / 再生膜與照片。"
        onClose={closeVisitModal}
        width="xwide"
      >
        <form className="form-grid" onSubmit={handleVisitSubmit}>
          <label className="field">
            <span>回診日期</span>
            <DateInput
              value={visitModal.values.visited_on}
              shortcuts={todayShortcuts}
              required
              onChange={(nextValue) =>
                setVisitModal((current) => ({
                  ...current,
                  values: { ...current.values, visited_on: nextValue }
                }))
              }
            />
          </label>
          <div className="field field--full">
            <span>關聯計畫步驟</span>
            <div className="plan-step-selector">
              <button
                className={cx(
                  "plan-step-option plan-step-option--none",
                  !visitModal.values.plan_step_id && "is-active"
                )}
                type="button"
                onClick={() =>
                  setVisitModal((current) => ({
                    ...current,
                    values: { ...current.values, plan_step_id: "" }
                  }))
                }
              >
                <strong>不關聯計畫</strong>
                <span>獨立新增回診紀錄</span>
              </button>

              {(planStepsByCaseId[visitModal.values.case_id] || []).map((step) => (
                <button
                  key={step.id}
                  className={cx(
                    "plan-step-option",
                    visitModal.values.plan_step_id === step.id && "is-active"
                  )}
                  type="button"
                  onClick={() =>
                    setVisitModal((current) => ({
                      ...current,
                      values: { ...current.values, plan_step_id: step.id }
                    }))
                  }
                >
                  <div className="plan-step-option__header">
                    <span className={cx("pill", getProcedureToneClass(step.procedure_type))}>
                      {getPlanStepLabel(step)}
                    </span>
                    <span
                      className={cx(
                        "pill",
                        step.status === "completed" && "pill--green",
                        step.status === "pending" &&
                          step.planned_date &&
                          daysFromToday(step.planned_date) < 0 &&
                          "pill--danger"
                      )}
                    >
                      {PLAN_STATUS_LABELS[step.status]}
                    </span>
                  </div>
                  <div className="plan-step-option__meta">
                    <span>{step.planned_date ? formatDate(step.planned_date) : "未排日期"}</span>
                  </div>
                </button>
              ))}
            </div>
          </div>
          <label className="field field--full">
            <span>本次摘要</span>
            <textarea
              rows="3"
              value={visitModal.values.summary}
              onChange={(event) =>
                setVisitModal((current) => ({
                  ...current,
                  values: { ...current.values, summary: event.target.value }
                }))
              }
              placeholder="今天做了什麼、術中狀況、交代事項..."
            />
          </label>
          <label className="field field--full">
            <span>病患交代 / 追蹤提醒</span>
            <textarea
              rows="2"
              value={visitModal.values.next_note}
              onChange={(event) =>
                setVisitModal((current) => ({
                  ...current,
                  values: { ...current.values, next_note: event.target.value }
                }))
              }
            />
          </label>

          <div className="field field--full">
            <div className="section-title-row">
              <span>治療內容紀錄</span>
              <button
                className="secondary-button"
                type="button"
                onClick={() =>
                  setVisitModal((current) => ({
                    ...current,
                    values: {
                      ...current.values,
                      procedures: current.values.procedures.concat(createEmptyProcedure())
                    }
                  }))
                }
              >
                新增治療內容
              </button>
            </div>

            <div className="procedure-stack">
              {visitModal.values.procedures.map((procedure, index) => {
                const procedureCaseToothCodes = getCaseToothCodes(
                  casesById[visitModal.values.case_id]
                );
                const toothImplants = deriveToothImplants(procedure, procedureCaseToothCodes);
                const updateToothImplant = (toothCode, patch) =>
                  updateVisitProcedureAt(index, (item) =>
                    syncProcedureToothImplants(
                      item,
                      deriveToothImplants(item, procedureCaseToothCodes).map((entry) =>
                        entry.tooth_code === toothCode ? { ...entry, ...patch } : entry
                      )
                    )
                  );

                return (
                  <article className="procedure-card" key={procedure.id || index}>
                  <div className="section-title-row">
                    <strong>治療內容 #{index + 1}</strong>
                    {visitModal.values.procedures.length > 1 ? (
                      <button
                        className="danger-button danger-button--ghost"
                        type="button"
                        onClick={() =>
                          setVisitModal((current) => ({
                            ...current,
                            values: {
                              ...current.values,
                              procedures: current.values.procedures.filter(
                                (_entry, innerIndex) => innerIndex !== index
                              )
                            }
                          }))
                        }
                      >
                        刪除治療內容
                      </button>
                    ) : null}
                  </div>

                  <div className="toolbar-grid">
                    <div className="field field--full">
                      <span>治療內容</span>
                      <PillSelect
                        value={procedure.procedure_type}
                        options={PROCEDURE_OPTIONS}
                        onChange={(nextValue) =>
                          setVisitModal((current) => ({
                            ...current,
                            values: {
                              ...current.values,
                              procedures: current.values.procedures.map((item, innerIndex) =>
                                innerIndex === index
                                  ? {
                                      ...item,
                                      procedure_type: nextValue
                                    }
                                  : item
                              )
                            }
                          }))
                        }
                        getToneClass={getProcedureToneClass}
                      />
                    </div>

                    <label className="field">
                      <span>備註</span>
                      <input
                        value={procedure.procedure_note || ""}
                        onChange={(event) =>
                          setVisitModal((current) => ({
                            ...current,
                            values: {
                              ...current.values,
                              procedures: current.values.procedures.map((item, innerIndex) =>
                                innerIndex === index
                                  ? {
                                      ...item,
                                      procedure_note: event.target.value
                                    }
                                  : item
                              )
                            }
                          }))
                        }
                        placeholder="治療內容補充說明"
                      />
                    </label>
                  </div>

                  {isImplantProcedureType(procedure.procedure_type) ? (
                    <div className="implant-configurator">
                      {toothImplants.length ? (
                        <div className="implant-tooth-grid field--full">
                          {toothImplants.map((toothImplant) => {
                            const toothModelOptions =
                              IMPLANT_MODEL_OPTIONS_BY_BRAND[toothImplant.implant_brand || ""] || [];
                            const toothHealingSelection = toothImplant.healing_used ? "yes" : "no";

                            return (
                              <section className="implant-tooth-card" key={toothImplant.tooth_code}>
                                <div className="implant-tooth-card__header">
                                  <strong>牙位 {toothImplant.tooth_code}</strong>
                                </div>

                                <div className="field field--full">
                                  <span>植體廠牌</span>
                                  <PillSelect
                                    value={toothImplant.implant_brand || ""}
                                    options={IMPLANT_BRAND_OPTIONS}
                                    onChange={(nextValue) => {
                                      const nextModelOptions =
                                        IMPLANT_MODEL_OPTIONS_BY_BRAND[nextValue] || [];
                                      const nextModel =
                                        nextModelOptions.find(
                                          (option) => option.value === toothImplant.implant_model
                                        )?.value || "";

                                      updateToothImplant(toothImplant.tooth_code, {
                                        implant_brand: nextValue,
                                        implant_model: nextModel
                                      });
                                    }}
                                    getToneClass={getImplantBrandToneClass}
                                  />
                                </div>

                                <div className="field field--full">
                                  <span>植體型號</span>
                                  {toothModelOptions.length ? (
                                    <PillSelect
                                      value={toothImplant.implant_model || ""}
                                      options={toothModelOptions}
                                      onChange={(nextValue) =>
                                        updateToothImplant(toothImplant.tooth_code, {
                                          implant_model: nextValue
                                        })
                                      }
                                      getToneClass={() =>
                                        getImplantBrandToneClass(toothImplant.implant_brand)
                                      }
                                    />
                                  ) : (
                                    <div className="implant-configurator__hint">
                                      先選植體廠牌，再選對應型號。
                                    </div>
                                  )}
                                </div>

                                <div className="field field--full">
                                  <span>直徑 (mm)</span>
                                  <PillSelect
                                    value={String(toothImplant.implant_diameter_mm || "")}
                                    options={IMPLANT_DIAMETER_OPTIONS}
                                    onChange={(nextValue) =>
                                      updateToothImplant(toothImplant.tooth_code, {
                                        implant_diameter_mm: nextValue
                                      })
                                    }
                                    getToneClass={() => "pill--mist"}
                                  />
                                </div>

                                <div className="field field--full">
                                  <span>長度 (mm)</span>
                                  <PillSelect
                                    value={String(toothImplant.implant_length_mm || "")}
                                    options={IMPLANT_LENGTH_OPTIONS}
                                    onChange={(nextValue) =>
                                      updateToothImplant(toothImplant.tooth_code, {
                                        implant_length_mm: nextValue
                                      })
                                    }
                                    getToneClass={() => "pill--sand"}
                                  />
                                </div>

                                <div className="field field--full">
                                  <span>使用 Healing</span>
                                  <PillSelect
                                    value={toothHealingSelection}
                                    options={HEALING_TOGGLE_OPTIONS}
                                    onChange={(nextValue) =>
                                      updateToothImplant(toothImplant.tooth_code, {
                                        healing_used: nextValue === "yes",
                                        healing_size:
                                          nextValue === "yes" ? toothImplant.healing_size || "" : ""
                                      })
                                    }
                                    getToneClass={getHealingToggleToneClass}
                                  />
                                </div>

                                {toothImplant.healing_used ? (
                                  <div className="implant-healing-panel field--full">
                                    <div className="implant-healing-panel__header">
                                      <strong>Healing Size</strong>
                                    </div>
                                    <div className="implant-healing-groups">
                                      {healingSizeGroups.map(([groupLabel, groupOptions]) => (
                                        <div className="implant-healing-row" key={groupLabel}>
                                          <span className="implant-healing-row__label">{groupLabel}</span>
                                          <div className="pill-select pill-select--dense">
                                            {groupOptions.map((option) => (
                                              <button
                                                key={option.value}
                                                className={cx(
                                                  "pill-option",
                                                  "pill--lavender",
                                                  toothImplant.healing_size === option.value && "is-active"
                                                )}
                                                type="button"
                                                onClick={() =>
                                                  updateToothImplant(toothImplant.tooth_code, {
                                                    healing_used: true,
                                                    healing_size: option.value
                                                  })
                                                }
                                              >
                                                {option.label}
                                              </button>
                                            ))}
                                          </div>
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                ) : null}
                              </section>
                            );
                          })}
                        </div>
                      ) : null}
                    </div>
                  ) : null}

                  {["arp", "gbr", "sinus_lift"].includes(procedure.procedure_type) ? (
                    <>
                      <div className="field">
                        <span>骨粉材料</span>
                        <div className="checkbox-grid">
                          {BONE_GRAFT_OPTIONS.map((option) => (
                            <label className="checkbox" key={option}>
                              <input
                                type="checkbox"
                                checked={procedure.bone_graft_materials?.includes(option)}
                                onChange={(event) =>
                                  setVisitModal((current) => ({
                                    ...current,
                                    values: {
                                      ...current.values,
                                      procedures: current.values.procedures.map((item, innerIndex) =>
                                        innerIndex === index
                                          ? {
                                              ...item,
                                              bone_graft_materials: event.target.checked
                                                ? [...(item.bone_graft_materials || []), option]
                                                : (item.bone_graft_materials || []).filter(
                                                    (entry) => entry !== option
                                                  )
                                            }
                                          : item
                                      )
                                    }
                                  }))
                                }
                              />
                              <span>{option}</span>
                            </label>
                          ))}
                        </div>
                      </div>

                      <div className="toolbar-grid">
                        <div className="field field--full">
                          <span>再生膜</span>
                          <PillSelect
                            value={procedure.membrane_type || ""}
                            options={membraneSelectionOptions}
                            onChange={(nextValue) =>
                              setVisitModal((current) => ({
                                ...current,
                                values: {
                                  ...current.values,
                                  procedures: current.values.procedures.map((item, innerIndex) =>
                                    innerIndex === index
                                      ? {
                                          ...item,
                                          membrane_type: nextValue
                                        }
                                      : item
                                  )
                                }
                              }))
                            }
                            getToneClass={getMembraneToneClass}
                          />
                        </div>
                        <label className="field">
                          <span>再生膜補充</span>
                          <input
                            value={procedure.membrane_note || ""}
                            onChange={(event) =>
                              setVisitModal((current) => ({
                                ...current,
                                values: {
                                  ...current.values,
                                  procedures: current.values.procedures.map((item, innerIndex) =>
                                    innerIndex === index
                                      ? {
                                          ...item,
                                          membrane_note: event.target.value
                                        }
                                      : item
                                  )
                                }
                              }))
                            }
                          />
                        </label>
                      </div>
                    </>
                  ) : null}

                  {procedure.procedure_type === "sinus_lift" ? (
                    <label className="field">
                      <span>Sinus Lift 方式</span>
                      <select
                        value={procedure.sinus_lift_approach || ""}
                        onChange={(event) =>
                          setVisitModal((current) => ({
                            ...current,
                            values: {
                              ...current.values,
                              procedures: current.values.procedures.map((item, innerIndex) =>
                                innerIndex === index
                                  ? {
                                      ...item,
                                      sinus_lift_approach: event.target.value
                                    }
                                  : item
                              )
                            }
                          }))
                        }
                      >
                        <option value="">未設定</option>
                        {SINUS_LIFT_APPROACH_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : null}
                  </article>
                );
              })}
            </div>
          </div>

          <div className="field field--full">
            <div className="section-title-row">
              <span>照片</span>
              <label className="secondary-button secondary-button--file">
                上傳照片
                <input
                  type="file"
                  accept="image/*"
                  capture="environment"
                  multiple
                  onChange={(event) => {
                    pushNewPhotoDrafts(event.target.files);
                    event.target.value = "";
                  }}
                />
              </label>
            </div>

            {visitModal.values.new_photos.length ? (
              <div className="upload-feedback">
                {`已加入 ${visitModal.values.new_photos.length} 張待上傳照片，儲存回診後會自動同步。`}
              </div>
            ) : null}

            {visitModal.values.existing_photos.length ? (
              <div className="photo-draft-grid">
                {visitModal.values.existing_photos.map((photo, index) => (
                  <article
                    key={photo.id}
                    className={cx("photo-draft-card", photo.marked_for_delete && "is-dim")}
                  >
                    {photo.signed_url ? (
                      <button
                        className="photo-draft-trigger"
                        type="button"
                        onClick={() => openDraftPhotoEditor("existing", index)}
                      >
                        <img src={photo.signed_url} alt={photo.file_name} />
                      </button>
                    ) : null}
                    <div className="photo-draft-card__summary">
                      <div className="chip-row">
                        <span className={cx("pill", getPhotoLabelToneClass(photo.photo_label || ""))}>
                          {photo.photo_label || "未標記"}
                        </span>
                        <span className="muted-text">
                          {photo.caption ? "已填說明" : "點圖片補標籤"}
                        </span>
                      </div>
                      <div className="inline-actions">
                        <button
                          className="ghost-button"
                          type="button"
                          onClick={() => openDraftPhotoEditor("existing", index)}
                        >
                          編輯照片
                        </button>
                        <button
                          className="danger-button danger-button--ghost"
                          type="button"
                          onClick={() => toggleExistingPhotoDelete(index)}
                        >
                          {photo.marked_for_delete ? "取消刪除" : "刪除此照片"}
                        </button>
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            ) : null}

            {visitModal.values.new_photos.length ? (
              <div className="photo-draft-grid">
                {visitModal.values.new_photos.map((photo, index) => (
                  <article className="photo-draft-card" key={photo.local_id}>
                    <button
                      className="photo-draft-trigger"
                      type="button"
                      onClick={() => openDraftPhotoEditor("new", index)}
                    >
                      <img src={photo.preview_url} alt={photo.file.name} />
                    </button>
                    <div className="photo-draft-card__summary">
                      <div className="chip-row">
                        <span className={cx("pill", getPhotoLabelToneClass(photo.photo_label || ""))}>
                          {photo.photo_label || "未標記"}
                        </span>
                        <span className="muted-text">
                          {photo.caption ? "已填說明" : "點圖片補標籤"}
                        </span>
                      </div>
                      <div className="inline-actions">
                        <button
                          className="ghost-button"
                          type="button"
                          onClick={() => openDraftPhotoEditor("new", index)}
                        >
                          編輯照片
                        </button>
                        <button
                          className="danger-button danger-button--ghost"
                          type="button"
                          onClick={() => removeNewPhotoDraft(index)}
                        >
                          移除此檔案
                        </button>
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <div className="empty-state">尚未新增照片。</div>
            )}
          </div>

          <div className="field field--full">
            <div className="section-title-row section-title-row--stack">
              <span>下次安排</span>
              <PillSelect
                value={visitModal.values.next_plan_enabled ? "on" : "off"}
                options={nextPlanModeOptions}
                onChange={(nextValue) =>
                  setVisitModal((current) => ({
                    ...current,
                    values: {
                      ...current.values,
                      next_plan_enabled: nextValue === "on",
                      next_plan_procedure_type:
                        nextValue === "on"
                          ? current.values.next_plan_procedure_type ||
                            current.values.procedures[0]?.procedure_type ||
                            "follow_up"
                          : current.values.next_plan_procedure_type,
                      next_plan_planned_date:
                        nextValue === "on"
                          ? current.values.next_plan_planned_date ||
                            addDays(current.values.visited_on || todayIso(), 14)
                          : current.values.next_plan_planned_date
                    }
                  }))
                }
                getToneClass={(value) => (value === "on" ? "pill--sage" : "pill--stone")}
              />
            </div>

            {visitModal.values.next_plan_enabled ? (
              <div className="next-plan-card">
                <label className="field">
                  <span>下次日期</span>
                  <DateInput
                    value={visitModal.values.next_plan_planned_date}
                    shortcuts={visitFollowUpShortcuts}
                    onChange={(nextValue) =>
                      setVisitModal((current) => ({
                        ...current,
                        values: { ...current.values, next_plan_planned_date: nextValue }
                      }))
                    }
                  />
                </label>
                <div className="field field--full">
                  <span>下次治療內容</span>
                  <PillSelect
                    value={visitModal.values.next_plan_procedure_type}
                    options={PROCEDURE_OPTIONS}
                    onChange={(nextValue) =>
                      setVisitModal((current) => ({
                        ...current,
                        values: { ...current.values, next_plan_procedure_type: nextValue }
                      }))
                    }
                    getToneClass={getProcedureToneClass}
                  />
                </div>
                <label className="field field--full">
                  <span>計劃備註</span>
                  <textarea
                    rows="2"
                    value={visitModal.values.next_plan_note}
                    onChange={(event) =>
                      setVisitModal((current) => ({
                        ...current,
                        values: { ...current.values, next_plan_note: event.target.value }
                      }))
                    }
                    placeholder="下次要特別準備或提醒的內容"
                  />
                </label>
              </div>
            ) : null}
          </div>

          <div className="modal-actions">
            <button className="secondary-button" type="button" onClick={closeVisitModal}>
              取消
            </button>
            <button className="primary-button" type="submit">
              儲存回診
            </button>
          </div>
        </form>
      </Modal>

      <Modal
        open={casePhotoCompare.open}
        title="照片比較"
        subtitle={`依時間順序比較 ${selectedCaseToothHeading} 的多張照片。`}
        onClose={() =>
          setCasePhotoCompare((current) => ({
            ...current,
            open: false
          }))
        }
        width="wide"
      >
        {selectedComparePhotos.length >= 2 ? (
          <div className="compare-view">
            <div className="compare-view__multi-grid">
              {selectedComparePhotos.map((photo) => {
                const visit = visitsById[photo.visit_id];
                const procedures = visit ? proceduresByVisitId[visit.id] || [] : [];

                return (
                  <article className="compare-view__panel compare-view__panel--multi" key={photo.id}>
                    <div className="compare-view__image-frame">
                      <img
                        className="compare-view__image"
                        src={photo.signed_url}
                        alt={photoTitle(photo)}
                      />
                    </div>
                    <div className="compare-view__panel-meta">
                      <strong>{visit?.visited_on ? formatDate(visit.visited_on) : "未指定日期"}</strong>
                      <div className="chip-row">
                        {procedures.map((procedure) => (
                          <span
                            className={cx("pill", getProcedureToneClass(procedure.procedure_type))}
                            key={procedure.id}
                          >
                            {PROCEDURE_LABELS[procedure.procedure_type]}
                          </span>
                        ))}
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          </div>
        ) : (
          <div className="empty-state">請先至少選擇 2 張照片。</div>
        )}
      </Modal>

      <Modal
        open={draftPhotoEditor.open && Boolean(activeDraftPhoto)}
        title="編輯照片"
        subtitle="先看圖，再補標籤與說明。"
        onClose={closeDraftPhotoEditor}
        width="wide"
      >
        {activeDraftPhoto ? (
          <div className="photo-lightbox">
            <div className="photo-lightbox__frame">
              <img
                className="photo-lightbox__image"
                src={activeDraftPhoto.signed_url || activeDraftPhoto.preview_url}
                alt={activeDraftPhoto.file_name || activeDraftPhoto.file?.name || "Clinical Photo"}
              />
            </div>
            <div className="field field--full">
              <span>快速標籤</span>
              <PillSelect
                value={activeDraftPhoto.photo_label || ""}
                options={photoLabelSelectionOptions}
                onChange={(nextValue) =>
                  updateDraftPhoto(draftPhotoEditor.kind, draftPhotoEditor.index, {
                    photo_label: nextValue
                  })
                }
                getToneClass={getPhotoLabelToneClass}
              />
            </div>
            <label className="field field--full">
              <span>說明</span>
              <textarea
                rows="3"
                value={activeDraftPhoto.caption || ""}
                onChange={(event) =>
                  updateDraftPhoto(draftPhotoEditor.kind, draftPhotoEditor.index, {
                    caption: event.target.value
                  })
                }
              />
            </label>
            <div className="modal-actions">
              <button className="secondary-button" type="button" onClick={closeDraftPhotoEditor}>
                完成
              </button>
              {draftPhotoEditor.kind === "existing" ? (
                <button
                  className="danger-button danger-button--ghost"
                  type="button"
                  onClick={() => toggleExistingPhotoDelete(draftPhotoEditor.index)}
                >
                  {activeDraftPhoto.marked_for_delete ? "取消刪除" : "刪除此照片"}
                </button>
              ) : (
                <button
                  className="danger-button danger-button--ghost"
                  type="button"
                  onClick={() => removeNewPhotoDraft(draftPhotoEditor.index)}
                >
                  移除此檔案
                </button>
              )}
            </div>
          </div>
        ) : (
          <div className="empty-state">目前沒有可編輯的照片。</div>
        )}
      </Modal>

      <Modal
        open={photoPreview.open}
        title="照片預覽"
        subtitle="點照片可放大查看完整畫面。"
        onClose={() =>
          setPhotoPreview({
            open: false,
            photoId: ""
          })
        }
        width="xwide"
      >
        {previewPhoto?.signed_url ? (
          <div className="photo-lightbox">
            <div className="photo-lightbox__frame">
              <img className="photo-lightbox__image" src={previewPhoto.signed_url} alt={photoTitle(previewPhoto)} />
            </div>
            <div className="photo-lightbox__meta">
              <strong>{previewPhotoVisit?.visited_on ? formatDate(previewPhotoVisit.visited_on) : "未指定回診"}</strong>
              <div className="chip-row">
                {previewPhotoProcedures.map((procedure) => (
                  <span className={cx("pill", getProcedureToneClass(procedure.procedure_type))} key={procedure.id}>
                    {PROCEDURE_LABELS[procedure.procedure_type]}
                  </span>
                ))}
              </div>
              {previewPhoto.caption ? <p>{previewPhoto.caption}</p> : null}
            </div>
          </div>
        ) : (
          <div className="empty-state">目前沒有可預覽的照片。</div>
        )}
      </Modal>
    </div>
  );
}
