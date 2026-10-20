import type { ApiErrorBody, JsonObject, RequestOptions } from "./types";

export class HttpError extends Error {
  readonly status: number;
  readonly body: ApiErrorBody | null;

  constructor(message: string, options: { status: number; body: ApiErrorBody | null }) {
    super(message);
    this.name = "HttpError";
    this.status = options.status;
    this.body = options.body;
  }
}

export class NetworkError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "NetworkError";
  }
}

function isJsonObject(value: unknown): value is JsonObject {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isApiErrorBody(value: unknown): value is ApiErrorBody {
  if (!isJsonObject(value)) return false;
  return value.error === undefined || isJsonObject(value.error);
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

export async function request<T>(path: string, { signal, ...options }: RequestOptions = {}): Promise<T> {
  let response: Response;
  const headers = new Headers(options.headers);
  if (!headers.has("Accept")) headers.set("Accept", "application/json");

  let body = options.body;
  if (isJsonObject(body)) {
    body = JSON.stringify(body);
    if (!headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  }

  try {
    response = await fetch(path, { ...options, signal, headers, body });
  } catch (error) {
    if (isAbortError(error)) throw error;
    throw new NetworkError("无法连接到服务", { cause: error });
  }

  let bodyJson: unknown = null;
  try {
    bodyJson = await response.json();
  } catch (error) {
    if (isAbortError(error)) throw error;
    if (response.ok) throw new NetworkError("服务返回了无效的 JSON 响应", { cause: error });
  }

  if (!response.ok) {
    const errorBody = isApiErrorBody(bodyJson) ? bodyJson : null;
    throw new HttpError(
      errorBody?.error?.message ?? `请求失败（HTTP ${response.status}）`,
      { status: response.status, body: errorBody },
    );
  }

  return bodyJson as T;
}
