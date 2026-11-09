import { useEffect, useId, useRef } from "react";
import type { JSX, ReactNode } from "react";
import { createPortal } from "react-dom";

interface ConfirmDialogProps {
  title: string;
  children: ReactNode;
  cancelLabel: string;
  confirmLabel: string;
  onCancel: () => void;
  onConfirm: () => void;
}

export function ConfirmDialog({
  title,
  children,
  cancelLabel,
  confirmLabel,
  onCancel,
  onConfirm,
}: ConfirmDialogProps): JSX.Element {
  const titleId = useId();
  const bodyId = useId();
  const cancelButton = useRef<HTMLButtonElement>(null);
  const confirmButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null;
    cancelButton.current?.focus();
    return () => {
      if (previousFocus?.isConnected) {
        previousFocus.focus();
      }
    };
  }, []);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape") {
        event.stopPropagation();
        onCancel();
        return;
      }
      if (event.key !== "Tab") {
        return;
      }
      event.preventDefault();
      const next: HTMLButtonElement | null =
        document.activeElement === cancelButton.current ? confirmButton.current : cancelButton.current;
      next?.focus();
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onCancel]);

  return createPortal(
    <div className="dialog-backdrop">
      <div
        className="dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
      >
        <h2 id={titleId} className="dialog-title">
          {title}
        </h2>
        <div id={bodyId} className="dialog-body">
          {children}
        </div>
        <div className="dialog-actions">
          <button ref={cancelButton} className="button button-quiet" type="button" onClick={onCancel}>
            {cancelLabel}
          </button>
          <button ref={confirmButton} className="button" type="button" onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
