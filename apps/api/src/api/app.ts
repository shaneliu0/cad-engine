import type { Socket } from "node:net";
import multipart from "@fastify/multipart";
import Fastify from "fastify";
import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { PartUnreadableError } from "../services/geometryService.js";
import type { QuoteServiceDeps } from "../services/quoteService.js";
import { registerPreviewRoutes } from "./previewRoutes.js";
import { registerQuoteRoutes } from "./quoteRoutes.js";

const MAX_UPLOAD_BYTES: number = 50 * 1024 * 1024;

interface BuildAppOptions {
  logger?: boolean;
}

function handleError(error: FastifyError, request: FastifyRequest, reply: FastifyReply): void {
  if (error instanceof PartUnreadableError) {
    request.log.warn({ err: error }, "geometry engine rejected upload");
    void reply.code(422).send({ error: "The STEP file could not be read as a solid part" });
    return;
  }

  const statusCode: number = error.statusCode ?? 500;
  if (error.code === "FST_PARTS_LIMIT") {
    void reply.code(400).send({ error: "Upload has too many parts" });
  } else if (error.code === "FST_REQ_FILE_TOO_LARGE") {
    void reply.code(413).send({ error: "File is too large; the limit is 50 MB" });
  } else if (statusCode === 413) {
    void reply.code(413).send({ error: "Request body is too large" });
  } else if (statusCode >= 400 && statusCode < 500) {
    void reply.code(400).send({ error: "Invalid request" });
  } else {
    request.log.error({ err: error }, "request failed");
    void reply.code(500).send({ error: "Internal server error" });
  }
}

function handleClientError(_error: Error, socket: Socket): void {
  if (!socket.writable) {
    return;
  }
  const body: string = JSON.stringify({ error: "Invalid request" });
  socket.end(
    "HTTP/1.1 400 Bad Request\r\n" +
      "Content-Type: application/json; charset=utf-8\r\n" +
      `Content-Length: ${Buffer.byteLength(body)}\r\n` +
      "Connection: close\r\n\r\n" +
      body,
  );
}

export async function buildApp(
  deps: QuoteServiceDeps,
  options: BuildAppOptions = {},
): Promise<FastifyInstance> {
  const app: FastifyInstance = Fastify({
    logger: options.logger ?? false,
    forceCloseConnections: true,
    frameworkErrors: handleError,
    clientErrorHandler: handleClientError,
  });

  await app.register(multipart, { limits: { fileSize: MAX_UPLOAD_BYTES } });

  app.setErrorHandler(handleError);
  app.setNotFoundHandler((_request: FastifyRequest, reply: FastifyReply): void => {
    void reply.code(404).send({ error: "Not found" });
  });

  registerQuoteRoutes(app, deps);
  registerPreviewRoutes(app, deps);
  return app;
}
