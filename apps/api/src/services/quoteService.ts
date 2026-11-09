import type { NewQuote, QuoteRepository, StoredQuote } from "../db/quoteRepository.js";
import type { GeometryAnalysis, Quote, QuoteStatus } from "../types.js";
import type { AnalyzeGeometry } from "./geometryService.js";
import type { PreviewService } from "./previewService.js";
import { MATERIAL_NAME, calculateQuote } from "./pricingService.js";
import type { QuoteCalculation } from "./pricingService.js";

export interface QuoteServiceDeps {
  repository: QuoteRepository;
  analyzeGeometry: AnalyzeGeometry;
  previews?: PreviewService;
}

export interface CreateQuoteInput {
  fileName: string;
  filePath: string;
  quantity: number;
}

function toQuote(stored: StoredQuote): Quote {
  return {
    file: stored.file,
    quantity: stored.quantity,
    material: MATERIAL_NAME,
    geometry: stored.geometry,
    features: stored.features,
    cost_breakdown: stored.cost_breakdown,
    lead_time_days: stored.lead_time_days,
    id: stored.id,
    status: stored.status,
    created_at: stored.created_at,
  };
}

export async function createQuote(
  { repository, analyzeGeometry }: QuoteServiceDeps,
  { fileName, filePath, quantity }: CreateQuoteInput,
): Promise<Quote> {
  const { geometry, features }: GeometryAnalysis = await analyzeGeometry(filePath);
  const { costBreakdown, leadTimeDays }: QuoteCalculation = calculateQuote({
    geometry,
    features,
    quantity,
  });
  const newQuote: NewQuote = {
    file: fileName,
    quantity,
    geometry,
    features,
    cost_breakdown: costBreakdown,
    lead_time_days: leadTimeDays,
    created_at: new Date().toISOString(),
  };
  return toQuote(repository.insertQuote(newQuote));
}

export function listQuotes({ repository }: QuoteServiceDeps): Quote[] {
  return repository.listQuotes().map(toQuote);
}

export function findQuote({ repository }: QuoteServiceDeps, id: number): Quote | null {
  const stored: StoredQuote | null = repository.findQuote(id);
  return stored ? toQuote(stored) : null;
}

export function updateQuoteStatus(
  { repository }: QuoteServiceDeps,
  id: number,
  status: QuoteStatus,
): Quote | null {
  const stored: StoredQuote | null = repository.updateQuoteStatus(id, status);
  return stored ? toQuote(stored) : null;
}
