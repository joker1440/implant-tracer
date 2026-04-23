import { useEffect, useState } from "react";
import {
  cx,
  displayDateInput,
  displayRocDateInput,
  formatDateDraftInput,
  formatRocDateDraftInput,
  parseDateInput,
  parseRocDateInput
} from "../lib/format";

export default function DateInput({
  value,
  onChange,
  placeholder,
  shortcuts = [],
  className = "",
  required = false,
  calendar = "gregorian"
}) {
  const useRocCalendar = calendar === "roc";
  const displayValue = useRocCalendar ? displayRocDateInput : displayDateInput;
  const formatDraftValue = useRocCalendar ? formatRocDateDraftInput : formatDateDraftInput;
  const parseValue = useRocCalendar ? parseRocDateInput : parseDateInput;
  const resolvedPlaceholder = placeholder || (calendar === "roc" ? "YYY/MM/DD" : "YYYY/MM/DD");
  const maxLength = calendar === "roc" ? 9 : 10;

  const [draft, setDraft] = useState(displayValue(value));

  useEffect(() => {
    setDraft(displayValue(value));
  }, [useRocCalendar, value]);

  function commit(nextDraft) {
    const parsed = parseValue(nextDraft);

    if (parsed === "") {
      setDraft("");
      onChange("");
      return;
    }

    if (parsed) {
      setDraft(displayValue(parsed));
      onChange(parsed);
      return;
    }

    setDraft(displayValue(value));
  }

  return (
    <div className={cx("date-entry", className)}>
      <input
        value={draft}
        placeholder={resolvedPlaceholder}
        required={required}
        inputMode="numeric"
        maxLength={maxLength}
        onChange={(event) => setDraft(formatDraftValue(event.target.value))}
        onBlur={(event) => commit(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            commit(draft);
          }
        }}
      />
      {shortcuts.length ? (
        <div className="date-shortcuts">
          {shortcuts.map((shortcut) => (
            <button
              key={shortcut.label}
              className="shortcut-pill"
              type="button"
              onClick={() => {
                setDraft(displayValue(shortcut.value));
                onChange(shortcut.value);
              }}
            >
              {shortcut.label}
            </button>
          ))}
          <button
            className="shortcut-pill shortcut-pill--ghost"
            type="button"
            onClick={() => {
              setDraft("");
              onChange("");
            }}
          >
            清除
          </button>
        </div>
      ) : null}
    </div>
  );
}
