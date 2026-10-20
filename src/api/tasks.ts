import { request } from "./request";
import type { CreateTaskRequest, ExecutionEventRequest, TaskDto, TaskListResponse, TaskQuery } from "./types";

export function createTask(payload: CreateTaskRequest, options: { signal?: AbortSignal } = {}): Promise<TaskDto> {
  return request<TaskDto>("/api/tasks", {
    method: "POST", signal: options.signal,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export function getTasks(options: TaskQuery = {}): Promise<TaskListResponse> {
  const query = new URLSearchParams();
  if (options.status) query.set("status", options.status);
  if (options.page !== undefined) query.set("page", String(options.page));
  if (options.pageSize !== undefined) query.set("pageSize", String(options.pageSize));
  return request<TaskListResponse>(`/api/tasks${query.size ? `?${query}` : ""}`, { signal: options.signal });
}

export function getTask(id: string, options: { signal?: AbortSignal } = {}): Promise<TaskDto> {
  return request<TaskDto>(`/api/tasks/${encodeURIComponent(id)}`, { signal: options.signal });
}

export function postExecutionEvent(id: string, event: ExecutionEventRequest, options: { signal?: AbortSignal } = {}): Promise<TaskDto> {
  return request<TaskDto>(`/api/tasks/${encodeURIComponent(id)}/execution-events`, {
    method: "POST", signal: options.signal,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(event),
  });
}
