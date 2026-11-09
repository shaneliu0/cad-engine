import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { JSX, MouseEvent, Ref } from "react";
import { AnimatePresence, motion } from "motion/react";
import type { Transition } from "motion/react";
import { Link } from "react-router";
import { getErrorMessage, listQuotes, updateQuoteStatus } from "../api";
import type { Quote, QuoteStatus } from "../api";
import { ArchiveIcon, CheckIcon } from "../components/icons";
import { Notice } from "../components/Notice";
import { QuoteThumbnail } from "../components/QuoteThumbnail";
import { StatusLabel } from "../components/StatusLabel";
import { useReducedMotion } from "../hooks/useReducedMotion";
import {
  formatDate,
  formatLeadTime,
  formatNumber,
  formatUsd,
} from "../format";

const ROW_SECONDS: number = 0.3;
const ROW_EASE: [number, number, number, number] = [0.4, 0, 0.2, 1];
const ROW_EASING_CSS: string = `cubic-bezier(${ROW_EASE.join(", ")})`;

type LoadState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; quotes: Quote[] };

type HistoryView = "active" | "archived";

interface QuoteHistoryPageProps {
  variant?: "page" | "panel";
  refreshToken?: number;
}

interface HistoryRowProps {
  ref?: Ref<HTMLTableRowElement>;
  quote: Quote;
  showActions: boolean;
  reviewing: boolean;
  error: string | undefined;
  transition: Transition;
  animateLayout: boolean;
  onReview: () => void;
  onArchive: (button: HTMLButtonElement) => void;
}

function freezeRowColumns(row: HTMLTableRowElement): void {
  const widths: string[] = Array.from(
    row.cells,
    (cell: HTMLTableCellElement) => `${cell.getBoundingClientRect().width}px`,
  );
  row.style.setProperty("--row-columns", widths.join(" "));
}

function HistoryRow({
  ref,
  quote,
  showActions,
  reviewing,
  error,
  transition,
  animateLayout,
  onReview,
  onArchive,
}: HistoryRowProps): JSX.Element {
  const reviewed: boolean = quote.status === "reviewed";
  return (
    <motion.tr
      ref={ref}
      data-quote-id={quote.id}
      layout={animateLayout ? "position" : false}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -18 }}
      transition={transition}
    >
      <td className="history-thumb">
        <QuoteThumbnail quoteId={quote.id} fileName={quote.file} />
      </td>
      <td className="history-file">
        <Link to={`/quotes/${quote.id}`}>{quote.file}</Link>
      </td>
      <td className="numeric" data-label="Quantity">
        {formatNumber(quote.quantity)}
      </td>
      <td className="numeric history-total" data-label="Total cost">
        {formatUsd(quote.cost_breakdown.total_order_cost)}
      </td>
      <td className="numeric" data-label="Lead time">
        {formatLeadTime(quote.lead_time_days)}
      </td>
      <td className="history-date" data-label="Created">
        {formatDate(quote.created_at)}
      </td>
      <td className="history-status" data-label="Status">
        <StatusLabel status={quote.status} />
        {error !== undefined && (
          <p className="status-error" role="alert">
            {error}
          </p>
        )}
      </td>
      {showActions && (
        <td className="history-actions">
          <div className="icon-actions">
            <button
              className={reviewed ? "icon-action is-complete" : "icon-action"}
              type="button"
              aria-pressed={reviewed}
              aria-busy={reviewing}
              aria-label={`Mark ${quote.file} as ${reviewed ? "unreviewed" : "reviewed"}`}
              data-tooltip={reviewed ? "Mark as unreviewed" : "Mark as reviewed"}
              data-action="review"
              onClick={onReview}
            >
              <CheckIcon />
            </button>
            <button
              className="icon-action"
              type="button"
              disabled={reviewing}
              aria-label={`Archive ${quote.file}`}
              data-tooltip="Archive"
              data-action="archive"
              onClick={(event: MouseEvent<HTMLButtonElement>) => onArchive(event.currentTarget)}
            >
              <ArchiveIcon />
            </button>
          </div>
        </td>
      )}
    </motion.tr>
  );
}

