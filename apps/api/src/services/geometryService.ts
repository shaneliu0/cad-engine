import { execFile } from "node:child_process";
import type { ExecFileException } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { promisify } from "node:util";
import type { GeometryAnalysis } from "../types.js";

const ENGINE_DIRECTORY: string = resolve(import.meta.dirname, "../../../../packages/geometry-engine");
const ENGINE_TIMEOUT_MS: number = 120_000;
const ENGINE_MAX_OUTPUT_BYTES: number = 10 * 1024 * 1024;

const execFileAsync = promisify(execFile);
const engineShutdown: AbortController = new AbortController();

export class PartUnreadableError extends Error {}

export type AnalyzeGeometry = (filePath: string) => Promise<GeometryAnalysis>;

interface EngineReport {
  bounding_box_mm: { length: unknown; width: unknown; height: unknown };
  volume_cm3: unknown;
  surface_area_cm2: unknown;
  features: {
    face_count: unknown;
    edge_count: unknown;
    holes_detected: unknown;
    complexity_score: unknown;
  };
}

type EngineFailure = ExecFileException & { stderr?: string };

export async function saveUploadToTemp(upload: Readable): Promise<string> {
  const filePath: string = join(tmpdir(), `${randomUUID()}.step`);
  try {
    await pipeline(upload, createWriteStream(filePath, { flags: "wx", mode: 0o600 }));
  } catch (error: unknown) {
    await rm(filePath, { force: true });
    throw error;
  }
  return filePath;
}

export async function deleteTempUpload(filePath: string): Promise<void> {
  await rm(filePath, { force: true });
}

function isPartFailure(failure: EngineFailure): boolean {
  if (failure.code === 1 && /^error:/m.test(failure.stderr ?? "")) {
    return true;
  }
  return failure.code === null && Boolean(failure.signal);
}

function requireNumber(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Geometry engine returned an invalid ${field}`);
  }
  return value;
}

function parseEngineReport(stdout: string): GeometryAnalysis {
  const report: EngineReport = JSON.parse(stdout) as EngineReport;
  return {
    geometry: {
      bounding_box_mm: {
        length: requireNumber(report.bounding_box_mm.length, "length"),
        width: requireNumber(report.bounding_box_mm.width, "width"),
        height: requireNumber(report.bounding_box_mm.height, "height"),
      },
      volume_cm3: requireNumber(report.volume_cm3, "volume_cm3"),
      surface_area_cm2: requireNumber(report.surface_area_cm2, "surface_area_cm2"),
    },
    features: {
      holes_detected: requireNumber(report.features.holes_detected, "holes_detected"),
      face_count: requireNumber(report.features.face_count, "face_count"),
      edge_count: requireNumber(report.features.edge_count, "edge_count"),
      complexity_score: requireNumber(report.features.complexity_score, "complexity_score"),
    },
  };
}

export function stopRunningEngines(): void {
  engineShutdown.abort();
}

export async function analyzeStepFile(
  filePath: string,
  timeoutMs: number = ENGINE_TIMEOUT_MS,
): Promise<GeometryAnalysis> {
  const python: string = process.env.GEOMETRY_PYTHON_PATH ?? join(ENGINE_DIRECTORY, ".venv/bin/python");
  const script: string = process.env.GEOMETRY_SCRIPT_PATH ?? join(ENGINE_DIRECTORY, "geometry_engine.py");

  let stdout: string;
  try {
    ({ stdout } = await execFileAsync(python, [script, filePath], {
      timeout: timeoutMs,
      maxBuffer: ENGINE_MAX_OUTPUT_BYTES,
      encoding: "utf8",
      signal: engineShutdown.signal,
    }));
  } catch (error: unknown) {
    if (isPartFailure(error as EngineFailure)) {
      throw new PartUnreadableError("Geometry engine could not read the part", { cause: error });
    }
    throw error;
  }
  return parseEngineReport(stdout);
}
