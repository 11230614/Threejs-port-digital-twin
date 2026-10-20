import { request } from "./request";
import type { DeviceListResponse, DeviceProfileDto } from "./types";

export function getDevices(options: { type?: string; signal?: AbortSignal } = {}): Promise<DeviceListResponse> {
  const query = new URLSearchParams();
  if (options.type) query.set("type", options.type);
  const suffix = query.size ? `?${query.toString()}` : "";
  return request<DeviceListResponse>(`/api/devices${suffix}`, { signal: options.signal });
}

export function getDevice(id: string, options: { signal?: AbortSignal } = {}): Promise<DeviceProfileDto> {
  return request<DeviceProfileDto>(`/api/devices/${encodeURIComponent(id)}`, { signal: options.signal });
}
