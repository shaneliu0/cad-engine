import { useEffect, useRef, useState } from "react";
import type { JSX, ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { ApiError, getErrorMessage, getQuote, listQuotes, updateQuoteStatus } from "../api";
import type { Quote } from "../api";
import { BackIcon, ForwardIcon } from "../components/icons";
import { Notice } from "../components/Notice";
import { StatusLabel } from "../components/StatusLabel";
import { StepViewer } from "../components/StepViewer";
import { useWideLayout } from "../hooks/useWideLayout";
import {
  formatDate,
  formatLeadTime,
  formatNumber,
  formatUsd,
} from "../format";

type LoadState =
  | { kind: "loading" }
  | { kind: "notFound" }
  | { kind: "error"; message: string }
  | { kind: "ready"; quote: Quote };

function QuoteNotFound(): JSX.Element {
  const wide = useWideLayout();
  return (
    <Notice title="Quote not found">
      <p>This quote does not exist or is no longer available.</p>
      {wide ? (
        <Link to="/">Back to home</Link>
      ) : (
        <Link to="/quotes">Back to history</Link>
      )}
    </Notice>
  );
}

interface CellProps {
  label: string;
  children: ReactNode;
  className?: string;
}

function Cell({ label, children, className }: CellProps): JSX.Element {
  return (
    <div className={className === undefined ? "cell" : `cell ${className}`}>
      <dt className="micro-label">{label}</dt>
      <dd className="cell-value">{children}</dd>
    </div>
  );
}

function Measure({ value, unit }: { value: number; unit: string }): JSX.Element {
  return (
    <>
      {formatNumber(value)} <span className="unit">{unit}</span>
    </>
  );
}

function BoundingBoxKey(): JSX.Element {
  return (
    <svg className="bbox-key" viewBox="0 0 210 150" aria-hidden="true">
      <path className="bbox-face-top" d="M30 42 100 4l70 38-70 38z" />
      <path className="bbox-face-left" d="M30 42l70 38v50L30 92z" />
      <path className="bbox-face-right" d="M100 80l70-38v50l-70 38z" />
      <path className="bbox-edge" d="M30 42 100 4l70 38v50l-70 38-70-38zM30 42l70 38 70-38M100 80v50" />
      <path className="bbox-dim" d="M22 107l70 38M108 145l70-38M186 42v50M181 42h10M181 92h10" />
      <text className="bbox-letter" x="44" y="139">L</text>
      <text className="bbox-letter" x="150" y="139">W</text>
      <text className="bbox-letter" x="195" y="72">H</text>
    </svg>
  );
}

function ResultTopLine({ id }: { id: number }): JSX.Element {
  const wide = useWideLayout();
  const navigate = useNavigate();
  const [quotes, setQuotes] = useState<Quote[] | null>(null);
  const previousButton = useRef<HTMLButtonElement>(null);
  const nextButton = useRef<HTMLButtonElement>(null);
  const lastPressed = useRef<"previous" | "next" | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    listQuotes(controller.signal).then(
      (loaded: Quote[]) => {
        if (!controller.signal.aborted) {
          setQuotes(loaded);
        }
      },
      () => undefined,
    );
    return () => controller.abort();
  }, []);

  const current: Quote | undefined = quotes?.find((quote: Quote) => quote.id === id);
  const peers: Quote[] =
    quotes === null || current === undefined
      ? []
      : quotes.filter(
          (quote: Quote) => (quote.status === "archived") === (current.status === "archived"),
        );
  const index: number = peers.findIndex((quote: Quote) => quote.id === id);
  const previous: Quote | undefined = index > 0 ? peers[index - 1] : undefined;
  const next: Quote | undefined = index >= 0 ? peers[index + 1] : undefined;
  const atStart: boolean = previous === undefined;
  const atEnd: boolean = next === undefined;

  useEffect(() => {
    if (lastPressed.current === "previous" && atStart) {
      nextButton.current?.focus();
    }
    if (lastPressed.current === "next" && atEnd) {
      previousButton.current?.focus();
    }
    lastPressed.current = null;
  }, [atStart, atEnd, id]);

  function moveTo(target: Quote | undefined, direction: "previous" | "next"): void {
    if (target !== undefined) {
      lastPressed.current = direction;
      navigate(`/quotes/${target.id}`);
    }
  }

  return (
    <div className="result-topline">
      <Link to={wide ? "/" : "/quotes"} className="back-link">
        {wide ? "← Home" : "← History"}
      </Link>
      <div className="quote-nav">
        <button
          ref={previousButton}
          className="icon-action"
          type="button"
          disabled={atStart}
          aria-label="Previous quote"
          data-tooltip="Previous quote"
          onClick={() => moveTo(previous, "previous")}
        >
          <BackIcon />
        </button>
        <button
          ref={nextButton}
          className="icon-action"
          type="button"
          disabled={atEnd}
          aria-label="Next quote"
          data-tooltip="Next quote"
          onClick={() => moveTo(next, "next")}
        >
          <ForwardIcon />
        </button>
      </div>
    </div>
  );
}

