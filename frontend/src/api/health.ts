import { request } from "./request";
import type { DatabaseHealthResponse, HealthResponse } from "./types";

export function getHealth(options: { signal?: AbortSignal } = {}): Promise<HealthResponse> {
  return request<HealthResponse>("/api/health", options);
}

export function getDatabaseHealth(options: { signal?: AbortSignal } = {}): Promise<DatabaseHealthResponse> {
  return request<DatabaseHealthResponse>("/api/db/health", options);
}
