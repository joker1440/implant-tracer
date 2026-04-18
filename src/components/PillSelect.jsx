import { cx } from "../lib/format";

export default function PillSelect({
  value,
  options,
  onChange,
  getToneClass,
  className = ""
}) {
  return (
    <div className={cx("pill-select", className)}>
      {options.map((option) => (
        <button
          key={option.value || "__empty__"}
          className={cx(
            "pill-option",
            getToneClass?.(option.value),
            value === option.value && "is-active"
          )}
          type="button"
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
