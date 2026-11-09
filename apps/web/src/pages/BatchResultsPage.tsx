import { useEffect, useMemo, useState } from "react";
import type { JSX } from "react";
import { Link, useSearchParams } from "react-router";
import { getQuote } from "../api";
import type { Quote } from "../api";
import { Notice } from "../components/Notice";
import { QuoteThumbnail } from "../components/QuoteThumbnail";
import { formatLeadTime, formatNumber, formatUsd } from "../format";

function parseIds(text: string | null): number[] {
  const ids: number[] = (text ?? "")
    .split(",")
    .filter((part: string) => /^[1-9]\d*$/.test(part))
    .map(Number)
    .filter(Number.isSafeInteger);
  return [...new Set(ids)];
}

type LoadState = { kind: "loading" } | { kind: "ready"; quotes: Quote[]; missing: number };

function BatchCard({ quote }: { quote: Quote }): JSX.Element {
  return (
    <li className="batch-card">
      <QuoteThumbnail quoteId={quote.id} fileName={quote.file} />
      <h2 className="batch-file">
        <Link to={`/quotes/${quote.id}`}>{quote.file}</Link>
      </h2>
      <dl className="batch-figures">
        <div>
          <dt className="micro-label">Quantity</dt>
          <dd>{formatNumber(quote.quantity)}</dd>
        </div>
        <div>
          <dt className="micro-label">Per-unit cost</dt>
          <dd>{formatUsd(quote.cost_breakdown.total_cost_per_unit)}</dd>
        </div>
        <div>
          <dt className="micro-label">Total cost</dt>
          <dd>{formatUsd(quote.cost_breakdown.total_order_cost)}</dd>
        </div>
        <div>
          <dt className="micro-label">Lead time</dt>
          <dd>{formatLeadTime(quote.lead_time_days)}</dd>
        </div>
      </dl>
    </li>
  );
}

export function BatchResultsPage(): JSX.Element {
  const [searchParams] = useSearchParams();
  const idsParam: string | null = searchParams.get("ids");
  const ids: number[] = useMemo(() => parseIds(idsParam), [idsParam]);
  const [state, setState] = useState<LoadState>({ kind: "loading" });

  useEffect(() => {
    const controller = new AbortController();
    Promise.allSettled(ids.map((id: number) => getQuote(id, controller.signal))).then(
      (results: Array<PromiseSettledResult<Quote>>) => {
        if (controller.signal.aborted) {
          return;
        }
        const quotes: Quote[] = results.flatMap((result: PromiseSettledResult<Quote>) =>
          result.status === "fulfilled" ? [result.value] : [],
        );
        setState({ kind: "ready", quotes, missing: results.length - quotes.length });
      },
    );
    return () => controller.abort();
  }, [ids]);

  if (state.kind === "loading") {
    return <Notice title="Loading quotes…" role="status" />;
  }
  if (state.quotes.length === 0) {
    return (
      <Notice title="No quotes to show">
        <Link to="/">Back to home</Link>
      </Notice>
    );
  }

  return (
    <>
      <div className="page-head">
        <h1 className="page-title">
          {state.quotes.length} {state.quotes.length === 1 ? "quote" : "quotes"} created
        </h1>
        <Link to="/" className="back-link">
          ← Home
        </Link>
      </div>
      {state.missing > 0 && (
        <p className="form-error batch-missing" role="alert">
          {state.missing} {state.missing === 1 ? "quote" : "quotes"} could not be loaded.
        </p>
      )}
      <ul className="batch-grid">
        {state.quotes.map((quote: Quote) => (
          <BatchCard key={quote.id} quote={quote} />
        ))}
      </ul>
    </>
  );
}
