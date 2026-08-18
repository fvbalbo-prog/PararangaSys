const BASE = process.env.EXPO_PUBLIC_BACKEND_URL;

export type Boat = { name: string; draft?: number | null; length?: number | null };

export function boatName(b: Boat | string): string {
  return typeof b === 'string' ? b : b.name;
}

export type User = {
  cpf: string;
  name: string;
  phone: string;
  boat_name: string;
  boats?: (Boat | string)[];
  is_admin?: boolean;
  is_staff?: boolean;
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
  tide_height?: number | null;
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
  completeRequest: (id: string) =>
    req<MarinaRequest>(`/requests/${id}/complete`, { method: 'PATCH' }),
  getRequest: (id: string) => req<MarinaRequest>(`/requests/${id}`),
  slots: (type: RequestType, date: string) =>
    req<SlotInfo[]>(`/slots?type=${type}&date=${date}`),
  getTides: (date: string) => req<TideDay>(`/tides/${date}`),
  setTides: (date: string, points: { time: string; height: number }[]) =>
    req<TideDay>(`/tides/${date}`, { method: 'PUT', body: JSON.stringify({ points }) }),
  listUsers: () => req<Client[]>('/users'),
  createClient: (data: { cpf: string; name: string; phone: string; boats: Boat[] }) =>
    req<Client>('/users', { method: 'POST', body: JSON.stringify(data) }),
  addBoat: (cpf: string, boat: { name: string; draft?: number | null; length?: number | null }) =>
    req<Client>(`/users/${cpf}/boats`, { method: 'POST', body: JSON.stringify(boat) }),
  removeBoat: (cpf: string, boat: string) =>
    req<Client>(`/users/${cpf}/boats?boat=${encodeURIComponent(boat)}`, { method: 'DELETE' }),
};

export type SlotInfo = {
  time: string;
  count: number;
  capacity: number | null;
  available: boolean;
  unlimited: boolean;
};

export type TideDay = { date: string; points: { time: string; height: number }[] };

export type Client = {
  cpf: string;
  name: string;
  phone: string;
  boats: Boat[];
  boat_name?: string;
};
