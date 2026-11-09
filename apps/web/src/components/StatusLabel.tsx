import type { JSX } from "react";
import type { QuoteStatus } from "../api";
import { formatStatus } from "../format";
import { CheckIcon } from "./icons";

export function StatusLabel({ status }: { status: QuoteStatus }): JSX.Element {
  return (
    <span className="status-label" data-status={status}>
      {status === "reviewed" && <CheckIcon />}
      {formatStatus(status)}
    </span>
  );
}
