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
  login: (cpf: string, phone: string) =>
    req<User>('/login', { method: 'POST', body: JSON.stringify({ cpf, phone }) }),
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
  reopenRequest: (id: string) =>
    req<MarinaRequest>(`/requests/${id}/reopen`, { method: 'PATCH' }),
  getRequest: (id: string) => req<MarinaRequest>(`/requests/${id}`),
  slots: (type: RequestType, date: string) =>
    req<SlotInfo[]>(`/slots?type=${type}&date=${date}`),
  getTides: (date: string) => req<TideDay>(`/tides/${date}`),
  setTides: (date: string, points: { time: string; height: number }[]) =>
    req<TideDay>(`/tides/${date}`, { method: 'PUT', body: JSON.stringify({ points }) }),
  listUsers: () => req<Client[]>('/users'),
  createClient: (data: { cpf: string; name: string; phone: string; boats: Boat[]; is_staff?: boolean }) =>
    req<Client>('/users', { method: 'POST', body: JSON.stringify(data) }),
  setUserActive: (cpf: string, active: boolean) =>
    req<Client>(`/users/${cpf}/active`, { method: 'PATCH', body: JSON.stringify({ active }) }),
  addBoat: (cpf: string, boat: { name: string; draft?: number | null; length?: number | null }) =>
    req<Client>(`/users/${cpf}/boats`, { method: 'POST', body: JSON.stringify(boat) }),
  removeBoat: (cpf: string, boat: string) =>
    req<Client>(`/users/${cpf}/boats?boat=${encodeURIComponent(boat)}`, { method: 'DELETE' }),
  // Conveniência
  listProducts: (all = false) => req<Product[]>(`/products${all ? '?all=true' : ''}`),
  createProduct: (data: { name: string; price: number; category?: string }) =>
    req<Product>('/products', { method: 'POST', body: JSON.stringify(data) }),
  updateProduct: (id: string, data: Partial<Product>) =>
    req<Product>(`/products/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteProduct: (id: string) => req<{ ok: boolean }>(`/products/${id}`, { method: 'DELETE' }),
  uploadProductImage: async (id: string, uri: string, filename: string, type: string) => {
    const form = new FormData();
    if (typeof window !== 'undefined' && typeof document !== 'undefined') {
      // web: needs a real Blob
      const blob = await (await fetch(uri)).blob();
      form.append('file', blob, filename);
    } else {
      form.append('file', { uri, name: filename, type } as any);
    }
    const res = await fetch(`${BASE}/api/products/${id}/image`, { method: 'POST', body: form });
    if (!res.ok) {
      let msg = 'Falha no upload';
      try { msg = (await res.json()).detail || msg; } catch {}
      throw new Error(msg);
    }
    return res.json() as Promise<Product>;
  },
  createOrder: (data: {
    cpf: string;
    boat_name?: string | null;
    items: { product_id: string; name: string; price: number; qty: number }[];
    observation?: string | null;
  }) => req<ConvenienceOrder>('/convenience/orders', { method: 'POST', body: JSON.stringify(data) }),
  listOrders: (cpf?: string) => req<ConvenienceOrder[]>(`/convenience/orders${cpf ? `?cpf=${cpf}` : ''}`),
  setOrderStatus: (id: string, status: OrderStatus) =>
    req<ConvenienceOrder>(`/convenience/orders/${id}/status?status=${status}`, { method: 'PATCH' }),
  // Autorizações
  createAuthorization: (data: { cpf: string; boat_name: string; person_name: string; date: string; can_lower?: boolean; service?: string | null }) =>
    req<Authorization>('/authorizations', { method: 'POST', body: JSON.stringify(data) }),
  listAuthorizations: (cpf?: string) =>
    req<Authorization[]>(`/authorizations${cpf ? `?cpf=${cpf}` : ''}`),
  cancelAuthorization: (id: string) =>
    req<Authorization>(`/authorizations/${id}/cancel`, { method: 'PATCH' }),
  checkinAuthorization: (id: string) =>
    req<Authorization>(`/authorizations/${id}/checkin`, { method: 'PATCH' }),
  // Emergências
  createEmergency: (data: { cpf: string; boat_name?: string | null; location?: string | null; observation?: string | null }) =>
    req<Emergency>('/emergencies', { method: 'POST', body: JSON.stringify(data) }),
  reboqueQuote: (params: { length: number; distance?: number; client_lat?: number; client_lng?: number }) => {
    const qs = new URLSearchParams({ length: String(params.length) });
    if (params.distance != null) qs.set('distance', String(params.distance));
    if (params.client_lat != null) qs.set('client_lat', String(params.client_lat));
    if (params.client_lng != null) qs.set('client_lng', String(params.client_lng));
    return req<ReboqueQuote>(`/reboque/quote?${qs.toString()}`);
  },
  createReboque: (data: { cpf: string; boat_name: string; distance_nm?: number; client_lat?: number; client_lng?: number; location?: string | null; observation?: string | null }) =>
    req<Emergency>('/reboque', { method: 'POST', body: JSON.stringify(data) }),
  billEmergency: (id: string, amount: number) =>
    req<Emergency>(`/emergencies/${id}/bill`, { method: 'PATCH', body: JSON.stringify({ amount }) }),
  listEmergencies: (cpf?: string, status?: string) => {
    const params = new URLSearchParams();
    if (cpf) params.set('cpf', cpf);
    if (status) params.set('status', status);
    const qs = params.toString();
    return req<Emergency[]>(`/emergencies${qs ? `?${qs}` : ''}`);
  },
  resolveEmergency: (id: string) =>
    req<Emergency>(`/emergencies/${id}/resolve`, { method: 'PATCH' }),
  cancelEmergency: (id: string) =>
    req<Emergency>(`/emergencies/${id}/cancel`, { method: 'PATCH' }),
  consumoReport: (month?: string, cpf?: string) => {
    const qs = new URLSearchParams();
    if (month) qs.set('month', month);
    if (cpf) qs.set('cpf', cpf);
    const s = qs.toString();
    return req<ConsumoReport>(`/reports/consumo${s ? `?${s}` : ''}`);
  },
  sendStatement: (cpf: string, month: string) =>
    req<Statement>('/statements/send', { method: 'POST', body: JSON.stringify({ cpf, month }) }),
  listStatements: (cpf?: string) => req<Statement[]>(`/statements${cpf ? `?cpf=${cpf}` : ''}`),
  readStatement: (id: string) => req<{ ok: boolean }>(`/statements/${id}/read`, { method: 'PATCH' }),
};

export type Product = { id: string; name: string; price: number; active: boolean; in_stock: boolean; category: string; image_url?: string | null };
export const PRODUCT_CATEGORIES = ['Bebidas', 'Sorvetes', 'Açaí', 'Outros'] as const;
export type ProductCategory = (typeof PRODUCT_CATEGORIES)[number];
export const API_BASE = BASE;
export function fileUrl(path?: string | null): string | undefined {
  if (!path) return undefined;
  if (path.startsWith('http')) return path;
  // stored as "/api/files/..."; BASE already includes host without /api
  return `${BASE}${path}`;
}
export type OrderStatus = 'pendente' | 'entregue' | 'cancelada';
export type ConvenienceOrder = {
  id: string;
  cpf: string;
  user_name: string;
  boat_name?: string | null;
  items: { product_id: string; name: string; price: number; qty: number }[];
  total: number;
  observation?: string | null;
  status: OrderStatus;
  created_at: string;
  updated_at: string;
};
export type Authorization = {
  id: string;
  cpf: string;
  user_name: string;
  boat_name: string;
  person_name: string;
  date: string;
  can_lower?: boolean;
  service?: string | null;
  status: 'ativa' | 'cancelada';
  entered_at?: string | null;
  created_at: string;
};
export type Emergency = {
  id: string;
  kind?: 'socorro' | 'reboque';
  cpf: string;
  user_name: string;
  phone?: string | null;
  boat_name?: string | null;
  location?: string | null;
  observation?: string | null;
  status: 'aberta' | 'atendida' | 'cancelada';
  created_at: string;
  resolved_at?: string | null;
  // reboque
  boat_length?: number | null;
  distance_nm?: number;
  additional_nm?: number;
  base_fee?: number;
  per_nm?: number;
  additional_fee?: number;
  estimated_total?: number;
  billed_amount?: number | null;
  billed_at?: string | null;
};

export type ReboqueQuote = {
  boat_length?: number | null;
  distance_nm: number;
  included_nm: number;
  additional_nm: number;
  base_fee: number;
  per_nm: number;
  additional_fee: number;
  estimated_total: number;
};

export type ConsumoClient = {
  cpf: string;
  name: string;
  convenience_total: number;
  reboque_total: number;
  total: number;
  orders: { id: string; total: number; created_at: string; items: { name: string; qty: number }[]; status: string }[];
  reboques: { id: string; amount: number; boat_name?: string | null; billed_at?: string | null }[];
};
export type ConsumoReport = { month: string; grand_total: number; clients: ConsumoClient[] };

export type Statement = {
  id: string;
  cpf: string;
  user_name: string;
  month: string;
  convenience_total: number;
  reboque_total: number;
  total: number;
  orders: { id: string; total: number; created_at: string; items: { name: string; qty: number }[] }[];
  reboques: { id: string; amount: number; boat_name?: string | null }[];
  read: boolean;
  sent_at: string;
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
  is_staff?: boolean;
  active?: boolean;
};
