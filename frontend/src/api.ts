const BASE = process.env.EXPO_PUBLIC_BACKEND_URL;

export type User = {
  cpf: string;
  name: string;
  phone: string;
  boat_name: string;
  is_admin?: boolean;
};

export type RequestType = 'descida' | 'subida';
export type RequestStatus = 'agendada' | 'cancelada' | 'concluida';

export type MarinaRequest = {
  id: string;
  type: RequestType;
  cpf: string;
  date: string; // YYYY-MM-DD
  time: string; // HH:MM
  expected_return_date?: string | null;
  expected_return_time?: string | null;
  destination?: string | null;
  passengers?: number | null;
  responsible?: string | null;
  observation?: string | null;
  status: RequestStatus;
  returned_at?: string | null;
  user_name?: string;
  boat_name?: string;
  created_at: string;
  updated_at: string;
};

async function req<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`${BASE}/api${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  if (!res.ok) {
    let msg = 'Erro na requisição';
    try {
      const data = await res.json();
      msg = data.detail || msg;
    } catch {}
    throw new Error(msg);
  }
  return res.json() as Promise<T>;
}

export const api = {
  login: (cpf: string) => req<User>('/login', { method: 'POST', body: JSON.stringify({ cpf }) }),
  createRequest: (data: Partial<MarinaRequest>) =>
    req<MarinaRequest>('/requests', { method: 'POST', body: JSON.stringify(data) }),
  updateRequest: (id: string, data: Partial<MarinaRequest>) =>
    req<MarinaRequest>(`/requests/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  todayRequests: (type?: RequestType) =>
    req<MarinaRequest[]>(`/requests/today${type ? `?type=${type}` : ''}`),
  history: (cpf: string) => req<MarinaRequest[]>(`/requests/history?cpf=${cpf}`),
  dayRequests: (date?: string, type?: RequestType) => {
    const params = new URLSearchParams();
    if (date) params.set('date', date);
    if (type) params.set('type', type);
    const qs = params.toString();
    return req<MarinaRequest[]>(`/requests/day${qs ? `?${qs}` : ''}`);
  },
  cancelRequest: (id: string) =>
    req<MarinaRequest>(`/requests/${id}/cancel`, { method: 'PATCH' }),
  confirmReturn: (id: string) =>
    req<MarinaRequest>(`/requests/${id}/confirm-return`, { method: 'PATCH' }),
  getRequest: (id: string) => req<MarinaRequest>(`/requests/${id}`),
};
