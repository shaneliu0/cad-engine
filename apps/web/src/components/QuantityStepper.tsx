import { useRef } from "react";
import type { ChangeEvent, JSX, MouseEvent, RefObject } from "react";
import { MAX_QUANTITY, MIN_QUANTITY, parseQuantity, stepQuantity } from "../quantity";
import { MinusIcon, PlusIcon } from "./icons";

interface QuantityStepperProps {
  id: string;
  value: string;
  disabled: boolean;
  invalid: boolean;
  describedBy?: string;
  inputLabel?: string;
  decreaseLabel: string;
  increaseLabel: string;
  onChange: (value: string) => void;
}

export function QuantityStepper({
  id,
  value,
  disabled,
  invalid,
  describedBy,
  inputLabel,
  decreaseLabel,
  increaseLabel,
  onChange,
}: QuantityStepperProps): JSX.Element {
  const decreaseButton = useRef<HTMLButtonElement>(null);
  const increaseButton = useRef<HTMLButtonElement>(null);
  const current: number | null = parseQuantity(value);

  function step(
    event: MouseEvent<HTMLButtonElement>,
    delta: 1 | -1,
    limit: number,
    opposite: RefObject<HTMLButtonElement | null>,
  ): void {
    const next: string = stepQuantity(value, delta);
    onChange(next);
    if (Number(next) === limit && document.activeElement === event.currentTarget) {
      opposite.current?.focus();
    }
  }

  return (
    <div className="quantity-stepper">
      <button
        ref={decreaseButton}
        className="icon-action quantity-step"
        data-step="down"
        type="button"
        aria-label={decreaseLabel}
        disabled={disabled || current === MIN_QUANTITY}
        onClick={(event: MouseEvent<HTMLButtonElement>) => step(event, -1, MIN_QUANTITY, increaseButton)}
      >
        <MinusIcon />
      </button>
      <input
        id={id}
        className="text-input"
        type="text"
        inputMode="numeric"
        autoComplete="off"
        aria-label={inputLabel}
        value={value}
        disabled={disabled}
        aria-invalid={invalid}
        aria-describedby={describedBy}
        onChange={(event: ChangeEvent<HTMLInputElement>) => onChange(event.target.value)}
      />
      <button
        ref={increaseButton}
        className="icon-action quantity-step"
        data-step="up"
        type="button"
        aria-label={increaseLabel}
        disabled={disabled || current === MAX_QUANTITY}
        onClick={(event: MouseEvent<HTMLButtonElement>) => step(event, 1, MAX_QUANTITY, decreaseButton)}
      >
        <PlusIcon />
      </button>
    </div>
  );
}
