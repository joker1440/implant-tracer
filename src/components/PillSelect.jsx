import { cx } from "../lib/format";

export default function PillSelect({
  value,
  options,
  onChange,
  getToneClass,
  className = "",
  onDeleteOption,
  isOptionDeletable,
  multiple = false
}) {
  const selectedValues = Array.isArray(value) ? value : [value];

  return (
    <div className={cx("pill-select", className)}>
      {options.map((option) => (
        <div
          className={cx(
            "pill-option-wrap",
            onDeleteOption && isOptionDeletable?.(option.value) && "pill-option-wrap--deletable"
          )}
          key={option.value || "__empty__"}
        >
            <button
              className={cx(
                "pill-option",
                onDeleteOption && isOptionDeletable?.(option.value) && "pill-option--deletable",
                getToneClass?.(option.value),
                selectedValues.includes(option.value) && "is-active"
              )}
              type="button"
              onClick={() => {
                if (!multiple) {
                  onChange(option.value);
                  return;
                }

                const nextValues = selectedValues.includes(option.value)
                  ? selectedValues.filter((selectedValue) => selectedValue !== option.value)
                  : [...selectedValues, option.value];
                onChange(nextValues);
              }}
            >
              {option.label}
            </button>
          {onDeleteOption && isOptionDeletable?.(option.value) ? (
            <button
              className="pill-option__delete"
              type="button"
              aria-label={`刪除 ${option.label}`}
              onClick={(event) => {
                event.stopPropagation();
                onDeleteOption(option.value);
              }}
            >
              ×
            </button>
          ) : null}
        </div>
      ))}
    </div>
  );
}
