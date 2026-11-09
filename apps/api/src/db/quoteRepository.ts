import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import Database from "better-sqlite3";
import type { CostBreakdown, Features, Geometry, Quote, QuoteStatus } from "../types.js";

const DEFAULT_DATABASE_PATH: string = resolve(import.meta.dirname, "../../data/quotes.db");

export function quotesTableSql(tableName: string): string {
  return `
  CREATE TABLE IF NOT EXISTS ${tableName} (
    id INTEGER PRIMARY KEY,
    file_name TEXT NOT NULL,
    quantity INTEGER NOT NULL,
    geometry_results TEXT NOT NULL,
    feature_results TEXT NOT NULL,
    cost_breakdown TEXT NOT NULL,
    lead_time_days INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'quoted' CHECK (status IN ('quoted', 'reviewed', 'archived'))
  )
`;
}

export function resolveDatabasePath(): string {
  return process.env.QUOTES_DB_PATH ?? DEFAULT_DATABASE_PATH;
}

export type StoredQuote = Omit<Quote, "material">;
export type NewQuote = Omit<StoredQuote, "id" | "status">;

export interface QuoteRepository {
  insertQuote(quote: NewQuote): StoredQuote;
  listQuotes(): StoredQuote[];
  findQuote(id: number): StoredQuote | null;
  updateQuoteStatus(id: number, status: QuoteStatus): StoredQuote | null;
  close(): void;
}

interface QuoteRow {
  id: number;
  file_name: string;
  quantity: number;
  geometry_results: string;
  feature_results: string;
  cost_breakdown: string;
  lead_time_days: number;
  created_at: string;
  status: QuoteStatus;
}

function toStoredQuote(row: QuoteRow): StoredQuote {
  return {
    file: row.file_name,
    quantity: row.quantity,
    geometry: JSON.parse(row.geometry_results) as Geometry,
    features: JSON.parse(row.feature_results) as Features,
    cost_breakdown: JSON.parse(row.cost_breakdown) as CostBreakdown,
    lead_time_days: row.lead_time_days,
    id: row.id,
    status: row.status,
    created_at: row.created_at,
  };
}

export function openQuoteRepository(
  databasePath: string = resolveDatabasePath(),
): QuoteRepository {
  mkdirSync(dirname(databasePath), { recursive: true });
  const db: Database.Database = new Database(databasePath);
  db.exec(quotesTableSql("quotes"));

  const insert = db.prepare<[string, number, string, string, string, number, string], QuoteRow>(`
    INSERT INTO quotes
      (file_name, quantity, geometry_results, feature_results, cost_breakdown, lead_time_days, created_at, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'quoted')
    RETURNING *
  `);
  const selectAll = db.prepare<[], QuoteRow>("SELECT * FROM quotes ORDER BY id DESC");
  const selectOne = db.prepare<[number], QuoteRow>("SELECT * FROM quotes WHERE id = ?");
  const updateStatus = db.prepare<[QuoteStatus, number], QuoteRow>(
    "UPDATE quotes SET status = ? WHERE id = ? RETURNING *",
  );

  return {
    insertQuote(quote: NewQuote): StoredQuote {
      const row: QuoteRow = insert.get(
        quote.file,
        quote.quantity,
        JSON.stringify(quote.geometry),
        JSON.stringify(quote.features),
        JSON.stringify(quote.cost_breakdown),
        quote.lead_time_days,
        quote.created_at,
      ) as QuoteRow;
      return toStoredQuote(row);
    },

    listQuotes(): StoredQuote[] {
      return selectAll.all().map(toStoredQuote);
    },

    findQuote(id: number): StoredQuote | null {
      const row: QuoteRow | undefined = selectOne.get(id);
      return row ? toStoredQuote(row) : null;
    },

    updateQuoteStatus(id: number, status: QuoteStatus): StoredQuote | null {
      const row: QuoteRow | undefined = updateStatus.get(status, id);
      return row ? toStoredQuote(row) : null;
    },

    close(): void {
      db.close();
    },
  };
}
