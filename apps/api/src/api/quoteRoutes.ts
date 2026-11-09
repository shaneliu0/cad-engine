import { Writable } from "node:stream";
import type { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { deleteTempUpload, saveUploadToTemp } from "../services/geometryService.js";
import { createQuote, findQuote, listQuotes, updateQuoteStatus } from "../services/quoteService.js";
import type { QuoteServiceDeps } from "../services/quoteService.js";
import { QUOTE_STATUSES } from "../types.js";
import type { Quote, QuoteStatus } from "../types.js";

const MAX_QUANTITY: number = 100_000;
export const STEP_FILE_NAME: RegExp = /\.(step|stp)$/i;
export const NOT_FOUND_MESSAGE: string = "Quote not found";

export interface QuoteParams {
  id: string;
}

interface UpdateStatusBody {
  status?: unknown;
}

export interface ReceivedUpload {
  fileName?: string;
  tempPath?: string;
  quantity?: string;
}

interface UploadResult {
  statusCode: number;
  body: Quote | { error: string };
}

export async function discard(stream: Readable): Promise<void> {
  const sink: Writable = new Writable({
    write(_chunk: unknown, _encoding: BufferEncoding, done: () => void): void {
      done();
    },
  });
  await pipeline(stream, sink);
}

export function isMalformedMultipart(error: unknown): boolean {
  return error instanceof Error && !("statusCode" in error) && !("syscall" in error);
}

export async function receiveUpload(request: FastifyRequest, upload: ReceivedUpload): Promise<void> {
  for await (const part of request.parts()) {
    if (part.type === "field") {
      if (part.fieldname === "quantity" && typeof part.value === "string") {
        upload.quantity = part.valueTruncated ? undefined : part.value;
      }
    } else if (part.fieldname !== "file" || upload.fileName !== undefined) {
      await discard(part.file);
    } else {
      upload.fileName = part.filename;
      if (STEP_FILE_NAME.test(part.filename)) {
        upload.tempPath = await saveUploadToTemp(part.file);
      } else {
        await discard(part.file);
      }
    }
  }
}

function parseQuantity(text: string | undefined): number | null {
  if (text === undefined || !/^\d+$/.test(text)) {
    return null;
  }
  const quantity: number = Number(text);
  return quantity >= 1 && quantity <= MAX_QUANTITY ? quantity : null;
}

export function parseQuoteId(text: string): number | null {
  if (!/^[1-9]\d*$/.test(text)) {
    return null;
  }
  const id: number = Number(text);
  return Number.isSafeInteger(id) ? id : null;
}

function isQuoteStatus(value: unknown): value is QuoteStatus {
  return QUOTE_STATUSES.some((status: QuoteStatus): boolean => status === value);
}

function uploadError(message: string): UploadResult {
  return { statusCode: 400, body: { error: message } };
}

async function quoteUpload(
  request: FastifyRequest,
  deps: QuoteServiceDeps,
  upload: ReceivedUpload,
): Promise<UploadResult> {
  if (!request.isMultipart()) {
    return uploadError("Request must be multipart/form-data");
  }

  try {
    await receiveUpload(request, upload);
  } catch (error: unknown) {
    if (isMalformedMultipart(error)) {
      return uploadError("Malformed multipart upload");
    }
    throw error;
  }

  if (upload.fileName === undefined) {
    return uploadError("A file is required");
  }
  if (upload.tempPath === undefined) {
    return uploadError("Only .step or .stp files are accepted");
  }
  const quantity: number | null = parseQuantity(upload.quantity);
  if (quantity === null) {
    return uploadError(`Quantity must be an integer from 1 to ${MAX_QUANTITY}`);
  }

  const quote: Quote = await createQuote(deps, {
    fileName: upload.fileName,
    filePath: upload.tempPath,
    quantity,
  });
  if (deps.previews !== undefined) {
    await deps.previews.saveQuotePreview(quote.id, upload.tempPath).catch((error: unknown): void => {
      request.log.warn({ err: error, quoteId: quote.id }, "preview generation failed");
    });
  }
  return { statusCode: 201, body: quote };
}

export function sendError(reply: FastifyReply, statusCode: number, message: string): FastifyReply {
  return reply.code(statusCode).send({ error: message });
}

export function registerQuoteRoutes(app: FastifyInstance, deps: QuoteServiceDeps): void {
  app.post("/api/quotes", async (request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> => {
    const upload: ReceivedUpload = {};
    let result: UploadResult;
    try {
      result = await quoteUpload(request, deps, upload);
    } finally {
      if (upload.tempPath !== undefined) {
        await deleteTempUpload(upload.tempPath).catch((error: unknown): void => {
          request.log.error({ err: error }, "failed to delete temp upload");
        });
      }
    }
    return reply.code(result.statusCode).send(result.body);
  });

  app.get("/api/quotes", async (): Promise<Quote[]> => listQuotes(deps));

  app.get<{ Params: QuoteParams }>(
    "/api/quotes/:id",
    async (request, reply): Promise<FastifyReply> => {
      const id: number | null = parseQuoteId(request.params.id);
      const quote: Quote | null = id === null ? null : findQuote(deps, id);
      return quote ? reply.send(quote) : sendError(reply, 404, NOT_FOUND_MESSAGE);
    },
  );

  app.patch<{ Params: QuoteParams; Body: UpdateStatusBody | undefined }>(
    "/api/quotes/:id/status",
    async (request, reply): Promise<FastifyReply> => {
      const id: number | null = parseQuoteId(request.params.id);
      if (id === null) {
        return sendError(reply, 404, NOT_FOUND_MESSAGE);
      }
      const status: unknown = request.body?.status;
      if (!isQuoteStatus(status)) {
        return sendError(reply, 400, `Status must be one of: ${QUOTE_STATUSES.join(", ")}`);
      }
      const quote: Quote | null = updateQuoteStatus(deps, id, status);
      return quote ? reply.send(quote) : sendError(reply, 404, NOT_FOUND_MESSAGE);
    },
  );
}
