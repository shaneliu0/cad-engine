import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ChangeEvent, DragEvent, JSX, SubmitEvent } from "react";
import { flushSync } from "react-dom";
import { useNavigate } from "react-router";
import { createPreview, createQuote, getErrorMessage } from "../api";
import type { Quote } from "../api";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { FileBox, quantityInputId, removeButtonId } from "../components/FileBox";
import type { FileEntry, PreviewState, QuoteProgress } from "../components/FileBox";
import { BackIcon } from "../components/icons";
import { QuantityStepper } from "../components/QuantityStepper";
import { createLimiter } from "../limit";
import type { Limiter } from "../limit";
import { DEFAULT_QUANTITY, validateQuantity } from "../quantity";

const MAX_FILES = 20;
const MAX_CONCURRENT_REQUESTS = 2;
const ALLOWED_EXTENSIONS: readonly string[] = [".step", ".stp"];

function validateFile(file: File): string | null {
  const name = file.name.toLowerCase();
  if (!ALLOWED_EXTENSIONS.some((extension: string) => name.endsWith(extension))) {
    return "Only .step and .stp files can be quoted.";
  }
  if (file.size === 0) {
    return "That file is empty.";
  }
  return null;
}

interface AnalysisProgressProps {
  total: number;
  finished: number;
}

function AnalysisProgress({ total, finished }: AnalysisProgressProps): JSX.Element {
  const [elapsedSeconds, setElapsedSeconds] = useState<number>(0);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setElapsedSeconds((seconds: number) => seconds + 1);
    }, 1000);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <div className="progress">
      <div className="progress-bar" aria-hidden="true" />
      <div className="progress-text">
        <p role="status">
          {total > 1 ? `Analyzing parts… ${finished} of ${total} done` : "Analyzing part geometry…"}
        </p>
        <span className="progress-elapsed" aria-hidden="true">
          {elapsedSeconds}s
        </span>
      </div>
      <p className="hint">Large files can take a while. Keep this page open.</p>
    </div>
  );
}

interface NewQuotePageProps {
  onSelectionChange?: (hasFiles: boolean) => void;
  onQuoteCreated?: () => void;
}

