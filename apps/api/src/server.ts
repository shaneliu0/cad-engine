import type { FastifyInstance } from "fastify";
import { buildApp } from "./api/app.js";
import { openQuoteRepository } from "./db/quoteRepository.js";
import { analyzeStepFile, stopRunningEngines } from "./services/geometryService.js";
import { createPreviewService, stopRunningPreviews } from "./services/previewService.js";

const PORT: number = Number(process.env.API_PORT ?? 3001);

const app: FastifyInstance = await buildApp(
  { repository: openQuoteRepository(), analyzeGeometry: analyzeStepFile, previews: createPreviewService() },
  { logger: true },
);

async function shutDown(): Promise<void> {
  stopRunningEngines();
  stopRunningPreviews();
  await app.close();
}

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.once(signal, (): void => {
    shutDown().catch((error: unknown): void => {
      app.log.error(error);
      process.exitCode = 1;
    });
  });
}

try {
  await app.listen({ port: PORT, host: "127.0.0.1" });
} catch (error: unknown) {
  app.log.error(error);
  process.exit(1);
}
