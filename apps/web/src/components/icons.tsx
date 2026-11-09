import type { JSX } from "react";

export function CheckIcon(): JSX.Element {
  return (
    <svg className="icon" viewBox="0 0 16 16" aria-hidden="true" fill="none">
      <path d="M2.5 8.5 6.2 12.2 13.5 4" stroke="currentColor" strokeWidth="2" strokeLinecap="square" />
    </svg>
  );
}

export function ArchiveIcon(): JSX.Element {
  return (
    <svg className="icon" viewBox="0 0 16 16" aria-hidden="true" fill="none">
      <path d="M1.5 2.5h13v3h-13zM2.5 5.5v8h11v-8M6 8.5h4" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="miter" />
    </svg>
  );
}

export function BackIcon(): JSX.Element {
  return (
    <svg className="icon" viewBox="0 0 16 16" aria-hidden="true" fill="none">
      <path d="M9.5 3 4.5 8l5 5M4.5 8H15" stroke="currentColor" strokeWidth="1.75" strokeLinecap="square" />
    </svg>
  );
}

export function ForwardIcon(): JSX.Element {
  return (
    <svg className="icon" viewBox="0 0 16 16" aria-hidden="true" fill="none">
      <path d="M6.5 3l5 5-5 5M11.5 8H1" stroke="currentColor" strokeWidth="1.75" strokeLinecap="square" />
    </svg>
  );
}

export function MinusIcon(): JSX.Element {
  return (
    <svg className="icon" viewBox="0 0 16 16" aria-hidden="true" fill="none">
      <path d="M3 8h10" stroke="currentColor" strokeWidth="1.75" />
    </svg>
  );
}

export function PlusIcon(): JSX.Element {
  return (
    <svg className="icon" viewBox="0 0 16 16" aria-hidden="true" fill="none">
      <path d="M3 8h10M8 3v10" stroke="currentColor" strokeWidth="1.75" />
    </svg>
  );
}

export function CloseIcon(): JSX.Element {
  return (
    <svg className="icon" viewBox="0 0 16 16" aria-hidden="true" fill="none">
      <path d="M3.5 3.5l9 9M12.5 3.5l-9 9" stroke="currentColor" strokeWidth="1.75" />
    </svg>
  );
}
