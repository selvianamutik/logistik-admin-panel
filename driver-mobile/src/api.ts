import { API_BASE_URL } from './config';
import type {
  DeliveryOrder,
  DriverLoginPayload,
  DriverSessionPayload,
  TrackingAction,
} from './types';

type ApiError = Error & {
  status?: number;
};

function buildApiError(status: number, message: string) {
  const error = new Error(message) as ApiError;
  error.status = status;
  return error;
}

async function parseJson(response: Response) {
  const raw = await response.text();
  if (!raw) return {};

  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
}

async function request<T>(
  path: string,
  init?: RequestInit & { token?: string | null },
): Promise<T> {
  const headers = new Headers(init?.headers || {});
  headers.set('Content-Type', 'application/json');
  if (init?.token) {
    headers.set('Authorization', `Bearer ${init.token}`);
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers,
  });
  const payload = await parseJson(response);
  if (!response.ok) {
    throw buildApiError(response.status, String(payload.error || `Request gagal (${response.status})`));
  }

  return payload as T;
}

export async function loginDriver(email: string, password: string) {
  return request<DriverLoginPayload>('/api/driver/mobile/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
}

export async function fetchDriverSession(token: string) {
  return request<DriverSessionPayload>('/api/driver/session', {
    method: 'GET',
    token,
  });
}

export async function fetchDriverDeliveryOrders(token: string) {
  const response = await request<{ data: DeliveryOrder[] }>('/api/driver/delivery-orders', {
    method: 'GET',
    token,
  });

  return response.data || [];
}

export async function postTrackingAction(
  token: string,
  deliveryOrderRef: string,
  action: TrackingAction,
  coords?: {
    latitude: number;
    longitude: number;
    accuracyM?: number | null;
    speedMps?: number | null;
  },
) {
  return request<{ data?: DeliveryOrder }>('/api/driver/tracking', {
    method: 'POST',
    token,
    body: JSON.stringify({
      action,
      deliveryOrderRef,
      latitude: coords?.latitude,
      longitude: coords?.longitude,
      accuracyM: coords?.accuracyM,
      speedMps: coords?.speedMps,
    }),
  });
}
