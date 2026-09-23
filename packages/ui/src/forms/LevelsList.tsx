/**
 * The `levels` widget: the ordered level descriptions of a score decision (TypeSafe: 2–10
 * levels, lowest first). Rows can be reordered by drag or keyboard (the grip takes Arrow keys,
 * Home and End); each row keeps a stable key across reorders and removals, so focus and
 * validation stay with the level they belong to.
 */
import { useState } from "react";
import { Plus, X } from "lucide-react";
import { Button, FieldError, IconButton, Input } from "@/primitives";
import { ReorderableList } from "./ReorderableList";

export const LEVELS_MIN = 2;
export const LEVELS_MAX = 10;

export interface LevelsListProps {
  value: string[];
  onChange: (levels: string[]) => void;
  disabled?: boolean;
  /** Show per-level problems (empty descriptions, count out of range). */
  showIssues?: boolean;
  "aria-label"?: string;
}

/** Problems of a level list, keyed `count` or the level index. */
export function validateLevels(levels: readonly string[]): {
  count?: string;
  levels: Record<number, string>;
} {
  const out: { count?: string; levels: Record<number, string> } = { levels: {} };
  if (levels.length < LEVELS_MIN || levels.length > LEVELS_MAX)
    out.count = `A score needs between ${LEVELS_MIN} and ${LEVELS_MAX} levels (${levels.length} given).`;
  levels.forEach((level, i) => {
    if (level.trim() === "") out.levels[i] = "Describe this level.";
  });
  return out;
}

let nextKey = 0;
const newKey = () => `level-${(nextKey += 1)}`;

export function LevelsList({
  value,
  onChange,
  disabled,
  showIssues = true,
  "aria-label": ariaLabel = "Levels",
}: LevelsListProps) {
  const [keys, setKeys] = useState<string[]>(() => value.map(newKey));
  // Keep one key per level when the value changes from outside (state adjusted during render).
  if (keys.length !== value.length) setKeys(value.map((_, i) => keys[i] ?? newKey()));
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const issues = validateLevels(value);

  const update = (next: string[], nextKeys: string[]) => {
    setKeys(nextKeys);
    onChange(next);
  };

  return (
    <div className="flex flex-col gap-1.5" data-widget="levels">
      <ReorderableList
        items={value}
        keyOf={(_l, i) => keys[i] ?? String(i)}
        disabled={disabled}
        label={ariaLabel}
        onReorder={(levels, order) =>
          update(
            levels,
            order.map((from) => keys[from] ?? newKey()),
          )
        }
        renderItem={(level, index, handle) => {
          const key = keys[index] ?? String(index);
          const issue = issues.levels[index];
          const showIssue = showIssues && issue !== undefined && touched[key] === true;
          return (
            <div className="flex flex-col gap-1">
              <div className="grid grid-cols-[20px_24px_minmax(0,1fr)_28px] items-center gap-1.5">
                {handle}
                <span className="font-mono text-2xs text-ink-3 tabular" aria-hidden="true">
                  {index}
                </span>
                <Input
                  aria-label={`Level ${index} description`}
                  placeholder={
                    index === 0
                      ? "Lowest: no action needed"
                      : index === value.length - 1
                        ? "Highest: immediate escalation"
                        : "Describe this level"
                  }
                  value={level}
                  invalid={showIssue ? true : undefined}
                  disabled={disabled}
                  onBlur={() => setTouched((t) => ({ ...t, [key]: true }))}
                  onChange={(e) =>
                    onChange(value.map((l, i) => (i === index ? e.target.value : l)))
                  }
                />
                <IconButton
                  label={`Remove level ${index}`}
                  size="sm"
                  variant="ghost"
                  disabled={disabled || value.length <= LEVELS_MIN}
                  onClick={() =>
                    update(
                      value.filter((_, i) => i !== index),
                      keys.filter((_, i) => i !== index),
                    )
                  }
                >
                  <X strokeWidth={1.75} />
                </IconButton>
              </div>
              {showIssue ? <p className="pl-[56px] text-2xs text-danger-text">{issue}</p> : null}
            </div>
          );
        }}
      />
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          variant="ghost"
          leadingIcon={<Plus />}
          disabled={disabled || value.length >= LEVELS_MAX}
          onClick={() => update([...value, ""], [...keys, newKey()])}
        >
          Add level
        </Button>
        <span className="ml-auto font-mono text-2xs text-ink-3 tabular">
          {value.length} / {LEVELS_MAX} · ordered low → high
        </span>
      </div>
      {showIssues && issues.count ? <FieldError>{issues.count}</FieldError> : null}
    </div>
  );
}
