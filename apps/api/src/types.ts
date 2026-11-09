import type { Quote, QuoteStatus } from "@cad-quote/contract";

export type { Quote, QuoteStatus };

export const QUOTE_STATUSES = ["quoted", "reviewed", "archived"] as const satisfies readonly QuoteStatus[];

export type Geometry = Quote["geometry"];
export type Features = Quote["features"];
export type CostBreakdown = Quote["cost_breakdown"];

export interface GeometryAnalysis {
  geometry: Geometry;
  features: Features;
}
