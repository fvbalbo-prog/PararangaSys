import AsyncStorage from '@react-native-async-storage/async-storage';

const BASE = process.env.EXPO_PUBLIC_BACKEND_URL;

export type Boat = {
  name: string;
  draft?: number | null;
  length?: number | null;
  monthly_fee?: number | null;
  monthly_fee_valid_until?: string | null; // YYYY-MM-DD
  mensalidade_due_day?: number | null; // dia do mês (1-31) de vencimento da mensalidade
};

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
  // Session token issued by POST /login. Screens already persist the whole
  // login response under the 'user' key in AsyncStorage, so this field rides
  // along for free — req() below reads it back out from there to attach
  // "Authorization: Bearer <token>" on every call.
  token?: string;
};

/** Best-effort read of the token saved at login. Never throws: a missing or
 * unparsable 'user' entry just means the request goes out unauthenticated,
 * which is correct for endpoints that don't require a session (and will
 * surface as a 401 from the backend for the ones that do). */
async function authHeader(): Promise<Record<string, string>> {
  try {
    const raw = await AsyncStorage.getItem('user');
    if (!raw) return {};
    const user = JSON.parse(raw);
    return user?.token ? { Authorization: `Bearer ${user.token}` } : {};
  } catch {
    return {};
  }
}

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
  const auth = await authHeader();
  const res = await fetch(`${BASE}/api${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...auth,
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
  listUsers: () => req<Client[]>('/users'),
  createClient: (data: { cpf: string; name: string; phone: string; boats: Boat[]; is_staff?: boolean }) =>
    req<Client>('/users', { method: 'POST', body: JSON.stringify(data) }),
  setUserActive: (cpf: string, active: boolean) =>
    req<Client>(`/users/${cpf}/active`, { method: 'PATCH', body: JSON.stringify({ active }) }),
  addBoat: (cpf: string, boat: { name: string; draft?: number | null; length?: number | null; monthly_fee?: number | null; monthly_fee_valid_until?: string | null; mensalidade_due_day?: number | null }) =>
    req<Client>(`/users/${cpf}/boats`, { method: 'POST', body: JSON.stringify(boat) }),
  updateBoat: (cpf: string, name: string, data: Partial<{ draft: number | null; length: number | null; monthly_fee: number | null; monthly_fee_valid_until: string | null; mensalidade_due_day: number | null }>) =>
    req<Client>(`/users/${cpf}/boats/${encodeURIComponent(name)}`, { method: 'PUT', body: JSON.stringify(data) }),
  removeBoat: (cpf: string, boat: string) =>
    req<Client>(`/users/${cpf}/boats?boat=${encodeURIComponent(boat)}`, { method: 'DELETE' }),
  mensalidadesVencendo: (days = 30) => req<MensalidadeVencendo[]>(`/users/mensalidades/vencendo?days=${days}`),
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
    const auth = await authHeader();
    const res = await fetch(`${BASE}/api/products/${id}/image`, { method: 'POST', body: form, headers: auth });
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
    delivery_method?: 'balcao' | 'lancha';
  }) => req<ConvenienceOrder>('/convenience/orders', { method: 'POST', body: JSON.stringify(data) }),
  listOrders: (cpf?: string) => req<ConvenienceOrder[]>(`/convenience/orders${cpf ? `?cpf=${cpf}` : ''}`),
  setOrderStatus: (id: string, status: OrderStatus) =>
    req<ConvenienceOrder>(`/convenience/orders/${id}/status?status=${status}`, { method: 'PATCH' }),
  weeklyReport: () => req<WeeklyDay[]>('/reports/weekly'),
  // Autorizações
  createAuthorization: (data: { cpf: string; boat_name: string; person_name: string; validity_type: 'data' | 'periodo' | 'recorrente'; date?: string | null; start_date?: string | null; end_date?: string | null; can_lower?: boolean; service?: string | null }) =>
    req<Authorization>('/authorizations', { method: 'POST', body: JSON.stringify(data) }),
  listAuthorizations: (cpf?: string) =>
    req<Authorization[]>(`/authorizations${cpf ? `?cpf=${cpf}` : ''}`),
  cancelAuthorization: (id: string) =>
    req<Authorization>(`/authorizations/${id}/cancel`, { method: 'PATCH' }),
  checkinAuthorization: (id: string) =>
    req<Authorization>(`/authorizations/${id}/checkin`, { method: 'PATCH' }),
  // Avisos (notificações in-app)
  listNotifications: (cpf: string) => req<AppNotification[]>(`/notifications?cpf=${cpf}`),
  readNotification: (id: string) => req<{ ok: boolean }>(`/notifications/${id}/read`, { method: 'PATCH' }),
  readAllNotifications: (cpf: string) => req<{ ok: boolean }>(`/notifications/read-all?cpf=${cpf}`, { method: 'POST' }),
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
  // Serviços (lavagem, marinheiro, abastecimento)
  createServico: (data: { cpf: string; boat_name?: string | null; type: ServicoType; desired_date?: string | null; desired_time?: string | null; observation?: string | null }) =>
    req<Servico>('/servicos', { method: 'POST', body: JSON.stringify(data) }),
  listServicos: (params?: { cpf?: string; status?: ServicoStatus }) => {
    const qs = new URLSearchParams();
    if (params?.cpf) qs.set('cpf', params.cpf);
    if (params?.status) qs.set('status', params.status);
    const s = qs.toString();
    return req<Servico[]>(`/servicos${s ? `?${s}` : ''}`);
  },
  setServicoStatus: (id: string, status: ServicoStatus) =>
    req<Servico>(`/servicos/${id}/status?status=${status}`, { method: 'PATCH' }),
  cancelServico: (id: string) => req<Servico>(`/servicos/${id}/cancel`, { method: 'PATCH' }),
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
  // Fatura mensal (mensalidade + consumo, fechada na data de pagamento da lancha)
  faturaPreview: (cpf: string, boatName?: string) => {
    const qs = new URLSearchParams({ cpf });
    if (boatName) qs.set('boat_name', boatName);
    return req<FaturaPreviewResponse>(`/fatura/preview?${qs.toString()}`);
  },
  listFaturas: (cpf?: string) => req<Fatura[]>(`/faturas${cpf ? `?cpf=${cpf}` : ''}`),
  readFatura: (id: string) => req<{ ok: boolean }>(`/faturas/${id}/read`, { method: 'PATCH' }),
  // Ponto Eletrônico
  baterPonto: (type: PontoType) =>
    req<PontoEntry>('/ponto', { method: 'POST', body: JSON.stringify({ type }) }),
  listPonto: (params?: { cpf?: string; date_from?: string; date_to?: string }) => {
    const qs = new URLSearchParams();
    if (params?.cpf) qs.set('cpf', params.cpf);
    if (params?.date_from) qs.set('date_from', params.date_from);
    if (params?.date_to) qs.set('date_to', params.date_to);
    const s = qs.toString();
    return req<PontoEntry[]>(`/ponto${s ? `?${s}` : ''}`);
  },
  updatePonto: (id: string, data: { date?: string; time?: string }) =>
    req<PontoEntry>(`/ponto/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deletePonto: (id: string) => req<{ ok: boolean }>(`/ponto/${id}`, { method: 'DELETE' }),
  relatorioPonto: (dateFrom: string, dateTo: string, cpf?: string) => {
    const qs = new URLSearchParams({ date_from: dateFrom, date_to: dateTo });
    if (cpf) qs.set('cpf', cpf);
    return req<PontoRelatorio>(`/ponto/relatorio?${qs.toString()}`);
  },
  // Escala de Trabalho
  createEscala: (data: { date: string; cpf: string; observation?: string | null }) =>
    req<EscalaEntry>('/escala', { method: 'POST', body: JSON.stringify(data) }),
  listEscala: (params?: { month?: string; cpf?: string }) => {
    const qs = new URLSearchParams();
    if (params?.month) qs.set('month', params.month);
    if (params?.cpf) qs.set('cpf', params.cpf);
    const s = qs.toString();
    return req<EscalaEntry[]>(`/escala${s ? `?${s}` : ''}`);
  },
  deleteEscala: (id: string) => req<{ ok: boolean }>(`/escala/${id}`, { method: 'DELETE' }),
  listEscalaStaff: () => req<EscalaStaffMember[]>('/escala/staff'),
  gerarEscala: (data: { cpf: string; month: string; start_with?: 'seis' | 'cinco' }) =>
    req<EscalaGerarResult>('/escala/gerar', { method: 'POST', body: JSON.stringify(data) }),
  // Painel Financeiro
  financeiroCategorias: () => req<{ pagar: string[]; receber: string[] }>('/financeiro/categorias'),
  createFinanceiro: (data: {
    kind: FinanceiroKind;
    description: string;
    category: string;
    amount: number;
    due_date: string;
    cpf?: string | null;
    boat_name?: string | null;
    supplier_name?: string | null;
    observation?: string | null;
    recurring?: boolean;
    recurring_day?: number;
    recurring_end_date?: string | null;
  }) => req<FinanceiroEntry>('/financeiro', { method: 'POST', body: JSON.stringify(data) }),
  listFinanceiro: (params?: { kind?: FinanceiroKind; status?: FinanceiroStatus; month?: string }) => {
    const qs = new URLSearchParams();
    if (params?.kind) qs.set('kind', params.kind);
    if (params?.status) qs.set('status', params.status);
    if (params?.month) qs.set('month', params.month);
    const s = qs.toString();
    return req<FinanceiroEntry[]>(`/financeiro${s ? `?${s}` : ''}`);
  },
  updateFinanceiro: (id: string, data: Partial<{ description: string; category: string; amount: number; due_date: string; observation: string | null }>) =>
    req<FinanceiroEntry>(`/financeiro/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  payFinanceiro: (id: string, paidAmount?: number) =>
    req<FinanceiroEntry>(`/financeiro/${id}/pay`, { method: 'PATCH', body: JSON.stringify(paidAmount != null ? { paid_amount: paidAmount } : {}) }),
  reopenFinanceiro: (id: string) => req<FinanceiroEntry>(`/financeiro/${id}/reabrir`, { method: 'PATCH' }),
  deleteFinanceiro: (id: string) => req<{ ok: boolean }>(`/financeiro/${id}`, { method: 'DELETE' }),
  resumoFinanceiro: (month?: string) => req<FinanceiroResumo>(`/financeiro/resumo${month ? `?month=${month}` : ''}`),
  analiseFinanceira: (dateFrom: string, dateTo: string) =>
    req<AnaliseFinanceira>(`/financeiro/analise?date_from=${dateFrom}&date_to=${dateTo}`),
  // Fornecedores
  createFornecedor: (data: { name: string; category?: string | null; phone?: string | null; email?: string | null; document?: string | null; observation?: string | null }) =>
    req<Fornecedor>('/fornecedores', { method: 'POST', body: JSON.stringify(data) }),
  listFornecedores: (active?: boolean) => req<Fornecedor[]>(`/fornecedores${active != null ? `?active=${active}` : ''}`),
  updateFornecedor: (id: string, data: Partial<{ name: string; category: string | null; phone: string | null; email: string | null; document: string | null; observation: string | null }>) =>
    req<Fornecedor>(`/fornecedores/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  setFornecedorActive: (id: string, active: boolean) =>
    req<Fornecedor>(`/fornecedores/${id}/active`, { method: 'PATCH', body: JSON.stringify({ active }) }),
  deleteFornecedor: (id: string) => req<{ ok: boolean }>(`/fornecedores/${id}`, { method: 'DELETE' }),
  // Recorrências (cobranças/pagamentos automáticos mês a mês)
  listRecorrencias: (kind?: FinanceiroKind) => req<Recorrencia[]>(`/financeiro/recorrencias${kind ? `?kind=${kind}` : ''}`),
  setRecorrenciaActive: (id: string, active: boolean) =>
    req<Recorrencia>(`/financeiro/recorrencias/${id}/active`, { method: 'PATCH', body: JSON.stringify({ active }) }),
  deleteRecorrencia: (id: string) => req<{ ok: boolean }>(`/financeiro/recorrencias/${id}`, { method: 'DELETE' }),
  // Lista de compras (conveniência)
  createCompraItem: (data: { name: string; quantity?: string | null; observation?: string | null }) =>
    req<CompraItem>('/lista-compras', { method: 'POST', body: JSON.stringify(data) }),
  listCompraItems: (done?: boolean) => req<CompraItem[]>(`/lista-compras${done != null ? `?done=${done}` : ''}`),
  updateCompraItem: (id: string, data: Partial<{ name: string; quantity: string | null; observation: string | null }>) =>
    req<CompraItem>(`/lista-compras/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  setCompraItemDone: (id: string, done: boolean) =>
    req<CompraItem>(`/lista-compras/${id}/done`, { method: 'PATCH', body: JSON.stringify({ done }) }),
  deleteCompraItem: (id: string) => req<{ ok: boolean }>(`/lista-compras/${id}`, { method: 'DELETE' }),
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
export type OrderStatus = 'pendente' | 'em_preparo' | 'pronto' | 'entregue' | 'cancelada';

export type WeeklyDay = {
  date: string;
  label: string;
  movements: number;
  revenue: number;
};
export type ConvenienceOrder = {
  id: string;
  cpf: string;
  user_name: string;
  boat_name?: string | null;
  items: { product_id: string; name: string; price: number; qty: number }[];
  total: number;
  observation?: string | null;
  delivery_method?: 'balcao' | 'lancha';
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
  validity_type?: 'data' | 'periodo' | 'recorrente';
  date?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  can_lower?: boolean;
  service?: string | null;
  status: 'ativa' | 'cancelada';
  entered_at?: string | null;
  created_at: string;
};

export type AppNotification = {
  id: string;
  cpf: string;
  title: string;
  body: string;
  kind: string;
  ref_id?: string | null;
  read: boolean;
  created_at: string;
};

/** An authorization is valid for a given day (YYYY-MM-DD) based on its validity type. */
export function isAuthValidOn(a: Authorization, iso: string): boolean {
  const vtype = a.validity_type || 'data';
  if (vtype === 'recorrente') return true;
  if (vtype === 'periodo') {
    const start = a.start_date || a.date;
    const end = a.end_date || a.date;
    if (!start || !end) return false;
    return iso >= start && iso <= end;
  }
  return a.date === iso;
}

/** Human label describing an authorization's validity. */
export function authValidityLabel(a: Authorization): string {
  const vtype = a.validity_type || 'data';
  const br = (iso?: string | null) => {
    if (!iso) return '';
    const [y, m, d] = iso.split('-');
    return `${d}/${m}/${y}`;
  };
  if (vtype === 'recorrente') return 'Sem validade (até cancelar)';
  if (vtype === 'periodo') return `${br(a.start_date)} até ${br(a.end_date)}`;
  return br(a.date);
}
export type ServicoType = 'lavagem' | 'marinheiro' | 'abastecimento';
export type ServicoStatus = 'pendente' | 'em_andamento' | 'concluido' | 'cancelado';

export const SERVICO_LABELS: Record<ServicoType, string> = {
  lavagem: 'Lavagem de Lancha',
  marinheiro: 'Marinheiro',
  abastecimento: 'Abastecimento de Combustível',
};

export type Servico = {
  id: string;
  cpf: string;
  user_name: string;
  boat_name?: string | null;
  type: ServicoType;
  desired_date?: string | null;
  desired_time?: string | null;
  observation?: string | null;
  status: ServicoStatus;
  created_at: string;
  updated_at: string;
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

export type FaturaOrder = { id: string; total: number; created_at: string; items: { name: string; price: number; qty: number }[] };
export type FaturaReboque = { id: string; amount: number; billed_at?: string | null };

export type FaturaBase = {
  boat_name: string;
  period_start: string; // YYYY-MM-DD
  period_end: string; // YYYY-MM-DD
  due_date: string; // YYYY-MM-DD
  mensalidade: number;
  convenience_total: number;
  reboque_total: number;
  total: number;
  orders: FaturaOrder[];
  reboques: FaturaReboque[];
};

export type FaturaPreview = FaturaBase & { send_date: string };
export type FaturaPreviewResponse = { cpf: string; user_name: string; faturas: FaturaPreview[] };

export type Fatura = FaturaBase & {
  id: string;
  cpf: string;
  user_name: string;
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

export type MensalidadeVencendo = {
  cpf: string;
  client_name: string;
  boat_name: string;
  monthly_fee?: number | null;
  valid_until: string; // YYYY-MM-DD
  days_remaining: number;
};

export type PontoType = 'entrada' | 'saida_almoco' | 'retorno_almoco' | 'saida_final';

export const PONTO_LABELS: Record<PontoType, string> = {
  entrada: 'Entrada',
  saida_almoco: 'Saída Almoço',
  retorno_almoco: 'Retorno Almoço',
  saida_final: 'Saída Final',
};

export type PontoEntry = {
  id: string;
  cpf: string;
  user_name: string;
  type: PontoType;
  date: string; // YYYY-MM-DD
  time: string; // HH:MM
  edited: boolean;
  created_at: string;
  updated_at: string;
};

export type PontoRelatorioDia = { date: string; hours: number } & Partial<Record<PontoType, string>>;
export type PontoRelatorioFuncionario = { cpf: string; name: string; total_hours: number; days: PontoRelatorioDia[] };
export type PontoRelatorio = { date_from: string; date_to: string; employees: PontoRelatorioFuncionario[] };

export type EscalaStaffMember = { cpf: string; name: string };

export type EscalaGerarResult = {
  created: EscalaEntry[];
  skipped: { date: string; reason: string }[];
};

export type EscalaEntry = {
  id: string;
  date: string; // YYYY-MM-DD
  cpf: string;
  user_name: string;
  observation?: string | null;
  created_at: string;
};

export type FinanceiroKind = 'pagar' | 'receber';
export type FinanceiroStatus = 'pendente' | 'atrasado' | 'pago';

export type FinanceiroEntry = {
  id: string;
  kind: FinanceiroKind;
  description: string;
  category: string;
  amount: number;
  due_date: string; // YYYY-MM-DD
  cpf?: string | null;
  client_name?: string | null;
  boat_name?: string | null;
  supplier_name?: string | null;
  observation?: string | null;
  status: 'pendente' | 'pago';
  status_display: FinanceiroStatus;
  paid_amount?: number | null;
  paid_at?: string | null;
  recurring_id?: string | null;
  created_at: string;
  updated_at: string;
};

export type FinanceiroTotals = { pendente: number; atrasado: number; pago: number };
export type FinanceiroResumo = {
  month: string;
  pagar: FinanceiroTotals;
  receber: FinanceiroTotals;
  saldo_previsto: number;
};

export type Fornecedor = {
  id: string;
  name: string;
  category?: string | null;
  phone?: string | null;
  email?: string | null;
  document?: string | null;
  observation?: string | null;
  active: boolean;
  created_at: string;
  updated_at: string;
};

export type AnaliseCategoria = { category: string; total: number };
export type AnaliseMes = { month: string; pagar: number; receber: number };
export type AnaliseFinanceira = {
  date_from: string;
  date_to: string;
  receber: { total: number; by_category: AnaliseCategoria[] };
  pagar: { total: number; by_category: AnaliseCategoria[] };
  saldo: number;
  by_month: AnaliseMes[];
};

export type CompraItem = {
  id: string;
  name: string;
  quantity?: string | null;
  observation?: string | null;
  done: boolean;
  created_at: string;
  updated_at: string;
};

export type Recorrencia = {
  id: string;
  kind: FinanceiroKind;
  description: string;
  category: string;
  amount: number;
  day: number;
  end_date?: string | null; // YYYY-MM-DD; null/ausente = recorrente até cancelar
  cpf?: string | null;
  client_name?: string | null;
  boat_name?: string | null;
  supplier_name?: string | null;
  observation?: string | null;
  active: boolean;
  created_at: string;
  updated_at: string;
};