export function QuoteHistoryPage({
  variant = "page",
  refreshToken = 0,
}: QuoteHistoryPageProps): JSX.Element {
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [attempt, setAttempt] = useState<number>(0);
  const [view, setView] = useState<HistoryView>("active");
  const [archivingIds, setArchivingIds] = useState<ReadonlySet<number>>(new Set());
  const [reviewingIds, setReviewingIds] = useState<ReadonlySet<number>>(new Set());
  const [rowErrors, setRowErrors] = useState<Readonly<Record<number, string>>>({});
  const [announcement, setAnnouncement] = useState<string>("");
  const [rowsExiting, setRowsExiting] = useState<boolean>(false);
  const inFlightIds = useRef<Set<number>>(new Set());
  const titleRef = useRef<HTMLHeadingElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const sheetHeightBeforeChange = useRef<number | null>(null);
  const reducedMotion = useReducedMotion();

  useLayoutEffect(() => {
    const sheet: HTMLDivElement | null = sheetRef.current;
    const before: number | null = sheetHeightBeforeChange.current;
    sheetHeightBeforeChange.current = null;
    if (sheet === null || before === null || reducedMotion) {
      return;
    }
    sheet.getAnimations?.().forEach((animation: Animation) => animation.cancel());
    const after: number = sheet.getBoundingClientRect().height;
    if (Math.abs(after - before) > 0.5) {
      sheet.animate?.(
        { height: [`${before}px`, `${after}px`] },
        { duration: ROW_SECONDS * 1000, easing: ROW_EASING_CSS },
      );
    }
  });

  useEffect(() => {
    const controller = new AbortController();
    listQuotes(controller.signal).then(
      (quotes: Quote[]) => setState({ kind: "ready", quotes }),
      (error: unknown) => {
        if (!controller.signal.aborted) {
          setState({ kind: "error", message: getErrorMessage(error) });
        }
      },
    );
    return () => controller.abort();
  }, [attempt, refreshToken]);

  const inPanel: boolean = variant === "panel";
  const noticeLevel: 1 | 3 = inPanel ? 3 : 1;
  const Title = inPanel ? "h2" : "h1";

  function withPanelHeading(notice: JSX.Element): JSX.Element {
    if (!inPanel) {
      return notice;
    }
    return (
      <>
        <div className="page-head">
          <Title className="page-title">Quote history</Title>
        </div>
        {notice}
      </>
    );
  }

  if (state.kind === "loading") {
    return withPanelHeading(
      <Notice title="Loading quotes…" role="status" level={noticeLevel} />,
    );
  }
  if (state.kind === "error") {
    return withPanelHeading(
      <Notice title="Could not load quotes" role="alert" level={noticeLevel}>
        <p>{state.message}</p>
        <button
          className="button button-quiet"
          type="button"
          onClick={() => {
            setState({ kind: "loading" });
            setAttempt((current: number) => current + 1);
          }}
        >
          Try again
        </button>
      </Notice>,
    );
  }

  const archivedQuotes: Quote[] = state.quotes
    .filter((quote: Quote) => quote.status === "archived" || archivingIds.has(quote.id))
    .map((quote: Quote) => ({ ...quote, status: "archived" as const }));
  const activeQuotes: Quote[] = state.quotes.filter(
    (quote: Quote) => quote.status !== "archived" && !archivingIds.has(quote.id),
  );
  const hasQuotes: boolean = state.quotes.length > 0;
  const showingArchived: boolean = view === "archived";
  const visibleQuotes: Quote[] = showingArchived ? archivedQuotes : activeQuotes;
  const showEmptyNotice: boolean = visibleQuotes.length === 0 && !rowsExiting;

  function switchView(): void {
    setRowsExiting(false);
    setView(showingArchived ? "active" : "archived");
  }

  function replaceQuote(updated: Quote): void {
    setState((current: LoadState) =>
      current.kind === "ready"
        ? {
            kind: "ready",
            quotes: current.quotes.map((quote: Quote) =>
              quote.id === updated.id ? updated : quote,
            ),
          }
        : current,
    );
  }

  function rememberSheetHeight(): void {
    sheetHeightBeforeChange.current = sheetRef.current?.getBoundingClientRect().height ?? null;
  }

  function clearRowError(id: number): void {
    setRowErrors((current: Readonly<Record<number, string>>) => {
      const { [id]: _removed, ...remaining } = current;
      return remaining;
    });
  }

  function reportRowError(id: number, error: unknown): void {
    setRowErrors((current: Readonly<Record<number, string>>) => ({
      ...current,
      [id]: `Status not saved. ${getErrorMessage(error)}`,
    }));
  }

  function withoutId(ids: ReadonlySet<number>, id: number): ReadonlySet<number> {
    const next = new Set(ids);
    next.delete(id);
    return next;
  }

  function moveFocusFromArchivedRow(quote: Quote, button: HTMLButtonElement): void {
    const index: number = activeQuotes.findIndex((active: Quote) => active.id === quote.id);
    const neighbour: Quote | undefined = activeQuotes[index + 1] ?? activeQuotes[index - 1];
    const target: HTMLButtonElement | null | undefined =
      neighbour === undefined
        ? null
        : button
            .closest("tbody")
            ?.querySelector<HTMLButtonElement>(
              `tr[data-quote-id="${neighbour.id}"] [data-action="archive"]`,
            );
    (target ?? titleRef.current)?.focus();
  }

  async function toggleReviewed(quote: Quote): Promise<void> {
    if (inFlightIds.current.has(quote.id)) {
      return;
    }
    inFlightIds.current.add(quote.id);
    const nextStatus: QuoteStatus = quote.status === "reviewed" ? "quoted" : "reviewed";
    clearRowError(quote.id);
    setAnnouncement("");
    setReviewingIds((current: ReadonlySet<number>) => new Set(current).add(quote.id));
    try {
      replaceQuote(await updateQuoteStatus(quote.id, nextStatus));
      setAnnouncement(
        `${quote.file} marked ${nextStatus === "reviewed" ? "reviewed" : "unreviewed"}.`,
      );
    } catch (error: unknown) {
      reportRowError(quote.id, error);
    }
    setReviewingIds((current: ReadonlySet<number>) => withoutId(current, quote.id));
    inFlightIds.current.delete(quote.id);
  }

  async function archive(quote: Quote, button: HTMLButtonElement): Promise<void> {
    if (inFlightIds.current.has(quote.id)) {
      return;
    }
    inFlightIds.current.add(quote.id);
    const row: HTMLTableRowElement | null = button.closest("tr");
    if (row !== null) {
      freezeRowColumns(row);
    }
    moveFocusFromArchivedRow(quote, button);
    clearRowError(quote.id);
    setAnnouncement("");
    setRowsExiting(true);
    rememberSheetHeight();
    setArchivingIds((current: ReadonlySet<number>) => new Set(current).add(quote.id));
    try {
      replaceQuote(await updateQuoteStatus(quote.id, "archived"));
      setAnnouncement(`${quote.file} archived.`);
    } catch (error: unknown) {
      reportRowError(quote.id, error);
      rememberSheetHeight();
    }
    setArchivingIds((current: ReadonlySet<number>) => withoutId(current, quote.id));
    inFlightIds.current.delete(quote.id);
  }

  const rowTransition: Transition = reducedMotion
    ? { duration: 0 }
    : { duration: ROW_SECONDS, ease: ROW_EASE };

  return (
    <>
      <div className="page-head">
        <Title ref={titleRef} tabIndex={-1} className="page-title">
          {showingArchived ? "Archived quotes" : "Quote history"}
        </Title>
        <div className="history-tools">
          {visibleQuotes.length > 0 && (
            <p className="hint">
              {visibleQuotes.length} {visibleQuotes.length === 1 ? "quote" : "quotes"}
            </p>
          )}
          {(hasQuotes || showingArchived) && (
            <button
              className="button button-quiet history-switch"
              type="button"
              onClick={switchView}
            >
              {showingArchived ? "Back to quotes" : `View archived (${archivedQuotes.length})`}
            </button>
          )}
        </div>
      </div>
      <span className="visually-hidden" aria-live="polite" aria-atomic="true">
        {announcement}
      </span>
      {showEmptyNotice ? (
        <div className="history-empty">
          {showingArchived ? (
            <Notice title="No archived quotes" level={noticeLevel}>
              <p>Quotes you archive will appear here.</p>
            </Notice>
          ) : hasQuotes ? (
            <Notice title="No active quotes" level={noticeLevel}>
              <p>Every quote has been archived.</p>
            </Notice>
          ) : (
            <Notice title="No quotes yet" level={noticeLevel}>
              {inPanel ? (
                <p>Quotes you create will appear here.</p>
              ) : (
                <Link to="/">Create your first quote</Link>
              )}
            </Notice>
          )}
        </div>
      ) : (
        <div ref={sheetRef} className={inPanel ? "sheet history-sheet history-sheet-panel" : "sheet history-sheet"}>
          <table className="history">
            <thead>
              <tr>
                <th scope="col" className="history-thumb-head">
                  <span className="visually-hidden">Preview</span>
                </th>
                <th scope="col">File</th>
                <th scope="col" className="numeric">Quantity</th>
                <th scope="col" className="numeric">Total cost</th>
                <th scope="col" className="numeric">Lead time</th>
                <th scope="col">Created</th>
                <th scope="col">Status</th>
                {!showingArchived && (
                  <th scope="col" className="history-actions-head">
                    <span className="visually-hidden">Actions</span>
                  </th>
                )}
              </tr>
            </thead>
            <tbody key={view}>
              <AnimatePresence
                initial={false}
                mode="popLayout"
                onExitComplete={() => setRowsExiting(false)}
              >
                {visibleQuotes.map((quote: Quote) => (
                  <HistoryRow
                    key={quote.id}
                    quote={quote}
                    showActions={!showingArchived}
                    reviewing={reviewingIds.has(quote.id)}
                    error={rowErrors[quote.id]}
                    transition={rowTransition}
                    animateLayout={!reducedMotion}
                    onReview={() => void toggleReviewed(quote)}
                    onArchive={(button: HTMLButtonElement) => void archive(quote, button)}
                  />
                ))}
              </AnimatePresence>
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