function QuoteDetail({ id }: { id: number }): JSX.Element {
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [attempt, setAttempt] = useState<number>(0);

  useEffect(() => {
    const controller = new AbortController();
    setState((current: LoadState) =>
      current.kind === "ready" ? current : { kind: "loading" },
    );
    getQuote(id, controller.signal).then(
      (quote: Quote) => {
        if (controller.signal.aborted) {
          return;
        }
        setState({ kind: "ready", quote });
        if (quote.status !== "quoted") {
          return;
        }
        updateQuoteStatus(id, "reviewed").then(
          (updated: Quote) => {
            if (!controller.signal.aborted) {
              setState({ kind: "ready", quote: updated });
            }
          },
          () => undefined,
        );
      },
      (error: unknown) => {
        if (controller.signal.aborted) {
          return;
        }
        if (error instanceof ApiError && error.status === 404) {
          setState({ kind: "notFound" });
        } else {
          setState({ kind: "error", message: getErrorMessage(error) });
        }
      },
    );
    return () => controller.abort();
  }, [id, attempt]);

  if (state.kind === "loading") {
    return <Notice title="Loading quote…" role="status" />;
  }
  if (state.kind === "notFound") {
    return <QuoteNotFound />;
  }
  if (state.kind === "error") {
    return (
      <Notice title="Could not load this quote" role="alert">
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
      </Notice>
    );
  }

  const { quote } = state;
  const { bounding_box_mm: boundingBox, volume_cm3, surface_area_cm2 } =
    quote.geometry;
  const { face_count, edge_count, holes_detected, complexity_score } =
    quote.features;
  const cost = quote.cost_breakdown;

  return (
    <>
      <div className="page-head result-head">
        <div className="result-heading">
          <h1 className="page-title result-file">{quote.file}</h1>
          <p className="hint">
            Quote {quote.id}. Created {formatDate(quote.created_at)}
          </p>
        </div>
        <div className="result-status">
          <span className="micro-label">Status</span>
          <StatusLabel status={quote.status} />
        </div>
      </div>

      <div className="sheet">
        <dl className="cells cells-summary">
          <Cell label="Total cost" className="cell-total">
            {formatUsd(cost.total_order_cost)}
          </Cell>
          <Cell label="Per-unit cost">
            {formatUsd(cost.total_cost_per_unit)}
          </Cell>
          <Cell label="Quantity">{formatNumber(quote.quantity)}</Cell>
          <Cell label="Material">{quote.material}</Cell>
          <Cell label="Lead time">{formatLeadTime(quote.lead_time_days)}</Cell>
        </dl>

        <h2 className="band">3D model</h2>
        <StepViewer key={quote.id} quote={quote} />

        <h2 className="band">Cost breakdown</h2>
        <dl className="cells cells-costs">
          <Cell label="Material (per unit)">
            {formatUsd(cost.material_cost_per_unit)}
          </Cell>
          <Cell label="Machine time (per unit)">
            {formatUsd(cost.machine_time_cost_per_unit)}
          </Cell>
          <Cell label="Setup (per unit)">
            {formatUsd(cost.setup_cost_per_unit)}
          </Cell>
        </dl>

        <h2 className="band">Geometry</h2>
        <div className="geometry">
          <BoundingBoxKey />
          <dl className="cells cells-geometry">
            <Cell label="Length" className="span-2">
              <Measure value={boundingBox.length} unit="mm" />
            </Cell>
            <Cell label="Width" className="span-2">
              <Measure value={boundingBox.width} unit="mm" />
            </Cell>
            <Cell label="Height" className="span-2">
              <Measure value={boundingBox.height} unit="mm" />
            </Cell>
            <Cell label="Volume" className="span-3">
              <Measure value={volume_cm3} unit="cm³" />
            </Cell>
            <Cell label="Surface area" className="span-3">
              <Measure value={surface_area_cm2} unit="cm²" />
            </Cell>
          </dl>
        </div>

        <h2 className="band">Detected features</h2>
        <dl className="cells cells-features">
          <Cell label="Face count">{formatNumber(face_count)}</Cell>
          <Cell label="Edge count">{formatNumber(edge_count)}</Cell>
          <Cell label="Holes detected">{formatNumber(holes_detected)}</Cell>
          <Cell label="Complexity score">{formatNumber(complexity_score)}</Cell>
        </dl>
      </div>
    </>
  );
}

export function QuoteResultPage(): JSX.Element {
  const { id } = useParams<{ id: string }>();
  const quoteId = id !== undefined && /^[1-9]\d*$/.test(id) ? Number(id) : NaN;
  if (!Number.isSafeInteger(quoteId)) {
    return <QuoteNotFound />;
  }
  return (
    <>
      <ResultTopLine id={quoteId} />
      <QuoteDetail id={quoteId} />
    </>
  );
}
