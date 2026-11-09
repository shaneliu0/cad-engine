import { existsSync } from "node:fs";
import Database from "better-sqlite3";
import { quotesTableSql } from "./quoteRepository.js";

const REBUILD_TABLE: string = "quotes_rebuild";
const COPY_COLUMNS: string =
  "id, file_name, quantity, geometry_results, feature_results, cost_breakdown, lead_time_days, created_at";

interface TableDefinition {
  sql: string;
}

function hasRetiredStatus(definition: TableDefinition | undefined): boolean {
  return definition !== undefined && /'new'/.test(definition.sql);
}

export function migrateQuoteStatuses(databasePath: string): boolean {
  if (!existsSync(databasePath)) {
    return false;
  }
  const db: Database.Database = new Database(databasePath);
  try {
    const migrate = db.transaction((): boolean => {
      const definition: TableDefinition | undefined = db
        .prepare<[], TableDefinition>("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'quotes'")
        .get();
      if (!hasRetiredStatus(definition)) {
        return false;
      }
      db.exec(quotesTableSql(REBUILD_TABLE));
      db.exec(`
        INSERT INTO ${REBUILD_TABLE} (${COPY_COLUMNS}, status)
        SELECT ${COPY_COLUMNS}, CASE status WHEN 'new' THEN 'quoted' ELSE status END FROM quotes
      `);
      db.exec("DROP TABLE quotes");
      db.exec(`ALTER TABLE ${REBUILD_TABLE} RENAME TO quotes`);
      return true;
    });
    return migrate.immediate();
  } finally {
    db.close();
  }
}
