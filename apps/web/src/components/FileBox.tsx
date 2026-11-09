import type { JSX } from "react";
import type { Quote } from "../api";
import { formatFileSize } from "../format";
import { CloseIcon } from "./icons";
import { QuantityStepper } from "./QuantityStepper";
import { ThumbnailPlaceholder } from "./QuoteThumbnail";

export type PreviewState =
  | { kind: "loading" }
  | { kind: "ready"; url: string }
  | { kind: "failed" };

export type QuoteProgress =
  | { kind: "idle" }
  | { kind: "queued" }
  | { kind: "running" }
  | { kind: "done"; quote: Quote }
  | { kind: "failed"; message: string };

export interface FileEntry {
  id: number;
  file: File;
  validationError: string | null;
  quantity: string;
  quantityError: string | null;
  preview: PreviewState;
  progress: QuoteProgress;
}

export function quantityInputId(entryId: number): string {
  return `quantity-${entryId}`;
}

export function removeButtonId(entryId: number): string {
  return `remove-file-${entryId}`;
}

interface PreviewSlotProps {
  entry: FileEntry;
  onPreviewError: () => void;
}

function PreviewSlot({ entry, onPreviewError }: PreviewSlotProps): JSX.Element {
  const { preview, file } = entry;
  return (
    <div className="thumb-slot">
      {preview.kind === "loading" && <div className="thumb-skeleton" aria-hidden="true" />}
      {preview.kind === "ready" && (
        <img className="thumb" alt={`Preview of ${file.name}`} src={preview.url} onError={onPreviewError} />
      )}
      {preview.kind === "failed" && <ThumbnailPlaceholder label={`No preview available for ${file.name}`} />}
    </div>
  );
}

function statusText(progress: QuoteProgress): string {
  switch (progress.kind) {
    case "queued":
      return "Waiting…";
    case "running":
      return "Analyzing…";
    case "done":
      return "Quoted";
    default:
      return "";
  }
}

interface FileBoxProps {
  entry: FileEntry;
  disabled: boolean;
  onRemove: () => void;
  onPreviewError: () => void;
  onQuantityChange: (quantity: string) => void;
}

export function FileBox({
  entry,
  disabled,
  onRemove,
  onPreviewError,
  onQuantityChange,
}: FileBoxProps): JSX.Element {
  const { id, file, validationError, quantity, quantityError, progress } = entry;
  const failure: string | null = validationError ?? (progress.kind === "failed" ? progress.message : null);
  const quantityId: string = quantityInputId(id);
  const quantityErrorId: string = `${quantityId}-error`;
  const invalid: boolean = failure !== null || quantityError !== null;
  return (
    <li className="sheet file-box" data-state={invalid ? "failed" : progress.kind}>
      <PreviewSlot entry={entry} onPreviewError={onPreviewError} />
      <div className="file-box-copy">
        <strong className="dropzone-file">{file.name}</strong>
        <span className="hint">{formatFileSize(file.size)}</span>
        <span className="file-box-status">{statusText(progress)}</span>
      </div>
      <div className="file-box-quantity">
        {validationError === null ? (
          <label className="micro-label" htmlFor={quantityId}>
            Quantity
          </label>
        ) : (
          <span className="micro-label" aria-hidden="true">
            &nbsp;
          </span>
        )}
        <div className="file-box-controls">
          {validationError === null && (
            <QuantityStepper
              id={quantityId}
              value={quantity}
              disabled={disabled || progress.kind === "done"}
              invalid={quantityError !== null}
              describedBy={quantityError === null ? undefined : quantityErrorId}
              inputLabel={`Quantity for ${file.name}`}
              decreaseLabel={`Decrease quantity for ${file.name}`}
              increaseLabel={`Increase quantity for ${file.name}`}
              onChange={onQuantityChange}
            />
          )}
          <button
            id={removeButtonId(id)}
            className="icon-action file-box-remove"
            type="button"
            disabled={disabled}
            aria-label={`Remove ${file.name}`}
            onClick={onRemove}
          >
            <CloseIcon />
          </button>
        </div>
      </div>
      {failure !== null && (
        <p className="field-error file-box-error" role="alert">
          {failure}
        </p>
      )}
      {quantityError !== null && (
        <p id={quantityErrorId} className="field-error file-box-error" role="alert">
          {quantityError}
        </p>
      )}
    </li>
  );
}
