import { execFile } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";

const ENGINE_DIRECTORY: string = resolve(import.meta.dirname, "../../../../packages/geometry-engine");
const DEFAULT_DATA_DIRECTORY: string = resolve(import.meta.dirname, "../../data");
const PREVIEW_TIMEOUT_MS: number = 120_000;
const PREVIEW_MAX_OUTPUT_BYTES: number = 1024 * 1024;
const MAX_CONCURRENT_RENDERS: number = 2;
const STEP_FILE_NAME: string = "source.step";
const MODEL_FILE_NAME: string = "model.bin";
const THUMBNAIL_FILE_NAME: string = "thumbnail.png";

const execFileAsync = promisify(execFile);
const previewShutdown: AbortController = new AbortController();

export type RunPreviewExport = (
  stepPath: string,
  outputDirectory: string,
  signal?: AbortSignal,
) => Promise<void>;

export interface PreviewService {
  saveQuotePreview(quoteId: number, stepPath: string): Promise<void>;
  readModel(quoteId: number): Promise<Buffer | null>;
  readThumbnail(quoteId: number): Promise<Buffer | null>;
  renderThumbnail(stepPath: string, signal?: AbortSignal): Promise<Buffer>;
}

export interface PreviewServiceOptions {
  directory?: string;
  runExport?: RunPreviewExport;
}

interface Semaphore {
  acquire(): Promise<void>;
  release(): void;
}

function createSemaphore(limit: number): Semaphore {
  let active: number = 0;
  const waiting: Array<() => void> = [];
  return {
    async acquire(): Promise<void> {
      if (active < limit) {
        active += 1;
        return;
      }
      await new Promise<void>((grant: () => void): void => {
        waiting.push(grant);
      });
    },
    release(): void {
      const next: (() => void) | undefined = waiting.shift();
      if (next === undefined) {
        active -= 1;
      } else {
        next();
      }
    },
  };
}

export function resolvePreviewDirectory(): string {
  if (process.env.QUOTES_DATA_DIR) {
    return join(process.env.QUOTES_DATA_DIR, "previews");
  }
  if (process.env.QUOTES_DB_PATH) {
    return join(dirname(process.env.QUOTES_DB_PATH), "previews");
  }
  return join(DEFAULT_DATA_DIRECTORY, "previews");
}

export async function runPreviewExport(
  stepPath: string,
  outputDirectory: string,
  signal?: AbortSignal,
): Promise<void> {
  const python: string = process.env.GEOMETRY_PYTHON_PATH ?? join(ENGINE_DIRECTORY, ".venv/bin/python");
  const script: string = process.env.GEOMETRY_PREVIEW_SCRIPT_PATH ?? join(ENGINE_DIRECTORY, "export_preview.py");
  await execFileAsync(python, [script, stepPath, outputDirectory], {
    timeout: PREVIEW_TIMEOUT_MS,
    killSignal: "SIGKILL",
    maxBuffer: PREVIEW_MAX_OUTPUT_BYTES,
    encoding: "utf8",
    signal: signal === undefined ? previewShutdown.signal : AbortSignal.any([previewShutdown.signal, signal]),
  });
}

export function stopRunningPreviews(): void {
  previewShutdown.abort();
}

async function readIfPresent(path: string): Promise<Buffer | null> {
  try {
    return await readFile(path);
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

export function createPreviewService(options: PreviewServiceOptions = {}): PreviewService {
  const root: string = options.directory ?? resolvePreviewDirectory();
  const runExport: RunPreviewExport = options.runExport ?? runPreviewExport;
  const renders: Semaphore = createSemaphore(MAX_CONCURRENT_RENDERS);

  function quoteDirectory(quoteId: number): string {
    return join(root, String(quoteId));
  }

  return {
    async saveQuotePreview(quoteId: number, stepPath: string): Promise<void> {
      const directory: string = quoteDirectory(quoteId);
      await rm(directory, { recursive: true, force: true });
      await mkdir(directory, { recursive: true });
      await copyFile(stepPath, join(directory, STEP_FILE_NAME));
      try {
        await runExport(join(directory, STEP_FILE_NAME), directory);
      } catch (error: unknown) {
        await rm(join(directory, MODEL_FILE_NAME), { force: true });
        await rm(join(directory, THUMBNAIL_FILE_NAME), { force: true });
        throw error;
      }
    },

    readModel(quoteId: number): Promise<Buffer | null> {
      return readIfPresent(join(quoteDirectory(quoteId), MODEL_FILE_NAME));
    },

    readThumbnail(quoteId: number): Promise<Buffer | null> {
      return readIfPresent(join(quoteDirectory(quoteId), THUMBNAIL_FILE_NAME));
    },

    async renderThumbnail(stepPath: string, signal?: AbortSignal): Promise<Buffer> {
      await renders.acquire();
      try {
        signal?.throwIfAborted();
        const output: string = await mkdtemp(join(tmpdir(), "quote-preview-"));
        try {
          await runExport(stepPath, output, signal);
          return await readFile(join(output, THUMBNAIL_FILE_NAME));
        } finally {
          await rm(output, { recursive: true, force: true });
        }
      } finally {
        renders.release();
      }
    },
  };
}
