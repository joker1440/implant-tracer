function toLocalIsoDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function isValidIsoDateParts(year, month, day) {
  const date = new Date(`${year}-${month}-${day}T00:00:00`);
  return (
    Number(date.getFullYear()) === Number(year) &&
    Number(date.getMonth() + 1) === Number(month) &&
    Number(date.getDate()) === Number(day)
  );
}

export function todayIso() {
  return toLocalIsoDate(new Date());
}

export function addDays(dateString, offset) {
  if (!dateString) {
    return null;
  }

  const date = new Date(`${dateString}T00:00:00`);
  date.setDate(date.getDate() + Number(offset || 0));
  return toLocalIsoDate(date);
}

export function addMonths(dateString, offset) {
  if (!dateString) {
    return null;
  }

  const [year, month, day] = String(dateString).split("-").map(Number);
  const targetMonthIndex = month - 1 + Number(offset || 0);
  const targetYear = year + Math.floor(targetMonthIndex / 12);
  const normalizedMonthIndex = ((targetMonthIndex % 12) + 12) % 12;
  const lastDayOfTargetMonth = new Date(targetYear, normalizedMonthIndex + 1, 0).getDate();
  const targetDay = Math.min(day, lastDayOfTargetMonth);

  return toLocalIsoDate(new Date(targetYear, normalizedMonthIndex, targetDay));
}

export function displayDateInput(value) {
  return value ? value.replace(/-/g, "/") : "";
}

export function formatDateDraftInput(value) {
  const digitsOnly = String(value || "").replace(/\D/g, "").slice(0, 8);

  if (!digitsOnly) {
    return "";
  }

  if (digitsOnly.length <= 4) {
    return digitsOnly;
  }

  if (digitsOnly.length <= 6) {
    return `${digitsOnly.slice(0, 4)}/${digitsOnly.slice(4)}`;
  }

  return `${digitsOnly.slice(0, 4)}/${digitsOnly.slice(4, 6)}/${digitsOnly.slice(6)}`;
}

export function parseDateInput(value) {
  const normalized = String(value || "")
    .trim()
    .replace(/[.]/g, "/")
    .replace(/-/g, "/");

  if (!normalized) {
    return "";
  }

  const match = normalized.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/);
  if (!match) {
    return null;
  }

  const [, year, month, day] = match;
  const iso = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

  return isValidIsoDateParts(year, month, day) ? iso : null;
}

export function formatDate(value) {
  if (!value) {
    return "未設定";
  }

  const date = new Date(`${value}T00:00:00`);
  return new Intl.DateTimeFormat("zh-TW", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
}

export function formatDateTime(value) {
  if (!value) {
    return "未設定";
  }

  return new Intl.DateTimeFormat("zh-TW", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

export function calculateAge(birthDate) {
  if (!birthDate) {
    return null;
  }

  const today = new Date();
  const birth = new Date(`${birthDate}T00:00:00`);
  let age = today.getFullYear() - birth.getFullYear();
  const monthDiff = today.getMonth() - birth.getMonth();

  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birth.getDate())) {
    age -= 1;
  }

  return age >= 0 ? age : null;
}

export function formatShortMonthDay(value) {
  if (!value) {
    return { month: "--", day: "--" };
  }

  const date = new Date(`${value}T00:00:00`);
  return {
    month: date.toLocaleString("en-US", { month: "short" }).toUpperCase(),
    day: String(date.getDate())
  };
}

export function formatMonthDayYearChip(value) {
  if (!value) {
    return { year: "----", monthDay: "--/--" };
  }

  const date = new Date(`${value}T00:00:00`);
  return {
    year: String(date.getFullYear()),
    monthDay: `${date.getMonth() + 1}/${date.getDate()}`
  };
}

export function daysFromToday(value) {
  if (!value) {
    return null;
  }

  const target = new Date(`${value}T00:00:00`);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  target.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - today.getTime()) / 86400000);
}

export function cx(...tokens) {
  return tokens.filter(Boolean).join(" ");
}

export function slugifyFileName(name) {
  return name
    .normalize("NFKD")
    .replace(/[^\w.\-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
}
