import { cx } from "../lib/format";

const DISPLAY_ROWS = [
  ["18", "17", "16", "15", "14", "13", "12", "11", "21", "22", "23", "24", "25", "26", "27", "28"],
  ["48", "47", "46", "45", "44", "43", "42", "41", "31", "32", "33", "34", "35", "36", "37", "38"]
];

export default function ToothPicker({
  value,
  onChange,
  occupiedCodes = [],
  allowOccupiedValue = true,
  multiple = false
}) {
  const occupiedSet = new Set(occupiedCodes);
  const selectedValues = Array.isArray(value) ? value : value ? [value] : [];
  const selectedSet = new Set(selectedValues);

  function handleSelect(code) {
    if (!multiple) {
      onChange(code);
      return;
    }

    if (selectedSet.has(code)) {
      onChange(selectedValues.filter((selectedCode) => selectedCode !== code));
      return;
    }

    onChange([...selectedValues, code]);
  }

  return (
    <div className="tooth-picker tooth-picker--compact">
      {DISPLAY_ROWS.map((row, rowIndex) => (
        <div className="tooth-picker__row tooth-picker__row--compact" key={rowIndex}>
          {row.map((code) => {
            const isOccupied = occupiedSet.has(code);
            const isSelected = selectedSet.has(code);
            const isDisabled = isOccupied && !(allowOccupiedValue && isSelected);

            return (
              <button
                key={code}
                className={cx(
                  "tooth-button",
                  "tooth-button--compact",
                  isSelected && "is-selected",
                  isOccupied && "is-occupied"
                )}
                type="button"
                onClick={() => handleSelect(code)}
                disabled={isDisabled}
                title={isOccupied ? "此牙位已有 case" : `選擇牙位 ${code}`}
              >
                {code}
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}
