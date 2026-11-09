import type { Quote, QuoteStatus } from "@cad-quote/contract";

export type { Quote, QuoteStatus };

export const QUOTE_STATUSES: readonly QuoteStatus[] = [
  "quoted",
  "reviewed",
  "archived",
];

export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

const NETWORK_ERROR_MESSAGE: string =
  "Could not reach the server. Check your connection and try again.";

const FALLBACK_ERROR_MESSAGES: Readonly<Record<number, string>> = {
  400: "The request was not valid.",
  413: "That file is too large to upload.",
  422: "That file could not be analyzed.",
  500: "The server ran into a problem. Try again.",
};

async function readErrorMessage(response: Response): Promise<string> {
  try {
    const body: unknown = await response.json();
    if (typeof body === "object" && body !== null && "error" in body) {
      const { error } = body;
      if (typeof error === "string" && error.length > 0) {
        return error;
      }
    }
  } catch {
  }
  return (
    FALLBACK_ERROR_MESSAGES[response.status] ??
    `Request failed with status ${response.status}.`
  );
}

async function send(path: string, init?: RequestInit): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(`/api${path}`, init);
  } catch (error: unknown) {
    if (init?.signal?.aborted) {
      throw error;
    }
    throw new ApiError(0, NETWORK_ERROR_MESSAGE);
  }
  if (!response.ok) {
    throw new ApiError(response.status, await readErrorMessage(response));
  }
  return response;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response: Response = await send(path, init);
  return (await response.json()) as T;
}

export function createQuote(
  file: File,
  quantity: number,
  signal?: AbortSignal,
): Promise<Quote> {
  const form = new FormData();
  form.append("quantity", String(quantity));
  form.append("file", file);
  return request<Quote>("/quotes", { method: "POST", body: form, signal });
}

export function listQuotes(signal?: AbortSignal): Promise<Quote[]> {
  return request<Quote[]>("/quotes", { signal });
}

export function getQuote(id: number, signal?: AbortSignal): Promise<Quote> {
  return request<Quote>(`/quotes/${id}`, { signal });
}

export function updateQuoteStatus(
  id: number,
  status: QuoteStatus,
): Promise<Quote> {
  return request<Quote>(`/quotes/${id}/status`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status }),
  });
}

export function quoteThumbnailUrl(id: number): string {
  return `/api/quotes/${id}/thumbnail`;
}

export async function getQuoteModel(id: number, signal?: AbortSignal): Promise<ArrayBuffer> {
  const response: Response = await send(`/quotes/${id}/model`, { signal });
  return response.arrayBuffer();
}

export async function createPreview(file: File, signal?: AbortSignal): Promise<Blob> {
  const form = new FormData();
  form.append("file", file);
  const response: Response = await send("/previews", { method: "POST", body: form, signal });
  return response.blob();
}

export function getErrorMessage(error: unknown): string {
  return error instanceof ApiError
    ? error.message
    : "Something went wrong. Try again.";
}
