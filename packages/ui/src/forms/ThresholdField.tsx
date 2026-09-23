import { forwardRef, type HTMLAttributes } from "react";
import { cn } from "@/lib/cn";
import type { ConfidenceThresholds, GateConfig } from "@/types";
import { useFieldControl } from "@/primitives";
import { ConfidenceGateEditor } from "@/decision";

export interface ThresholdFieldProps extends Omit<
  HTMLAttributes<HTMLDivElement>,
  "onChange" | "defaultValue"
> {
  value?: ConfidenceThresholds;
  defaultValue?: ConfidenceThresholds;
  onChange?: (thresholds: ConfidenceThresholds) => void;
  /** The gate's runtime config (`threshold`, `reviewBand?`, `requireValue?`); mapped `auto := threshold`, `review := threshold − (reviewBand ?? threshold)`. Used when `value` is absent. */
  gate?: GateConfig;
  /** Uncontrolled runtime config, used when neither `value`, `gate` nor `defaultValue` is given. */
  defaultGate?: GateConfig;
  /** The runtime config on every change (`reviewBand` omitted for a floor of 0, the two-way gate). */
  onGateChange?: (config: GateConfig) => void;
  /** Historic confidences (0–1) drawn as a histogram over the zones. */
  samples?: readonly number[];
  disabled?: boolean;
  invalid?: boolean;
  id?: string;
  /** Hide the two numeric inputs (slider only). */
  hideInputs?: boolean;
  /** Field label; names the slider for assistive tech. */
  label?: string;
  /** Called with the validation message (review must stay below auto) whenever it changes. */
  onValidate?: (message: string | null) => void;
}

export const DEFAULT_THRESHOLDS: ConfidenceThresholds = { review: 0.7, auto: 0.9 };

/**
 * Confidence gate field: the decision group's ConfidenceGateEditor wired into
 * a form field (FieldRow context, disabled state, sample histogram). Also
 * registered as the SchemaForm "threshold" widget.
 */
export const ThresholdField = forwardRef<HTMLDivElement, ThresholdFieldProps>(
  function ThresholdField(
    {
      value,
      defaultValue,
      onChange,
      gate,
      defaultGate,
      onGateChange,
      samples,
      disabled,
      invalid,
      id,
      hideInputs = false,
      label = "Confidence gate",
      onValidate,
      className,
      ...rest
    },
    ref,
  ) {
    const field = useFieldControl({ id, disabled, "aria-invalid": invalid });
    return (
      <ConfidenceGateEditor
        ref={ref}
        id={field.id}
        aria-describedby={field["aria-describedby"]}
        value={value}
        defaultValue={defaultValue ?? (gate || defaultGate ? undefined : DEFAULT_THRESHOLDS)}
        onChange={onChange}
        gate={gate}
        defaultGate={defaultGate}
        onGateChange={onGateChange}
        histogram={samples}
        hideInputs={hideInputs}
        label={label}
        disabled={Boolean(field.disabled)}
        onValidate={onValidate}
        className={cn(field["aria-invalid"] && "[&_[role=slider]]:border-danger", className)}
        {...rest}
      />
    );
  },
);
