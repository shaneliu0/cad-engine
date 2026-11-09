import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { deleteTempUpload } from "../services/geometryService.js";
import type { PreviewService } from "../services/previewService.js";
import { findQuote } from "../services/quoteService.js";
import type { QuoteServiceDeps } from "../services/quoteService.js";
import type { Quote } from "../types.js";
import {
  NOT_FOUND_MESSAGE,
  isMalformedMultipart,
  parseQuoteId,
  receiveUpload,
  sendError,
} from "./quoteRoutes.js";
import type { QuoteParams, ReceivedUpload } from "./quoteRoutes.js";

const PREVIEW_NOT_FOUND_MESSAGE: string = "Preview not found";
const PREVIEW_FAILED_MESSAGE: string = "A preview could not be generated for this file";
const PNG_TYPE: string = "image/png";
const MODEL_TYPE: string = "application/octet-stream";

type ReadPreview = (previews: PreviewService, quoteId: number) => Promise<Buffer | null>;

async function sendStoredPreview(
  deps: QuoteServiceDeps,
  rawId: string,
  reply: FastifyReply,
  contentType: string,
  read: ReadPreview,
): Promise<FastifyReply> {
  const id: number | null = parseQuoteId(rawId);
  const quote: Quote | null = id === null ? null : findQuote(deps, id);
  if (id === null || quote === null) {
    return sendError(reply, 404, NOT_FOUND_MESSAGE);
  }
  const content: Buffer | null = deps.previews ? await read(deps.previews, id) : null;
  if (content === null) {
    return sendError(reply, 404, PREVIEW_NOT_FOUND_MESSAGE);
  }
  return reply.type(contentType).send(content);
}

type LivePreviewResult = { image: Buffer } | { statusCode: number; message: string };

function previewError(statusCode: number, message: string): LivePreviewResult {
  return { statusCode, message };
}

async function renderUpload(
  request: FastifyRequest,
  reply: FastifyReply,
  previews: PreviewService,
  upload: ReceivedUpload,
): Promise<LivePreviewResult> {
  if (!request.isMultipart()) {
    return previewError(400, "Request must be multipart/form-data");
  }
  try {
    await receiveUpload(request, upload);
  } catch (error: unknown) {
    if (isMalformedMultipart(error)) {
      return previewError(400, "Malformed multipart upload");
    }
    throw error;
  }
  if (upload.fileName === undefined) {
    return previewError(400, "A file is required");
  }
  if (upload.tempPath === undefined) {
    return previewError(400, "Only .step or .stp files are accepted");
  }

  const cancelled: AbortController = new AbortController();
  const onClose = (): void => {
    if (!reply.raw.writableFinished) {
      cancelled.abort();
    }
  };
  reply.raw.once("close", onClose);
  try {
    return { image: await previews.renderThumbnail(upload.tempPath, cancelled.signal) };
  } catch (error: unknown) {
    request.log.warn({ err: error }, "live preview failed");
    return previewError(422, PREVIEW_FAILED_MESSAGE);
  } finally {
    reply.raw.off("close", onClose);
  }
}

export function registerPreviewRoutes(app: FastifyInstance, deps: QuoteServiceDeps): void {
  app.get<{ Params: QuoteParams }>(
    "/api/quotes/:id/model",
    (request, reply): Promise<FastifyReply> =>
      sendStoredPreview(deps, request.params.id, reply, MODEL_TYPE, (previews, id) => previews.readModel(id)),
  );

  app.get<{ Params: QuoteParams }>(
    "/api/quotes/:id/thumbnail",
    (request, reply): Promise<FastifyReply> =>
      sendStoredPreview(deps, request.params.id, reply, PNG_TYPE, (previews, id) => previews.readThumbnail(id)),
  );

  app.post("/api/previews", async (request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> => {
    if (deps.previews === undefined) {
      return sendError(reply, 404, PREVIEW_NOT_FOUND_MESSAGE);
    }
    const upload: ReceivedUpload = {};
    let result: LivePreviewResult;
    try {
      result = await renderUpload(request, reply, deps.previews, upload);
    } finally {
      if (upload.tempPath !== undefined) {
        await deleteTempUpload(upload.tempPath).catch((error: unknown): void => {
          request.log.error({ err: error }, "failed to delete temp upload");
        });
      }
    }
    return "image" in result ? reply.type(PNG_TYPE).send(result.image) : sendError(reply, result.statusCode, result.message);
  });
}
