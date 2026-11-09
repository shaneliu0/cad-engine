import { migrateQuoteStatuses } from "./db/migrateQuoteStatuses.js";
import { resolveDatabasePath } from "./db/quoteRepository.js";

if (migrateQuoteStatuses(resolveDatabasePath())) {
  console.info("Migrated the quotes table to the current status values.");
}

await import("./server.js");
