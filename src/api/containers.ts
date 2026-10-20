import { request } from "./request";
import type { ContainerDto, ContainerListResponse, ContainerQuery, ContainerSnapshotItem, ContainerSyncResponse } from "./types";

export async function synchronizeContainerSnapshot(items: readonly ContainerSnapshotItem[], options: { signal?: AbortSignal } = {}): Promise<ContainerSyncResponse> {
  const results: ContainerSyncResponse[] = [];
  for (let offset = 0; offset < items.length; offset += 200) {
    results.push(await request<ContainerSyncResponse>("/api/containers/sync", {
      method: "POST",
      body: { items: items.slice(offset, offset + 200) },
      signal: options.signal,
    }));
  }
  return results.reduce((summary, result) => ({
    synchronized: summary.synchronized && result.synchronized,
    count: summary.count + result.count,
    total: summary.total + result.total,
    created: (summary.created ?? 0) + (result.created ?? 0),
    existing: (summary.existing ?? 0) + (result.existing ?? 0),
  }), { synchronized: true, count: 0, total: 0 });
}

export function getContainers(options: ContainerQuery = {}): Promise<ContainerListResponse> {
  const query = new URLSearchParams();
  if (options.state) query.set("state", options.state);
  if (options.page !== undefined) query.set("page", String(options.page));
  if (options.pageSize !== undefined) query.set("pageSize", String(options.pageSize));
  const suffix = query.size ? `?${query}` : "";
  return request<ContainerListResponse>(`/api/containers${suffix}`, { signal: options.signal });
}

export function getContainerByBusinessId(businessId: string, options: { signal?: AbortSignal } = {}): Promise<ContainerDto> {
  return request<ContainerDto>(`/api/containers/${encodeURIComponent(businessId)}`, { signal: options.signal });
}

export function getContainerByDatabaseId(databaseId: string | number, options: { signal?: AbortSignal } = {}): Promise<ContainerDto> {
  return request<ContainerDto>(`/api/containers/by-database-id/${encodeURIComponent(String(databaseId))}`, { signal: options.signal });
}