export function NewQuotePage({ onSelectionChange, onQuoteCreated }: NewQuotePageProps): JSX.Element {
  const navigate = useNavigate();
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [draftQuantity, setDraftQuantity] = useState<string>(DEFAULT_QUANTITY);
  const [fileError, setFileError] = useState<string | null>(null);
  const [draftQuantityError, setDraftQuantityError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [dragging, setDragging] = useState<boolean>(false);
  const [confirmingDiscard, setConfirmingDiscard] = useState<boolean>(false);
  const entriesRef = useRef<FileEntry[]>([]);
  const discardPrompted = useRef<boolean>(false);
  const resultsWaiting = useRef<boolean>(false);
  const nextEntryId = useRef<number>(1);
  const submitController = useRef<AbortController | null>(null);
  const previewControllers = useRef<Map<number, AbortController>>(new Map());
  const previewUrls = useRef<Map<number, string>>(new Map());
  const previewLimiter = useRef<Limiter>(createLimiter(MAX_CONCURRENT_REQUESTS));
  const selectionCallback = useRef<typeof onSelectionChange>(onSelectionChange);
  const createdCallback = useRef<typeof onQuoteCreated>(onQuoteCreated);
  const fileInput = useRef<HTMLInputElement>(null);
  const submitButton = useRef<HTMLButtonElement>(null);

  selectionCallback.current = onSelectionChange;
  createdCallback.current = onQuoteCreated;

  const hasFiles: boolean = entries.length > 0;

  useLayoutEffect(() => {
    selectionCallback.current?.(hasFiles);
  }, [hasFiles]);

  useEffect(() => {
    const controllers = previewControllers.current;
    const urls = previewUrls.current;
    return () => {
      submitController.current?.abort();
      controllers.forEach((controller: AbortController) => controller.abort());
      controllers.clear();
      urls.forEach((url: string) => URL.revokeObjectURL(url));
      urls.clear();
    };
  }, []);

  function replaceEntries(next: FileEntry[]): void {
    entriesRef.current = next;
    setEntries(next);
  }

  function updateEntry(
    id: number,
    patch: Partial<Pick<FileEntry, "preview" | "progress" | "quantity" | "quantityError">>,
  ): void {
    replaceEntries(
      entriesRef.current.map((entry: FileEntry) => (entry.id === id ? { ...entry, ...patch } : entry)),
    );
  }

  function setPreview(id: number, preview: PreviewState): void {
    updateEntry(id, { preview });
  }

  function setProgress(id: number, progress: QuoteProgress): void {
    updateEntry(id, { progress });
  }

  function startPreview(entry: FileEntry): void {
    const controller = new AbortController();
    previewControllers.current.set(entry.id, controller);
    previewLimiter.current
      .run(() => createPreview(entry.file, controller.signal), controller.signal)
      .then(
        (image: Blob) => {
          if (controller.signal.aborted) {
            return;
          }
          const url: string = URL.createObjectURL(image);
          previewUrls.current.set(entry.id, url);
          setPreview(entry.id, { kind: "ready", url });
        },
        () => {
          if (!controller.signal.aborted) {
            setPreview(entry.id, { kind: "failed" });
          }
        },
      )
      .finally(() => {
        previewControllers.current.delete(entry.id);
      });
  }

  function addFiles(files: File[], fromPicker: boolean): void {
    if (files.length === 0) {
      return;
    }
    const current: FileEntry[] = entriesRef.current;
    const added: FileEntry[] = [];
    const initialQuantity: string = current.length === 0 ? draftQuantity : DEFAULT_QUANTITY;
    let overCap: boolean = false;
    for (const file of files) {
      const duplicate: boolean = [...current, ...added].some(
        (entry: FileEntry) => entry.file.name === file.name && entry.file.size === file.size,
      );
      if (duplicate) {
        continue;
      }
      if (current.length + added.length >= MAX_FILES) {
        overCap = true;
        continue;
      }
      const validationError: string | null = validateFile(file);
      added.push({
        id: nextEntryId.current,
        file,
        validationError,
        quantity: initialQuantity,
        quantityError: null,
        preview: validationError === null ? { kind: "loading" } : { kind: "failed" },
        progress: { kind: "idle" },
      });
      nextEntryId.current += 1;
    }
    const inputBefore: HTMLInputElement | null = fileInput.current;
    flushSync(() => {
      replaceEntries([...current, ...added]);
      setFileError(overCap ? `You can add up to ${MAX_FILES} files at a time.` : null);
    });
    if (fromPicker && fileInput.current !== inputBefore) {
      (fileInput.current ?? submitButton.current)?.focus({ preventScroll: true });
    }
    added.filter((entry: FileEntry) => entry.validationError === null).forEach(startPreview);
  }

  function handleFileChange(event: ChangeEvent<HTMLInputElement>): void {
    const picked: File[] = Array.from(event.target.files ?? []);
    event.target.value = "";
    addFiles(picked, true);
  }

  function handleDragOver(event: DragEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (!submitting) {
      setDragging(true);
    }
  }

  function handleDragLeave(event: DragEvent<HTMLFormElement>): void {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
      setDragging(false);
    }
  }

  function handleDrop(event: DragEvent<HTMLFormElement>): void {
    event.preventDefault();
    setDragging(false);
    if (!submitting) {
      addFiles(Array.from(event.dataTransfer.files), false);
    }
  }

  function releasePreview(id: number): void {
    previewControllers.current.get(id)?.abort();
    previewControllers.current.delete(id);
    const url: string | undefined = previewUrls.current.get(id);
    if (url !== undefined) {
      URL.revokeObjectURL(url);
      previewUrls.current.delete(id);
    }
  }

  function removeEntry(id: number): void {
    releasePreview(id);
    const current: FileEntry[] = entriesRef.current;
    const index: number = current.findIndex((entry: FileEntry) => entry.id === id);
    const neighbor: FileEntry | undefined = current[index + 1] ?? current[index - 1];
    flushSync(() => {
      replaceEntries(current.filter((entry: FileEntry) => entry.id !== id));
      setFileError(null);
    });
    const nextFocus: HTMLElement | null =
      neighbor === undefined ? fileInput.current : document.getElementById(removeButtonId(neighbor.id));
    nextFocus?.focus();
  }

  function handlePreviewError(id: number): void {
    releasePreview(id);
    setPreview(id, { kind: "failed" });
  }

  function promptDiscard(): void {
    discardPrompted.current = true;
    setConfirmingDiscard(true);
  }

  function cancelDiscard(): void {
    discardPrompted.current = false;
    setConfirmingDiscard(false);
    if (resultsWaiting.current) {
      resultsWaiting.current = false;
      showResults();
    }
  }

  function discardSelection(): void {
    if (submitting) {
      createdCallback.current?.();
    }
    submitController.current?.abort();
    submitController.current = null;
    discardPrompted.current = false;
    resultsWaiting.current = false;
    entriesRef.current.forEach((entry: FileEntry) => releasePreview(entry.id));
    flushSync(() => {
      replaceEntries([]);
      setSubmitting(false);
      setDraftQuantity(DEFAULT_QUANTITY);
      setFileError(null);
      setDraftQuantityError(null);
      setConfirmingDiscard(false);
    });
    fileInput.current?.focus();
  }

  function handleDraftQuantityChange(value: string): void {
    setDraftQuantity(value);
    setDraftQuantityError(null);
  }

  function handleEntryQuantityChange(id: number, value: string): void {
    updateEntry(id, { quantity: value, quantityError: null });
  }

  function showResults(): void {
    const ids: number[] = entriesRef.current.flatMap((entry: FileEntry) =>
      entry.progress.kind === "done" ? [entry.progress.quote.id] : [],
    );
    navigate(ids.length === 1 ? `/quotes/${ids[0]}` : `/quotes/batch?ids=${ids.join(",")}`);
  }

  async function generateQuote(entry: FileEntry, controller: AbortController): Promise<void> {
    setProgress(entry.id, { kind: "running" });
    try {
      const quote: Quote = await createQuote(entry.file, Number(entry.quantity.trim()), controller.signal);
      if (controller.signal.aborted) {
        return;
      }
      setProgress(entry.id, { kind: "done", quote });
      createdCallback.current?.();
    } catch (error: unknown) {
      if (!controller.signal.aborted) {
        setProgress(entry.id, { kind: "failed", message: getErrorMessage(error) });
      }
    }
  }

  async function handleSubmit(
    event: SubmitEvent<HTMLFormElement>,
  ): Promise<void> {
    event.preventDefault();
    if (submitting) {
      return;
    }
    if (entriesRef.current.length === 0) {
      const nextDraftError: string | null = validateQuantity(draftQuantity);
      flushSync(() => {
        setFileError("Choose a STEP file to quote.");
        setDraftQuantityError(nextDraftError);
      });
      fileInput.current?.focus();
      return;
    }
    const validEntries: FileEntry[] = entriesRef.current.filter(
      (entry: FileEntry) => entry.validationError === null,
    );
    flushSync(() => setFileError(null));
    if (validEntries.length === 0) {
      fileInput.current?.focus();
      return;
    }

    const targets: FileEntry[] = validEntries.filter((entry: FileEntry) => entry.progress.kind !== "done");
    if (targets.length === 0) {
      showResults();
      return;
    }

    const targetIds: Set<number> = new Set(targets.map((entry: FileEntry) => entry.id));
    const checkedEntries: FileEntry[] = entriesRef.current.map((entry: FileEntry) =>
      targetIds.has(entry.id) ? { ...entry, quantityError: validateQuantity(entry.quantity) } : entry,
    );
    const firstInvalid: FileEntry | undefined = checkedEntries.find(
      (entry: FileEntry) => entry.quantityError !== null,
    );
    flushSync(() => replaceEntries(checkedEntries));
    if (firstInvalid !== undefined) {
      document.getElementById(quantityInputId(firstInvalid.id))?.focus();
      return;
    }

    const controller = new AbortController();
    submitController.current = controller;
    setSubmitting(true);
    targets.forEach((entry: FileEntry) => setProgress(entry.id, { kind: "queued" }));

    const limiter: Limiter = createLimiter(MAX_CONCURRENT_REQUESTS);
    await Promise.all(
      targets.map((entry: FileEntry) =>
        limiter.run(() => generateQuote(entry, controller), controller.signal).catch(() => undefined),
      ),
    );
    if (controller.signal.aborted) {
      return;
    }

    const allDone: boolean = entriesRef.current
      .filter((entry: FileEntry) => entry.validationError === null)
      .every((entry: FileEntry) => entry.progress.kind === "done");
    if (allDone) {
      if (discardPrompted.current) {
        resultsWaiting.current = true;
        return;
      }
      showResults();
      return;
    }
    flushSync(() => setSubmitting(false));
    if (document.activeElement === null || document.activeElement === document.body) {
      submitButton.current?.focus();
    }
  }

  const validCount: number = entries.filter((entry: FileEntry) => entry.validationError === null).length;
  const doneCount: number = entries.filter((entry: FileEntry) => entry.progress.kind === "done").length;
  const failedCount: number = entries.filter((entry: FileEntry) => entry.progress.kind === "failed").length;
  const partial: boolean = doneCount > 0 && failedCount > 0;
  const submitLabel: string = submitting ? "Analyzing…" : partial ? `Retry failed (${failedCount})` : "Generate Quote";

  const dropzone: JSX.Element = (
    <div
      className="dropzone"
      data-compact={hasFiles || undefined}
      data-invalid={fileError !== null}
      data-disabled={submitting}
    >
      <div className="dropzone-copy">
        {hasFiles && (
          <label className="micro-label" htmlFor="cad-file">
            CAD file
          </label>
        )}
        <strong>{hasFiles ? "Add more STEP files" : "Choose STEP files"}</strong>
        <span className="hint">or drop them here. .step or .stp, up to {MAX_FILES} files</span>
      </div>
      <input
        ref={fileInput}
        id="cad-file"
        className="dropzone-input"
        type="file"
        accept=".step,.stp"
        multiple
        disabled={submitting}
        aria-invalid={fileError !== null}
        aria-describedby={fileError === null ? undefined : "cad-file-error"}
        onChange={handleFileChange}
      />
    </div>
  );

  const fileErrorMessage: JSX.Element | null =
    fileError === null ? null : (
      <p id="cad-file-error" className="field-error" role="alert">
        {fileError}
      </p>
    );

  const submitControls: JSX.Element = (
    <div className="field field-submit">
      {partial && !submitting && (
        <button className="button button-quiet" type="button" onClick={showResults}>
          View results ({doneCount})
        </button>
      )}
      <button ref={submitButton} className="button" type="submit" disabled={submitting}>
        {submitLabel}
      </button>
    </div>
  );

  return (
    <>
      <div className="page-head">
        <div className="page-heading">
          {hasFiles && (
            <button
              className="icon-action back-button"
              type="button"
              aria-label="Back"
              onClick={promptDiscard}
            >
              <BackIcon />
            </button>
          )}
          <h1 className="page-title">New quote</h1>
        </div>
      </div>
      <form
        className={hasFiles ? "quote-form quote-set" : "sheet quote-form"}
        data-dragging={dragging || undefined}
        onSubmit={handleSubmit}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        noValidate
      >
        {hasFiles ? (
          <>
            <ul className="file-list" aria-label="Selected files">
              {entries.map((entry: FileEntry) => (
                <FileBox
                  key={entry.id}
                  entry={entry}
                  disabled={submitting}
                  onRemove={() => removeEntry(entry.id)}
                  onPreviewError={() => handlePreviewError(entry.id)}
                  onQuantityChange={(value: string) => handleEntryQuantityChange(entry.id, value)}
                />
              ))}
              {entries.length < MAX_FILES && <li className="file-add">{dropzone}</li>}
            </ul>
            <div className="sheet quote-set-actions">
              {fileErrorMessage}
              {submitControls}
              {submitting && <AnalysisProgress total={validCount} finished={doneCount} />}
            </div>
          </>
        ) : (
          <>
            <div className="field">
              <label className="micro-label" htmlFor="cad-file">
                CAD file
              </label>
              {dropzone}
              {fileErrorMessage}
            </div>

            <div className="form-row">
              <div className="field">
                <label className="micro-label" htmlFor="quantity">
                  Quantity
                </label>
                <QuantityStepper
                  id="quantity"
                  value={draftQuantity}
                  disabled={submitting}
                  invalid={draftQuantityError !== null}
                  describedBy={draftQuantityError === null ? undefined : "quantity-error"}
                  decreaseLabel="Decrease quantity"
                  increaseLabel="Increase quantity"
                  onChange={handleDraftQuantityChange}
                />
                {draftQuantityError !== null && (
                  <p id="quantity-error" className="field-error" role="alert">
                    {draftQuantityError}
                  </p>
                )}
              </div>
              {submitControls}
            </div>
          </>
        )}
      </form>
      {confirmingDiscard && (
        <ConfirmDialog
          title="Discard this quote?"
          cancelLabel="Keep working"
          confirmLabel="Discard"
          onCancel={cancelDiscard}
          onConfirm={discardSelection}
        >
          <p>Going back discards your selected files and any results in progress.</p>
        </ConfirmDialog>
      )}
    </>
  );
}
