import { useEffect, useState } from "react";
import {
  cx,
  displayDateInput,
  formatDateDraftInput,
  parseDateInput
} from "../lib/format";

export default function DateInput({
  value,
  onChange,
  placeholder = "YYYY/MM/DD",
  shortcuts = [],
  className = "",
  required = false
}) {
  const [draft, setDraft] = useState(displayDateInput(value));

  useEffect(() => {
    setDraft(displayDateInput(value));
  }, [value]);

  function commit(nextDraft) {
    const parsed = parseDateInput(nextDraft);

    if (parsed === "") {
      setDraft("");
      onChange("");
      return;
    }

    if (parsed) {
      setDraft(displayDateInput(parsed));
      onChange(parsed);
      return;
    }

    setDraft(displayDateInput(value));
  }

  return (
    <div className={cx("date-entry", className)}>
      <input
        value={draft}
        placeholder={placeholder}
        required={required}
        inputMode="numeric"
        maxLength={10}
        onChange={(event) => setDraft(formatDateDraftInput(event.target.value))}
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
                setDraft(displayDateInput(shortcut.value));
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
