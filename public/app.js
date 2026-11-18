'use strict';

/* =========================================================
   Orçamentos de Transporte — módulo do Portal Táxi 2.0
   A equipe entra pelo cartão do portal (…/#passe=…); os dados ficam no servidor (/api).
   Rotas (hash, área da equipe):
     #/              lista de propostas
     #/novo          cria proposta e abre o editor
     #/editar/:id    editor com pré-visualização ao vivo
     #/ver/:id       visualização como o cliente verá
     #/empresa       dados da empresa (marca, contato, padrões)
   Página do cliente (sem login): /p/:codigo
   ========================================================= */

const app = document.getElementById('app');

const PORTAL_URL = 'https://apptx20.agenciatx.ia.br';
const LOGO_TAXI20 = 'https://i.postimg.cc/Ghkvc51M/1.png';

const DEFAULT_COND = [
  'Valores válidos para o trajeto, as datas e as quantidades descritos nesta proposta.',
  'Alterações de endereço, horário, paradas extras ou número de passageiros podem gerar revisão dos valores.',
  'Tempo de espera acima do combinado será cobrado à parte.',
  'Pedágios e estacionamentos só estão incluídos quando aparecem nos adicionais.',
].join('\n');

const STATUS = {
  rascunho: ['Rascunho', 'gray'],
  enviada: ['Enviada', 'blue'],
  aprovada: ['Aprovada', 'green'],
  recusada: ['Recusada', 'red'],
};

const TIPOS_SERVICO = ['Transfer aeroporto', 'Transporte executivo', 'Corrida de táxi', 'Viagem intermunicipal', 'Diária à disposição', 'Evento / casamento', 'Contrato para empresa', 'Outro'];
const TRAJETOS = ['Só ida', 'Ida e volta'];
const VEICULOS = ['Táxi comum', 'Sedan', 'Sedan executivo', 'SUV executivo', 'Carro blindado', 'Minivan'];

/* ---------- Comunicação com o servidor ---------- */
async function api(metodo, caminho, corpo) {
  let r;
  try {
    r = await fetch(caminho, {
      method: metodo,
      headers: corpo !== undefined ? { 'Content-Type': 'application/json' } : {},
      body: corpo !== undefined ? JSON.stringify(corpo) : undefined,
      credentials: 'same-origin',
    });
  } catch {
    const e = new Error('Sem conexão com o servidor. Confira a internet.'); e.status = 0; throw e;
  }
  let j = {};
  try { j = await r.json(); } catch { /* resposta vazia */ }
  if (!r.ok) { const e = new Error(j.erro || 'Falha ao falar com o servidor.'); e.status = r.status; throw e; }
  return j;
}

/* Estado em memória (vem do servidor ao abrir) */
const S = { usuario: null, empresa: null, propostas: [] };
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const n = v => { const x = parseFloat(v); return Number.isFinite(x) ? x : 0; };
const brl = v => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(n(v));
const fmtNum = (v, d = 2) => new Intl.NumberFormat('pt-BR', { maximumFractionDigits: d }).format(n(v));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const pad = x => String(x).padStart(2, '0');
const today = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const parseDate = s => (s ? new Date(s + 'T00:00:00') : null);
const fmtDate = d => { if (!d) return ''; if (typeof d === 'string') d = parseDate(d); return isNaN(d) ? '' : d.toLocaleDateString('pt-BR'); };
const fmtDataHora = ms => { const d = new Date(ms); return isNaN(d) ? '' : `${d.toLocaleDateString('pt-BR')} às ${d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`; };
const quandoTexto =(d, h) => [fmtDate(d), h ? `às ${h}` : ''].filter(Boolean).join(' ');
const addDays = (s, k) => { const d = parseDate(s) || parseDate(today()); d.setDate(d.getDate() + k); return d; };
const daysUntil = d => Math.round((d - parseDate(today())) / 864e5);
const initials = s => (String(s || '').trim().split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('') || 'T').toUpperCase();
const safeUrl = u => { u = String(u || '').trim(); if (!u) return ''; if (/^(https?:|data:image\/)/i.test(u)) return u; return 'https://' + u; };
const digits = s => String(s || '').replace(/\D/g, '');
const waNumber = t => { let d = digits(t); if (!d) return ''; if (d.length <= 11) d = '55' + d; return d; };

function setPath(obj, path, val) {
  const ks = path.split('.'); let o = obj;
  ks.slice(0, -1).forEach(k => { o[k] = o[k] ?? {}; o = o[k]; });
  o[ks.at(-1)] = val;
}

let toastT;
function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 2200);
}

async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; }
  catch {
    const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select();
    let ok = false; try { ok = document.execCommand('copy'); } catch { /* noop */ }
    ta.remove(); return ok;
  }
}

function modal(html) {
  const m = document.createElement('div');
  m.className = 'modal-wrap';
  m.innerHTML = `<div class="modal" role="dialog" aria-modal="true">${html}</div>`;
  m.addEventListener('click', ev => { if (ev.target === m || ev.target.closest('[data-close]')) m.remove(); });
  document.addEventListener('keydown', function onKey(ev) { if (ev.key === 'Escape') { m.remove(); document.removeEventListener('keydown', onKey); } });
  document.body.appendChild(m);
  return m;
}

/* ---------- Ícones ---------- */
const ICONS = {
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>',
  car: '<path d="M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9C18.7 10.6 16 10 16 10s-1.3-1.4-2.2-2.3c-.5-.4-1.1-.7-1.8-.7H5c-.6 0-1.1.4-1.4.9l-1.4 2.9A3.7 3.7 0 0 0 2 12v4c0 .6.4 1 1 1h2"/><circle cx="7" cy="17" r="2"/><path d="M9 17h6"/><circle cx="17" cy="17" r="2"/>',
  suitcase: '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M8 12v3M16 12v3"/>',
  plane: '<path d="M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z"/>',
  repeat: '<path d="m17 1 4 4-4 4"/><path d="M3 11V9a4 4 0 0 1 4-4h14M7 23l-4-4 4-4"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/>',
  pin: '<path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0z"/><circle cx="12" cy="10" r="3"/>',
  calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
  box: '<path d="M21 8 12 3 3 8v8l9 5 9-5z"/><path d="m3 8 9 5 9-5M12 13v8"/>',
  clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  trash: '<path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/>',
  copy: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  share: '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.6 13.5 6.8 4M15.4 6.5l-6.8 4"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/>',
  print: '<path d="M6 9V2h12v7"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/>',
  eye: '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8S1 12 1 12z"/><circle cx="12" cy="12" r="3"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  settings: '<path d="M3 21v-7M3 10V3M12 21v-9M12 8V3M21 21v-5M21 12V3M1 14h4M10 8h4M19 16h4"/>',
  back: '<path d="M19 12H5M12 19l-7-7 7-7"/>',
  search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  star: '<path d="m12 2 3.1 6.3 6.9 1-5 4.9 1.2 6.8-6.2-3.2L5.8 21 7 14.2 2 9.3l6.9-1z"/>',
  user: '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
  building: '<rect x="4" y="2" width="16" height="20" rx="2"/><path d="M9 22v-4h6v4M8 6h.01M16 6h.01M12 6h.01M12 10h.01M12 14h.01M16 10h.01M16 14h.01M8 10h.01M8 14h.01"/>',
  phone: '<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2z"/>',
  mail: '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 6-10 7L2 6"/>',
  globe: '<circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15 15 0 0 1 0 20M12 2a15 15 0 0 0 0 20"/>',
  file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M16 13H8M16 17H8M10 9H8"/>',
  weight: '<circle cx="12" cy="5" r="3"/><path d="M6.5 8h11l2.5 13H4z"/>',
  cube: '<path d="M21 16V8l-9-5-9 5v8l9 5z"/><path d="M3.3 7 12 12l8.7-5M12 22V12"/>',
  layers: '<path d="m12 2 10 5-10 5L2 7z"/><path d="m2 17 10 5 10-5M2 12l10 5 10-5"/>',
  shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
  tag: '<path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L2 12V2h10l8.6 8.6a2 2 0 0 1 0 2.8z"/><circle cx="7" cy="7" r="1.5"/>',
  card: '<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/>',
  route: '<circle cx="6" cy="19" r="3"/><circle cx="18" cy="5" r="3"/><path d="M9 19h8.5a3.5 3.5 0 0 0 0-7h-11a3.5 3.5 0 0 1 0-7H15"/>',
  whatsapp: '<path d="M3 21l1.7-5A9 9 0 1 1 8 19.3z"/><path d="M9 10a.5.5 0 0 0 1 0V9a.5.5 0 0 0-1 0v1a5 5 0 0 0 5 5h1a.5.5 0 0 0 0-1h-1a.5.5 0 0 0 0 1"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>',
  upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12"/>',
  alert: '<circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/>',
};
const ic = name => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ''}</svg>`;

/* ---------- Dados (no servidor; aqui só a cópia em memória) ---------- */
const getQuotes = () => S.propostas;
const getQuote = id => S.propostas.find(q => q.id === id);

const pendentes = new Map(); // id -> timer de salvamento
let falhaAoSalvar = false;
function estadoSalvo() {
  const el = document.getElementById('saved'); if (!el) return;
  el.textContent = falhaAoSalvar ? 'Erro ao salvar' : pendentes.size ? 'Salvando…' : 'Salvo';
  el.classList.toggle('erro', falhaAoSalvar);
}
let emVoo = 0;
async function enviarProposta(id) {
  pendentes.delete(id);
  emVoo++;
  const q = getQuote(id); if (!q) return;
  try {
    const { proposta } = await api('PUT', `/api/propostas/${encodeURIComponent(id)}`, { dados: q });
    q.atualizadoPor = proposta.atualizadoPor;
    falhaAoSalvar = false;
  } catch (e) {
    falhaAoSalvar = true;
    toast(e.status === 401 ? 'Sua sessão terminou. Abra de novo pelo portal.' : e.message);
  }
  emVoo--;
  estadoSalvo();
}
/** Salva com um pequeno atraso (enquanto a pessoa digita). */
function saveQuote(q) {
  q.atualizadoEm = Date.now();
  clearTimeout(pendentes.get(q.id));
  pendentes.set(q.id, setTimeout(() => enviarProposta(q.id), 700));
  estadoSalvo();
  return true;
}
/** Envia agora o que estiver esperando (ao trocar de tela). */
function salvarPendentes() {
  for (const [id, t] of [...pendentes]) { clearTimeout(t); enviarProposta(id); }
}
window.addEventListener('beforeunload', ev => { if (pendentes.size || empresaPendente) { salvarPendentes(); salvarEmpresaAgora(); ev.preventDefault(); ev.returnValue = ''; } });

async function createQuote(dados) {
  const { proposta } = await api('POST', '/api/propostas', { dados });
  S.propostas.unshift(proposta);
  return proposta;
}
async function deleteQuote(id) {
  await api('DELETE', `/api/propostas/${encodeURIComponent(id)}`);
  S.propostas = S.propostas.filter(q => q.id !== id);
}

const EMP_DEFAULT = {
  nome: 'Táxi 2.0', cnpj: '38.226.036/0001-60', telefone: '', email: '', site: '', endereco: 'São José dos Pinhais, PR',
  logo: LOGO_TAXI20, cor: '#0f2744', pagamento: '', condicoes: DEFAULT_COND, validade: 7,
  tarifas: [
    { veiculo: 'Táxi comum', bandeirada: '', valorKm: '', minimo: '' },
    { veiculo: 'Sedan executivo', bandeirada: '', valorKm: '', minimo: '' },
    { veiculo: 'SUV executivo', bandeirada: '', valorKm: '', minimo: '' },
  ],
};
const getEmpresa = () => ({ ...EMP_DEFAULT, ...(S.empresa || {}) });
let empresaPendente = null;
function saveEmpresa(e) {
  S.empresa = { ...e };
  clearTimeout(empresaPendente);
  empresaPendente = setTimeout(salvarEmpresaAgora, 700);
  estadoSalvo();
}
async function salvarEmpresaAgora() {
  if (!empresaPendente) return;
  clearTimeout(empresaPendente); empresaPendente = null;
  try { await api('PUT', '/api/empresa', { empresa: S.empresa }); falhaAoSalvar = false; }
  catch (e) { falhaAoSalvar = true; toast(e.message); }
  estadoSalvo();
}

function newQuoteData() {
  const e = getEmpresa();
  return {
    status: 'rascunho', data: today(), validadeDias: n(e.validade) || 7, criadoEm: Date.now(),
    cliente: { nome: '', empresa: '', documento: '', telefone: '', email: '' },
    rota: { origem: '', destino: '', distanciaKm: '', coleta: '', hora: '', entrega: '', horaRetorno: '' },
    carga: { tipo: TIPOS_SERVICO[0], trajeto: TRAJETOS[0], passageiros: '', quantidade: '', voo: '', descricao: '' },
    opcoes: [
      { nome: 'Táxi', veiculo: 'Táxi comum', prazo: '', valor: '', descricao: '', recomendado: false },
      { nome: 'Executivo', veiculo: 'Sedan executivo', prazo: '', valor: '', descricao: 'Motorista de traje social, água a bordo e espera no desembarque.', recomendado: true },
    ],
    adicionais: [],
    desconto: '', descontoTipo: 'R$',
    pagamento: e.pagamento || '', observacoes: '', condicoes: e.condicoes ?? DEFAULT_COND,
  };
}

/* ---------- Cálculos ---------- */
function calc(q, o) {
  const base = n(o.valor);
  const ad = (q.adicionais || []).reduce((s, a) => s + n(a.valor), 0);
  const sub = base + ad;
  let desc = q.descontoTipo === '%' ? sub * n(q.desconto) / 100 : n(q.desconto);
  desc = Math.min(Math.max(desc, 0), sub);
  return { base, ad, sub, desc, total: sub - desc };
}
const visibleOptions = q => (q.opcoes || []).filter(o => String(o.nome || '').trim() || n(o.valor) > 0);
function mainOption(q) {
  const os = visibleOptions(q).filter(o => n(o.valor) > 0);
  if (!os.length) return null;
  return os.find(o => o.recomendado) || os.reduce((a, b) => (n(a.valor) <= n(b.valor) ? a : b));
}
const mainTotal = q => { const o = mainOption(q); return o ? calc(q, o).total : 0; };
const validUntil = q => (n(q.validadeDias) > 0 ? addDays(q.data, n(q.validadeDias)) : null);
const isExpired = q => { const v = validUntil(q); return !!v && daysUntil(v) < 0; };

/* ---------- Link do cliente ---------- */
const shareUrl = q => `${location.origin}/p/${q.token}`;

/** Depois de aprovar: link para o cliente avisar a empresa (WhatsApp ou e-mail). */
function avisoLink(q, e) {
  const a = q.aprovacao || {};
  const msg = `Olá${e.nome ? ', ' + e.nome : ''}! Acabei de aprovar a proposta Nº ${q.numero} — opção "${a.opcao || ''}" no valor de ${brl(a.valor)}.`;
  const ph = waNumber(e.telefone);
  if (ph) return `https://wa.me/${ph}?text=${encodeURIComponent(msg)}`;
  if (e.email) return `mailto:${e.email}?subject=${encodeURIComponent('Aprovação da proposta ' + q.numero)}&body=${encodeURIComponent(msg)}`;
  return '';
}

/* =========================================================
   PROPOSTA — o que o cliente vê
   ========================================================= */
function logoHTML(e) {
  return e.logo ? `<img src="${esc(safeUrl(e.logo))}" alt="${esc(e.nome)}">` : esc(initials(e.nome));
}

function renderProposal(q, e, { interactive = false } = {}) {
  const c = q.cliente || {}, r = q.rota || {}, g = q.carga || {};
  const idaVolta = g.trajeto === 'Ida e volta';
  const opcoes = visibleOptions(q);
  const vu = validUntil(q);
  const left = vu ? daysUntil(vu) : null;
  const clientName = c.empresa || c.nome;

  let validity = '';
  if (q.status === 'aprovada') validity = `<span class="p-chip ok">${ic('check')} Proposta aprovada</span>`;
  else if (vu && left < 0) validity = `<span class="p-chip bad">${ic('alert')} Expirou em ${fmtDate(vu)}</span>`;
  else if (vu) validity = `<span class="p-chip ${left <= 2 ? 'warn' : ''}">${ic('clock')} Válida até ${fmtDate(vu)}${left === 0 ? ' · último dia' : left <= 3 ? ` · faltam ${left} dia${left > 1 ? 's' : ''}` : ''}</span>`;

  const routeTitle = r.origem && r.destino ? `${esc(r.origem)} → ${esc(r.destino)}` : 'Proposta de transporte';

  const clientLines = [
    c.empresa && c.nome ? [ic('user'), c.nome] : null,
    c.documento ? [ic('file'), c.documento] : null,
    c.telefone ? [ic('phone'), c.telefone] : null,
    c.email ? [ic('mail'), c.email] : null,
  ].filter(Boolean);

  const facts = [
    ['tag', 'Serviço', g.tipo],
    ['user', 'Passageiros', n(g.passageiros) ? fmtNum(g.passageiros, 0) : ''],
    ['repeat', 'Trajeto', g.trajeto],
    ['suitcase', 'Malas', n(g.quantidade) ? fmtNum(g.quantidade, 0) : ''],
    ['plane', 'Voo', g.voo],
  ].filter(f => f[2]);

  const hasBreakdown = (q.adicionais || []).some(a => n(a.valor)) || n(q.desconto) > 0;

  const aprovada = q.status === 'aprovada' && q.aprovacao;
  const podeAprovar = interactive && q.status !== 'aprovada' && q.status !== 'recusada' && !isExpired(q);
  const optionCard = o => {
    const t = calc(q, o);
    const escolhida = aprovada && q.aprovacao.opcao === (o.nome || 'Transporte');
    const destaque = aprovada ? escolhida : (o.recomendado && opcoes.length > 1) || opcoes.length === 1;
    const badge = escolhida ? `<span class="rec-badge ok">${ic('check')} Opção aprovada</span>`
      : !aprovada && o.recomendado && opcoes.length > 1 ? `<span class="rec-badge">${ic('star')} Recomendado</span>` : '';
    return `<article class="option ${destaque ? 'is-rec' : ''} ${aprovada && !escolhida ? 'is-dim' : ''}">
      ${badge}
      <h3>${esc(o.nome || 'Transporte')}</h3>
      ${o.veiculo || o.prazo ? `<div class="opt-meta">${o.veiculo ? `<span>${ic('car')}${esc(o.veiculo)}</span>` : ''}${o.prazo ? `<span>${ic('clock')}${esc(o.prazo)}</span>` : ''}</div>` : ''}
      ${o.descricao ? `<p>${esc(o.descricao)}</p>` : ''}
      <div class="option-spacer"></div>
      <div class="opt-price"><small>Valor total</small><strong>${brl(t.total)}</strong></div>
      ${hasBreakdown ? `<dl class="breakdown">
        <div><dt>Transporte</dt><dd>${brl(t.base)}</dd></div>
        ${(q.adicionais || []).filter(a => n(a.valor)).map(a => `<div><dt>${esc(a.descricao || 'Adicional')}</dt><dd>${brl(a.valor)}</dd></div>`).join('')}
        ${t.desc > 0 ? `<div class="minus"><dt>Desconto${q.descontoTipo === '%' ? ` (${fmtNum(q.desconto)}%)` : ''}</dt><dd>− ${brl(t.desc)}</dd></div>` : ''}
      </dl>` : ''}
      ${podeAprovar && n(o.valor) > 0 ? `<button type="button" class="btn btn-brand no-print" data-aprovar="${(q.opcoes || []).indexOf(o)}">${ic('check')} Aprovar esta opção</button>` : ''}
    </article>`;
  };

  const condList = String(q.condicoes || '').split('\n').map(s => s.trim()).filter(Boolean);
  const contacts = [
    e.telefone ? `<a href="${waNumber(e.telefone) ? 'https://wa.me/' + waNumber(e.telefone) : 'tel:' + digits(e.telefone)}" target="_blank" rel="noopener">${ic('phone')}${esc(e.telefone)}</a>` : '',
    e.email ? `<a href="mailto:${esc(e.email)}">${ic('mail')}${esc(e.email)}</a>` : '',
    e.site ? `<a href="${esc(safeUrl(e.site))}" target="_blank" rel="noopener">${ic('globe')}${esc(e.site)}</a>` : '',
    e.endereco ? `<span>${ic('pin')}${esc(e.endereco)}</span>` : '',
  ].join('');

  return `<div class="proposal" style="--brand:${esc(/^#[0-9a-f]{3,8}$/i.test(e.cor) ? e.cor : '#1d4ed8')}">
    <header class="p-hero">
      <div class="p-top">
        <div class="p-brand">
          <div class="p-logo">${logoHTML(e)}</div>
          <div><strong>${esc(e.nome || 'Sua empresa')}</strong>${e.cnpj ? `<small>CNPJ ${esc(e.cnpj)}</small>` : ''}</div>
        </div>
        <div class="p-num"><b>Proposta Nº ${esc(q.numero)}</b>Emitida em ${fmtDate(q.data)}</div>
      </div>
      <p class="p-kicker">Orçamento de transporte${clientName ? ' para ' + esc(clientName) : ''}</p>
      <h1 class="p-title">${routeTitle}</h1>
      <div class="p-hero-foot">
        ${n(r.distanciaKm) ? `<span class="p-chip">${ic('route')} ${fmtNum(r.distanciaKm, 0)} km${idaVolta ? ' cada trecho' : ''}</span>` : ''}
        ${r.coleta ? `<span class="p-chip">${ic('calendar')} ${quandoTexto(r.coleta, r.hora)}</span>` : ''}
        ${idaVolta ? `<span class="p-chip">${ic('repeat')} Ida e volta</span>` : ''}
        ${opcoes.length > 1 ? `<span class="p-chip">${ic('layers')} ${opcoes.length} opções</span>` : ''}
        ${validity}
      </div>
    </header>

    ${q.status === 'recusada' ? `<div class="p-status bad">${ic('x')} Esta proposta foi recusada ou cancelada.</div>` : ''}
    ${aprovada ? `<div class="p-status ok">${ic('check')}
      <span>Aprovada por <b>${esc(q.aprovacao.por)}</b> em ${fmtDataHora(q.aprovacao.em)} — opção <b>${esc(q.aprovacao.opcao)}</b> (${brl(q.aprovacao.valor)}).</span>
      ${interactive && avisoLink(q, e) ? `<a class="btn btn-sm no-print" href="${esc(avisoLink(q, e))}" target="_blank" rel="noopener">${ic('phone')}Avisar a empresa</a>` : ''}
    </div>` : ''}

    <div class="p-cols">
      <section class="p-section p-client">
        <h2>${ic('building')} Cliente</h2>
        <strong>${esc(clientName || '—')}</strong>
        ${clientLines.map(([i, t]) => `<div class="line">${i}${esc(t)}</div>`).join('')}
      </section>
      <section class="p-section">
        <h2>${ic('route')} Rota</h2>
        <div class="route">
          <div class="route-pt"><small>Origem</small><strong>${esc(r.origem || '—')}</strong>${r.coleta || r.hora ? `<span>Embarque: ${quandoTexto(r.coleta, r.hora)}</span>` : ''}</div>
          <div class="route-line"><span class="vehicle">${ic('car')}</span>${n(r.distanciaKm) ? `<em>${fmtNum(r.distanciaKm, 0)} km</em>` : ''}</div>
          <div class="route-pt end"><small>Destino</small><strong>${esc(r.destino || '—')}</strong>${idaVolta && (r.entrega || r.horaRetorno) ? `<span>Retorno: ${quandoTexto(r.entrega, r.horaRetorno)}</span>` : ''}</div>
        </div>
      </section>
    </div>

    ${facts.length || g.descricao ? `<section class="p-section">
      <h2>${ic('user')} Detalhes da viagem</h2>
      <div class="facts">
        ${facts.map(([i, l, v]) => `<div class="fact"><small>${ic(i)}${l}</small><strong>${esc(v)}</strong></div>`).join('')}
        ${g.descricao ? `<div class="fact wide"><small>${ic('file')}Descrição</small><strong>${esc(g.descricao)}</strong></div>` : ''}
      </div>
    </section>` : ''}

    <section class="p-section">
      <h2>${ic('car')} ${opcoes.length > 1 ? 'Opções de veículo' : 'Valor'}</h2>
      ${opcoes.length ? `<div class="options">${opcoes.map(optionCard).join('')}</div>` : '<p style="color:var(--muted);margin:0">Nenhuma opção cadastrada.</p>'}
    </section>

    ${q.pagamento || q.observacoes || condList.length ? `<section class="p-section">
      <h2>${ic('file')} Condições</h2>
      <div class="terms">
        ${q.pagamento ? `<div><h4>Pagamento</h4><p>${esc(q.pagamento)}</p></div>` : ''}
        ${q.observacoes ? `<div><h4>Observações</h4><p>${esc(q.observacoes)}</p></div>` : ''}
        ${condList.length ? `<div><h4>Condições gerais</h4><ul>${condList.map(l => `<li>${esc(l)}</li>`).join('')}</ul></div>` : ''}
      </div>
    </section>` : ''}

    <footer class="p-footer">
      <div class="p-contacts">${contacts}</div>
      <span>Proposta Nº ${esc(q.numero)} · ${esc(e.nome || '')}</span>
    </footer>
  </div>`;
}

/* =========================================================
   TELAS
   ========================================================= */
function topbarBrand() {
  const e = getEmpresa();
  return `<a href="#/" class="app-mark" title="Início" style="text-decoration:none">${ic('car')}</a>
    <h1>Orçamentos${e.nome ? ` <span style="color:var(--muted);font-weight:500">· ${esc(e.nome)}</span>` : ''}</h1>`;
}

/* ---------- Lista ---------- */
function vistoTexto(q) {
  if (q.status === 'rascunho') return '';
  if (q.aprovacao) return `<small class="seen">${ic('check')} ${esc(q.aprovacao.por.split(' ')[0])} · ${fmtCurto(q.aprovacao.em)}</small>`;
  const v = q.visto || {};
  if (!v.vezes) return '<small class="seen muted">Cliente ainda não abriu</small>';
  return `<small class="seen">${ic('eye')} Visto ${v.vezes}× · ${fmtCurto(v.ultimo)}</small>`;
}
const fmtCurto = ms => { const d = new Date(ms); return isNaN(d) ? '' : `${d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })} ${d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`; };

function statusPill(q) {
  if ((q.status === 'enviada' || q.status === 'rascunho') && isExpired(q)) return '<span class="pill amber">Expirada</span>';
  const [l, c] = STATUS[q.status] || STATUS.rascunho;
  return `<span class="pill ${c}">${l}</span>`;
}

async function atualizarDoServidor() {
  if (pendentes.size || emVoo) return false;
  try {
    const d = await api('GET', '/api/dados');
    if (pendentes.size || emVoo) return false;
    S.propostas = d.propostas || []; S.empresa = d.empresa;
    return true;
  } catch { return false; }
}

function viewList(jaAtualizado) {
  if (!jaAtualizado) atualizarDoServidor().then(ok => { if (ok && ['', '#', '#/'].includes(location.hash)) viewList(true); });
  document.title = 'Orçamentos de Transporte';
  const all = getQuotes().sort((a, b) => b.atualizadoEm - a.atualizadoEm);
  const open = all.filter(q => q.status === 'enviada' && !isExpired(q));
  const ok = all.filter(q => q.status === 'aprovada');
  const sum = arr => arr.reduce((s, q) => s + mainTotal(q), 0);
  const rate = all.filter(q => q.status !== 'rascunho').length ? Math.round(ok.length / all.filter(q => q.status !== 'rascunho').length * 100) : 0;

  app.innerHTML = `
    <header class="topbar">
      ${topbarBrand()}
      <div class="spacer"></div>
      <span class="user-chip hide-sm" title="${esc(S.usuario?.email)}">${ic('user')}${esc(S.usuario?.nome || '')}</span>
      <a class="btn btn-ghost" href="#/empresa">${ic('settings')}<span class="hide-sm">Minha empresa</span></a>
      <a class="btn btn-primary" href="#/novo">${ic('plus')}Nova proposta</a>
      <button class="icon-btn" id="sair" title="Sair">${ic('logout')}</button>
    </header>
    <main class="container">
      <div class="page-head">
        <div><h2>Propostas</h2><p>Crie, acompanhe e compartilhe orçamentos de transporte.</p></div>
      </div>
      <div class="stats">
        <div class="stat"><small>Total de propostas</small><strong>${all.length}</strong></div>
        <div class="stat"><small>Em aberto (${open.length})</small><strong>${brl(sum(open))}</strong></div>
        <div class="stat"><small>Aprovadas (${ok.length})</small><strong>${brl(sum(ok))}</strong></div>
        <div class="stat"><small>Taxa de aprovação</small><strong>${rate}%</strong></div>
      </div>
      <div class="toolbar">
        <label class="search">${ic('search')}<input id="q" type="search" placeholder="Buscar por cliente, cidade ou número…" aria-label="Buscar"></label>
        <select id="fs" style="width:auto" aria-label="Filtrar por status">
          <option value="">Todos os status</option>
          ${Object.entries(STATUS).map(([k, [l]]) => `<option value="${k}">${l}</option>`).join('')}
          <option value="expirada">Expirada</option>
        </select>
      </div>
      <div class="qlist" id="list"></div>
    </main>`;

  const list = document.getElementById('list');
  const qi = document.getElementById('q'), fs = document.getElementById('fs');

  const draw = () => {
    const term = qi.value.trim().toLowerCase();
    const st = fs.value;
    const rows = all.filter(q => {
      const hay = [q.numero, q.cliente?.nome, q.cliente?.empresa, q.rota?.origem, q.rota?.destino].join(' ').toLowerCase();
      if (term && !hay.includes(term)) return false;
      if (st === 'expirada') return q.status !== 'aprovada' && q.status !== 'recusada' && isExpired(q);
      if (st && q.status !== st) return false;
      return true;
    });
    if (!all.length) {
      list.innerHTML = `<div class="empty"><div class="big">${ic('file')}</div><h3>Nenhuma proposta ainda</h3><p>Crie sua primeira proposta de transporte.</p><a class="btn btn-primary" href="#/novo">${ic('plus')}Nova proposta</a></div>`;
      return;
    }
    if (!rows.length) { list.innerHTML = `<div class="empty"><h3>Nada encontrado</h3><p>Tente outro termo ou filtro.</p></div>`; return; }
    list.innerHTML = rows.map(q => `
      <div class="qrow">
        <a class="num main" href="#/editar/${q.id}">Nº ${esc(q.numero)}<small>${fmtDate(q.data)}${q.atualizadoPor ? ` · ${esc(q.atualizadoPor.split(' ')[0])}` : ''}</small></a>
        <a class="who main" href="#/editar/${q.id}"><strong>${esc(q.cliente?.empresa || q.cliente?.nome || 'Sem cliente')}</strong>${q.cliente?.empresa && q.cliente?.nome ? `<small>${esc(q.cliente.nome)}</small>` : ''}</a>
        <span class="route-s">${q.rota?.origem || q.rota?.destino ? `${esc(q.rota.origem || '?')} → ${esc(q.rota.destino || '?')}` : '<span style="color:var(--muted)">Rota não definida</span>'}</span>
        <span class="val">${mainTotal(q) ? brl(mainTotal(q)) : '—'}</span>
        <span class="pill-c">${statusPill(q)}${vistoTexto(q)}</span>
        <span class="acts">
          <a class="icon-btn" href="#/ver/${q.id}" title="Ver como o cliente">${ic('eye')}</a>
          <button class="icon-btn" data-act="share" data-id="${q.id}" title="Copiar link para o cliente">${ic('link')}</button>
          <button class="icon-btn" data-act="dup" data-id="${q.id}" title="Duplicar">${ic('copy')}</button>
          <button class="icon-btn danger" data-act="del" data-id="${q.id}" title="Excluir">${ic('trash')}</button>
        </span>
      </div>`).join('');
  };
  qi.addEventListener('input', draw);
  fs.addEventListener('change', draw);
  draw();

  document.getElementById('sair').addEventListener('click', async () => {
    salvarPendentes(); await salvarEmpresaAgora();
    try { await api('POST', '/api/sair', {}); } catch { /* já saiu */ }
    viewSemAcesso('Você saiu dos orçamentos.');
  });

  list.addEventListener('click', async ev => {
    const b = ev.target.closest('[data-act]'); if (!b) return;
    const q = getQuote(b.dataset.id); if (!q) return;
    if (b.dataset.act === 'share') openShare(q, viewList);
    if (b.dataset.act === 'dup') {
      const { id, numero, token, atualizadoEm, atualizadoPor, ...dados } = structuredClone(q);
      try {
        const c = await createQuote({ ...dados, status: 'rascunho', data: today(), criadoEm: Date.now() });
        toast(`Proposta duplicada como Nº ${c.numero}`); location.hash = '#/editar/' + c.id;
      } catch (e) { toast(e.message); }
    }
    if (b.dataset.act === 'del' && confirm(`Excluir a proposta Nº ${q.numero}? O link enviado ao cliente deixa de abrir.`)) {
      try { await deleteQuote(q.id); toast('Proposta excluída'); viewList(); } catch (e) { toast(e.message); }
    }
  });
}

/* ---------- Campos de formulário ---------- */
const P = path => `data-path="${path}"`;
const L = (list, i, k) => `data-list="${list}" data-i="${i}" data-k="${k}"`;
const inp = (label, bind, val, o = {}) => `<label class="fld${o.span ? ' span2' : ''}"><span>${label}</span><input type="${o.type || 'text'}" ${bind} value="${esc(val ?? '')}" placeholder="${esc(o.ph || '')}" ${o.attrs || ''}></label>`;
const area = (label, bind, val, o = {}) => `<label class="fld${o.span !== false ? ' span2' : ''}"><span>${label}</span><textarea ${bind} rows="${o.rows || 3}" placeholder="${esc(o.ph || '')}">${esc(val ?? '')}</textarea></label>`;
const sel = (label, bind, val, opts, o = {}) => `<label class="fld${o.span ? ' span2' : ''}"><span>${label}</span><select ${bind}>${opts.map(x => { const [v, l] = Array.isArray(x) ? x : [x, x]; return `<option value="${esc(v)}" ${String(v) === String(val) ? 'selected' : ''}>${esc(l)}</option>`; }).join('')}</select></label>`;
const MONEY = 'step="0.01" min="0" inputmode="decimal"';

function opcoesHTML(q) {
  return q.opcoes.map((o, i) => `<div class="sub">
    <div class="sub-h">
      <label class="rec"><input type="radio" name="rec" ${L('opcoes', i, 'recomendado')} ${o.recomendado ? 'checked' : ''}> Opção recomendada</label>
      <span class="sub-actions">
        <button type="button" class="icon-btn" data-act="dup-opcao" data-i="${i}" title="Duplicar opção">${ic('copy')}</button>
        <button type="button" class="icon-btn danger" data-act="del-opcao" data-i="${i}" title="Remover opção">${ic('trash')}</button>
      </span>
    </div>
    <div class="grid">
      ${inp('Nome da opção', L('opcoes', i, 'nome'), o.nome, { ph: 'Ex.: Sedan executivo' })}
      ${inp('Veículo', L('opcoes', i, 'veiculo'), o.veiculo, { attrs: 'list="dl-veiculos"', ph: 'Ex.: Sedan' })}
      ${inp('Duração estimada', L('opcoes', i, 'prazo'), o.prazo, { ph: 'Ex.: 40 min' })}
      ${inp('Valor (R$)', L('opcoes', i, 'valor'), o.valor, { type: 'number', attrs: MONEY, ph: '0,00' })}
      <div class="calc-hint span2" data-sug="${i}"></div>
      ${area('Descrição (opcional)', L('opcoes', i, 'descricao'), o.descricao, { rows: 2, ph: 'O que está incluso nesta opção' })}
    </div>
  </div>`).join('');
}

/**
 * Preço pela tabela da empresa (Minha empresa → Tabela de preços), com a mesma regra da
 * calculadora de corridas do Financeiro: bandeirada + km × valor do km (com valor mínimo).
 * Ida e volta = dois trechos. Pedágio e extras entram nos adicionais.
 */
const normal = s => String(s || '').trim().toLowerCase();
function sugestaoTabela(q, o, empresa) {
  if (!normal(o.veiculo)) return { aviso: 'Escolha o veículo para calcular pela tabela.' };
  const t = (empresa.tarifas || []).find(x => normal(x.veiculo) === normal(o.veiculo));
  if (!t || !(n(t.bandeirada) || n(t.valorKm))) return { aviso: `Sem tarifa para "${o.veiculo}". Cadastre em Minha empresa → Tabela de preços.` };
  const km = n(q.rota?.distanciaKm);
  if (!km) return { aviso: 'Informe a distância (km) na rota para calcular pela tabela.' };
  const trechos = q.carga?.trajeto === 'Ida e volta' ? 2 : 1;
  const porTrecho = Math.round((n(t.bandeirada) + km * n(t.valorKm)) * 100) / 100;
  const usaMinimo = n(t.minimo) > porTrecho;
  const valorTrecho = usaMinimo ? n(t.minimo) : porTrecho;
  const valor = Math.round(valorTrecho * trechos * 100) / 100;
  const conta = usaMinimo ? `valor mínimo ${brl(t.minimo)}` : `${brl(t.bandeirada)} + ${fmtNum(km)} km × ${brl(t.valorKm)}`;
  return { valor, detalhe: trechos > 1 ? `2 trechos × (${conta})` : conta };
}

function adicionaisHTML(q) {
  return q.adicionais.map((a, i) => `<div class="row-line">
    <input ${L('adicionais', i, 'descricao')} value="${esc(a.descricao)}" placeholder="Ex.: Pedágio, hora de espera, parada extra" aria-label="Descrição do adicional">
    <input type="number" ${MONEY} ${L('adicionais', i, 'valor')} value="${esc(a.valor)}" placeholder="R$ 0,00" aria-label="Valor do adicional">
    <button type="button" class="icon-btn danger" data-act="del-adicional" data-i="${i}" title="Remover">${ic('trash')}</button>
  </div>`).join('');
}

/* ---------- Editor ---------- */
function viewEditor(id) {
  const q = getQuote(id);
  if (!q) { toast('Proposta não encontrada'); location.hash = '#/'; return; }
  document.title = `Proposta ${q.numero} — Orçamentos`;
  const c = q.cliente, r = q.rota, g = q.carga;

  app.innerHTML = `
    <header class="topbar">
      <a class="icon-btn" href="#/" title="Voltar">${ic('back')}</a>
      <h1 id="ed-title">Proposta Nº ${esc(q.numero)}</h1>
      <span class="save-state hide-sm" id="saved">Salvo</span>
      <div class="spacer"></div>
      <a class="btn btn-ghost" href="#/ver/${q.id}">${ic('eye')}<span class="hide-sm">Visualizar</span></a>
      <button class="btn btn-primary" id="btn-share">${ic('share')}Compartilhar</button>
    </header>
    <div class="editor">
      <form id="f" autocomplete="off" onsubmit="return false">
        <datalist id="dl-veiculos">${VEICULOS.map(v => `<option value="${esc(v)}">`).join('')}</datalist>

        <section class="card">
          ${q.aprovacao ? `<div class="ap-banner">${ic('check')}<div><b>Aprovada pelo cliente</b><br>${esc(q.aprovacao.por)} em ${fmtDataHora(q.aprovacao.em)} — ${esc(q.aprovacao.opcao)} (${brl(q.aprovacao.valor)})</div>
            <button type="button" class="btn btn-sm" data-act="desfazer-aprovacao">Desfazer</button></div>` : ''}
          <div class="card-h"><h3>${ic('file')} Proposta</h3>${q.status !== 'rascunho' ? `<span class="seen-inline">${q.visto?.vezes ? `${ic('eye')} Cliente abriu ${q.visto.vezes}× · último: ${fmtDataHora(q.visto.ultimo)}` : 'Cliente ainda não abriu o link'}</span>` : ''}</div>
          <div class="grid">
            ${inp('Número', P('numero'), q.numero)}
            ${q.aprovacao ? `<label class="fld"><span>Status</span><input value="Aprovada pelo cliente" disabled></label>` : sel('Status', P('status'), q.status, Object.entries(STATUS).map(([k, [l]]) => [k, l]))}
            ${inp('Data de emissão', P('data'), q.data, { type: 'date' })}
            ${inp('Validade (dias)', P('validadeDias'), q.validadeDias, { type: 'number', attrs: 'min="0" step="1"' })}
          </div>
        </section>

        <section class="card">
          <div class="card-h"><h3>${ic('building')} Cliente</h3></div>
          <div class="grid">
            ${inp('Empresa / razão social', P('cliente.empresa'), c.empresa, { ph: 'Ex.: Empresa Cliente Ltda' })}
            ${inp('Contato', P('cliente.nome'), c.nome, { ph: 'Nome da pessoa' })}
            ${inp('CNPJ / CPF', P('cliente.documento'), c.documento)}
            ${inp('Telefone / WhatsApp', P('cliente.telefone'), c.telefone, { type: 'tel', ph: '(00) 00000-0000' })}
            ${inp('E-mail', P('cliente.email'), c.email, { type: 'email', span: true })}
          </div>
        </section>

        <section class="card">
          <div class="card-h"><h3>${ic('route')} Rota</h3></div>
          <div class="grid">
            ${inp('Embarque', P('rota.origem'), r.origem, { ph: 'Endereço ou local (ex.: Hotel Bourbon, Curitiba)', span: true })}
            ${inp('Destino', P('rota.destino'), r.destino, { ph: 'Ex.: Aeroporto Afonso Pena', span: true })}
            ${inp('Data do embarque', P('rota.coleta'), r.coleta, { type: 'date' })}
            ${inp('Horário do embarque', P('rota.hora'), r.hora, { type: 'time' })}
            ${sel('Trajeto', P('carga.trajeto'), g.trajeto || TRAJETOS[0], TRAJETOS)}
            ${inp('Distância (km, um trecho)', P('rota.distanciaKm'), r.distanciaKm, { type: 'number', attrs: 'min="0"' })}
            <div class="grid span2" id="retorno" ${g.trajeto === 'Ida e volta' ? '' : 'hidden'}>
              ${inp('Data do retorno', P('rota.entrega'), r.entrega, { type: 'date' })}
              ${inp('Horário do retorno', P('rota.horaRetorno'), r.horaRetorno, { type: 'time' })}
            </div>
          </div>
        </section>

        <section class="card">
          <div class="card-h"><h3>${ic('user')} Viagem</h3></div>
          <div class="grid">
            ${sel('Tipo de serviço', P('carga.tipo'), g.tipo, TIPOS_SERVICO.includes(g.tipo) || !g.tipo ? TIPOS_SERVICO : [g.tipo, ...TIPOS_SERVICO])}
            ${inp('Número do voo (se houver)', P('carga.voo'), g.voo, { ph: 'Ex.: G3 1234' })}
            ${inp('Passageiros', P('carga.passageiros'), g.passageiros, { type: 'number', attrs: 'min="0" step="1"' })}
            ${inp('Malas', P('carga.quantidade'), g.quantidade, { type: 'number', attrs: 'min="0" step="1"' })}
            ${area('Detalhes', P('carga.descricao'), g.descricao, { rows: 2, ph: 'Ex.: placa com nome no desembarque, cadeirinha infantil, motorista bilíngue…' })}
          </div>
        </section>

        <section class="card">
          <div class="card-h"><h3>${ic('car')} Opções de veículo</h3></div>
          <p class="hint">Ofereça uma ou mais alternativas (ex.: táxi comum, sedan executivo, SUV). O cliente vê cada uma lado a lado.</p>
          <div id="opcoes">${opcoesHTML(q)}</div>
          <button type="button" class="btn add-btn" data-act="add-opcao">${ic('plus')}Adicionar opção</button>
        </section>

        <section class="card">
          <div class="card-h"><h3>${ic('tag')} Adicionais e desconto</h3></div>
          <p class="hint">Os adicionais e o desconto são aplicados a todas as opções.</p>
          <div id="adicionais">${adicionaisHTML(q)}</div>
          <button type="button" class="btn add-btn" data-act="add-adicional">${ic('plus')}Adicionar item</button>
          <div class="fld" style="margin-top:14px"><span>Desconto</span>
            <div class="discount">
              <input type="number" ${MONEY} ${P('desconto')} value="${esc(q.desconto)}" placeholder="0" aria-label="Desconto">
              <select ${P('descontoTipo')} aria-label="Tipo de desconto"><option ${q.descontoTipo === 'R$' ? 'selected' : ''}>R$</option><option ${q.descontoTipo === '%' ? 'selected' : ''}>%</option></select>
            </div>
          </div>
        </section>

        <section class="card">
          <div class="card-h"><h3>${ic('card')} Condições</h3></div>
          <div class="grid">
            ${area('Forma de pagamento', P('pagamento'), q.pagamento, { rows: 2, ph: 'Ex.: PIX antecipado ou faturado para a empresa' })}
            ${area('Observações', P('observacoes'), q.observacoes, { rows: 3, ph: 'Ex.: o motorista aguarda até 30 min após o pouso' })}
            ${area('Condições gerais (uma por linha)', P('condicoes'), q.condicoes, { rows: 5 })}
          </div>
        </section>
      </form>
      <aside class="preview" aria-label="Pré-visualização">
        <p class="preview-label">${ic('eye')} Como o cliente verá</p>
        <div id="pv"></div>
      </aside>
    </div>`;

  const form = document.getElementById('f');
  const pv = document.getElementById('pv');
  const emp = getEmpresa();
  let pvT;
  estadoSalvo();

  const drawPreview = () => { pv.innerHTML = renderProposal(q, emp); };
  const atualizarSugestoes = () => {
    document.querySelectorAll('[data-sug]').forEach(el => {
      const o = q.opcoes[+el.dataset.sug]; if (!o) return;
      const s = sugestaoTabela(q, o, emp);
      if (s.aviso) { el.innerHTML = `<span class="muted">${esc(s.aviso)}</span>`; return; }
      const igual = Math.abs(n(o.valor) - s.valor) < 0.005;
      el.innerHTML = `${ic('tag')}<span>Pela tabela: <b>${brl(s.valor)}</b> <small>(${esc(s.detalhe)})</small></span>
        ${igual ? `<span class="ok-tag">${ic('check')}igual</span>` : `<button type="button" class="btn btn-sm" data-act="usar-tabela" data-i="${el.dataset.sug}">Usar</button>`}`;
    });
  };
  const changed = (immediate) => {
    saveQuote(q);
    atualizarSugestoes();
    document.getElementById('ed-title').textContent = `Proposta Nº ${q.numero}`;
    clearTimeout(pvT);
    if (immediate) drawPreview(); else pvT = setTimeout(drawPreview, 120);
  };

  const onInput = ev => {
    const t = ev.target;
    const v = t.type === 'number' ? (t.value === '' ? '' : parseFloat(t.value)) : t.value;
    if (t.dataset.path) {
      setPath(q, t.dataset.path, v);
      if (t.dataset.path === 'carga.trajeto') document.getElementById('retorno').hidden = v !== 'Ida e volta';
    } else if (t.dataset.list) {
      const arr = q[t.dataset.list], i = +t.dataset.i, k = t.dataset.k;
      if (k === 'recomendado') arr.forEach((o, j) => { o.recomendado = j === i; });
      else arr[i][k] = v;
    } else return;
    changed();
  };
  form.addEventListener('input', onInput);
  form.addEventListener('change', onInput);

  form.addEventListener('click', async ev => {
    const b = ev.target.closest('[data-act]'); if (!b) return;
    const i = +b.dataset.i;
    if (b.dataset.act === 'usar-tabela') {
      const s = sugestaoTabela(q, q.opcoes[i], emp); if (!s.valor) return;
      q.opcoes[i].valor = s.valor;
      const campo = form.querySelector(`[data-list="opcoes"][data-i="${i}"][data-k="valor"]`); if (campo) campo.value = s.valor;
      changed(true); return;
    }
    if (b.dataset.act === 'desfazer-aprovacao') {
      if (!confirm('Desfazer a aprovação do cliente? A proposta volta para "Enviada" e o cliente poderá aprovar de novo.')) return;
      try {
        salvarPendentes();
        const { proposta } = await api('POST', `/api/propostas/${encodeURIComponent(q.id)}/desfazer-aprovacao`, {});
        Object.assign(q, proposta); toast('Aprovação desfeita'); viewEditor(q.id);
      } catch (e) { toast(e.message); }
      return;
    }
    switch (b.dataset.act) {
      case 'add-opcao': q.opcoes.push({ nome: '', veiculo: '', prazo: '', valor: '', descricao: '', recomendado: !q.opcoes.length }); break;
      case 'dup-opcao': q.opcoes.splice(i + 1, 0, { ...q.opcoes[i], nome: (q.opcoes[i].nome || 'Opção') + ' (cópia)', recomendado: false }); break;
      case 'del-opcao':
        q.opcoes.splice(i, 1);
        if (q.opcoes.length && !q.opcoes.some(o => o.recomendado)) q.opcoes[0].recomendado = true;
        break;
      case 'add-adicional': q.adicionais.push({ descricao: '', valor: '' }); break;
      case 'del-adicional': q.adicionais.splice(i, 1); break;
      default: return;
    }
    document.getElementById('opcoes').innerHTML = opcoesHTML(q);
    document.getElementById('adicionais').innerHTML = adicionaisHTML(q);
    if (b.dataset.act === 'add-opcao') document.querySelector(`#opcoes .sub:last-child input[data-k="nome"]`)?.focus();
    if (b.dataset.act === 'add-adicional') document.querySelector(`#adicionais .row-line:last-child input`)?.focus();
    changed(true);
  });

  document.getElementById('btn-share').addEventListener('click', () => openShare(q, () => {
    const st = form.querySelector('[data-path="status"]'); if (st) st.value = q.status; drawPreview();
  }));

  drawPreview();
  atualizarSugestoes();
}

/* ---------- Compartilhar ---------- */
async function openShare(q, onChange) {
  if (!visibleOptions(q).some(o => n(o.valor) > 0)) toast('Dica: informe o valor de pelo menos uma opção');
  if (q.status === 'rascunho') { q.status = 'enviada'; saveQuote(q); onChange && onChange(); }
  salvarPendentes();
  const url = shareUrl(q);
  const local = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
  const c = q.cliente || {};
  const msg = `Olá${c.nome ? ' ' + c.nome.split(' ')[0] : ''}! Segue a proposta de transporte Nº ${q.numero}${q.rota?.origem && q.rota?.destino ? ` (${q.rota.origem} → ${q.rota.destino})` : ''}:\n${url}`;
  const wa = waNumber(c.telefone);

  const m = modal(`
    <h3>Compartilhar com o cliente</h3>
    <p>O link abre uma página com a proposta completa, pronta para o cliente ver, imprimir ou aprovar.</p>
    <div class="link-box"><input id="sh-url" readonly value="${esc(url)}" aria-label="Link da proposta"><button class="btn btn-primary" id="sh-copy">${ic('copy')}Copiar</button></div>
    <div class="actions">
      <a class="btn" href="${esc(url)}" target="_blank" rel="noopener">${ic('eye')}Abrir link</a>
      <a class="btn" href="https://wa.me/${wa}?text=${encodeURIComponent(msg)}" target="_blank" rel="noopener">${ic('phone')}Enviar por WhatsApp</a>
      ${c.email ? `<a class="btn" href="mailto:${esc(c.email)}?subject=${encodeURIComponent('Proposta de transporte Nº ' + q.numero)}&body=${encodeURIComponent(msg)}">${ic('mail')}E-mail</a>` : ''}
      <button class="btn btn-ghost" data-close style="margin-left:auto">Fechar</button>
    </div>
    ${local ? `<div class="notice"><b>Teste no computador:</b> este link só abre nesta máquina. Na versão publicada, o link abre para qualquer cliente.</div>` : ''}
    <p style="margin:14px 0 0;font-size:12px">O cliente sempre vê a versão mais atual: se você corrigir algo, não precisa mandar outro link.</p>`);
  const inpUrl = m.querySelector('#sh-url');
  inpUrl.addEventListener('focus', () => inpUrl.select());
  m.querySelector('#sh-copy').addEventListener('click', async () => { toast(await copyText(url) ? 'Link copiado!' : 'Não foi possível copiar'); });
}

/* ---------- Visualizar (interno) ---------- */
function viewLocal(id) {
  const q = getQuote(id);
  if (!q) { location.hash = '#/'; return; }
  document.body.className = 'client-mode';
  document.title = `Proposta ${q.numero}`;
  app.innerHTML = `
    <div class="client-bar no-print"><div>
      <a class="icon-btn" href="#/editar/${q.id}" title="Voltar ao editor">${ic('back')}</a>
      <span class="t">Pré-visualização · Proposta Nº ${esc(q.numero)}</span>
      <button class="btn btn-sm" onclick="window.print()">${ic('print')}<span class="hide-sm">Imprimir / PDF</span></button>
      <button class="btn btn-sm btn-primary" id="sh">${ic('share')}Compartilhar</button>
    </div></div>
    <div class="client-wrap">${renderProposal(q, getEmpresa(), { interactive: true })}</div>`;
  document.getElementById('sh').addEventListener('click', () => openShare(q));
  app.addEventListener('click', ev => {
    if (ev.target.closest('[data-aprovar]')) toast('Na pré-visualização o botão não aprova. Só o cliente aprova, pelo link.');
  });
}

/* ---------- Página pública do cliente ---------- */
async function viewPublic(codigo) {
  document.body.className = 'client-mode';
  app.innerHTML = `<div class="container"><div class="empty"><p>Carregando a proposta…</p></div></div>`;
  try {
    const { q, e: eSalva } = await api('GET', `/api/publico/${encodeURIComponent(codigo || '')}`);
    const e = { ...EMP_DEFAULT, ...(eSalva || {}) };
    q.opcoes = q.opcoes || []; q.adicionais = q.adicionais || [];
    q.cliente = q.cliente || {}; q.rota = q.rota || {}; q.carga = q.carga || {};
    document.title = `Proposta ${q.numero}${e.nome ? ' — ' + e.nome : ''}`;
    const desenhar = () => {
      app.innerHTML = `
        <div class="client-bar no-print"><div>
          <span class="t">Proposta Nº ${esc(q.numero)}${e.nome ? ` · ${esc(e.nome)}` : ''}</span>
          <button class="btn btn-sm" onclick="window.print()">${ic('print')}Imprimir / PDF</button>
        </div></div>
        <div class="client-wrap">${renderProposal(q, e, { interactive: true })}</div>`;
    };
    desenhar();

    // Aprovar: confirma com o nome de quem aprova e registra no sistema.
    app.addEventListener('click', ev => {
      const b = ev.target.closest('[data-aprovar]'); if (!b) return;
      const i = +b.dataset.aprovar, o = q.opcoes[i]; if (!o) return;
      const m = modal(`
        <h3>Aprovar a proposta</h3>
        <p>Opção <b>${esc(o.nome || 'Transporte')}</b>${o.veiculo ? ` (${esc(o.veiculo)})` : ''} — <b>${brl(calc(q, o).total)}</b></p>
        <label class="fld"><span>Seu nome</span><input id="ap-nome" autocomplete="name" placeholder="Nome de quem está aprovando" value="${esc(q.cliente.nome || '')}"></label>
        <div class="notice" id="ap-erro" hidden></div>
        <div class="actions">
          <button class="btn btn-brand-solid" id="ap-ok" style="--brand:${esc(e.cor)}">${ic('check')}Confirmar aprovação</button>
          <button class="btn btn-ghost" data-close>Cancelar</button>
        </div>`);
      const nome = m.querySelector('#ap-nome'), erro = m.querySelector('#ap-erro'), okBtn = m.querySelector('#ap-ok');
      nome.focus();
      const confirmar = async () => {
        if (nome.value.trim().length < 3) { erro.hidden = false; erro.textContent = 'Informe o seu nome para aprovar.'; nome.focus(); return; }
        okBtn.disabled = true; okBtn.textContent = 'Aprovando…';
        try {
          const { aprovacao } = await api('POST', `/api/publico/${encodeURIComponent(codigo)}/aprovar`, { opcao: i, nome: nome.value.trim() });
          q.aprovacao = aprovacao; q.status = 'aprovada';
          m.remove(); desenhar(); window.scrollTo({ top: 0, behavior: 'smooth' });
          toast('Proposta aprovada! A empresa já foi avisada no sistema.');
        } catch (err2) {
          erro.hidden = false; erro.textContent = err2.message;
          okBtn.disabled = false; okBtn.innerHTML = `${ic('check')}Confirmar aprovação`;
        }
      };
      okBtn.addEventListener('click', confirmar);
      nome.addEventListener('keydown', k => { if (k.key === 'Enter') confirmar(); });
    });
  } catch (err) {
    const naoExiste = err.status === 404;
    app.innerHTML = `<div class="container"><div class="empty"><div class="big">${ic('alert')}</div>
      <h3>${naoExiste ? 'Proposta não encontrada' : 'Não foi possível abrir a proposta'}</h3>
      <p>${naoExiste ? 'O link pode estar incompleto ou a proposta foi cancelada. Peça um novo link a quem enviou.' : esc(err.message)}</p></div></div>`;
  }
}

/* ---------- Sem acesso: entrar pelo portal ---------- */
function viewSemAcesso(mensagem) {
  document.body.className = '';
  document.title = 'Orçamentos — Táxi 2.0';
  app.innerHTML = `<div class="container" style="max-width:520px;padding-top:12vh">
    <div class="card" style="text-align:center;padding:36px 28px">
      <img src="${LOGO_TAXI20}" alt="Táxi 2.0" style="height:56px;margin-bottom:14px">
      <h2 style="margin:0 0 6px;font-size:22px">Orçamentos de transporte</h2>
      <p style="color:var(--muted);margin:0 0 22px">${esc(mensagem || 'Para abrir os orçamentos, entre pelo Portal Táxi 2.0 e clique no cartão Orçamentos.')}</p>
      <a class="btn btn-primary" href="${PORTAL_URL}">${ic('back')}Ir para o portal</a>
    </div></div>`;
}

/* ---------- Empresa ---------- */
function viewEmpresa() {
  document.title = 'Minha empresa — Orçamentos';
  const e = getEmpresa();
  app.innerHTML = `
    <header class="topbar">
      <a class="icon-btn" href="#/" title="Voltar">${ic('back')}</a>
      <h1>Minha empresa</h1>
      <span class="save-state hide-sm" id="saved">Salvo</span>
      <div class="spacer"></div>
      <a class="btn btn-primary" href="#/">${ic('check')}Concluir</a>
    </header>
    <main class="container" style="max-width:760px">
      <div class="page-head"><div><h2>Identidade e padrões</h2><p>Esses dados aparecem no topo e no rodapé de todas as propostas.</p></div></div>
      <form id="fe" autocomplete="off" onsubmit="return false">
        <section class="card">
          <div class="card-h"><h3>${ic('building')} Marca</h3></div>
          <div class="logo-row" style="margin-bottom:14px">
            <div class="logo-prev" id="logo-prev">${logoHTML(e)}</div>
            <div style="display:flex;gap:8px;flex-wrap:wrap">
              <label class="btn">${ic('upload')}Enviar logo<input type="file" id="logo-file" accept="image/*" hidden></label>
              <button type="button" class="btn btn-ghost btn-danger" id="logo-rm" ${e.logo ? '' : 'hidden'}>Remover</button>
            </div>
          </div>
          <div class="grid">
            ${inp('Nome da empresa', P('nome'), e.nome, { ph: 'Ex.: Transportes Rápido Ltda' })}
            ${inp('CNPJ', P('cnpj'), e.cnpj)}
            <label class="fld"><span>Cor da marca</span><div style="display:flex;gap:8px"><input type="color" ${P('cor')} value="${esc(e.cor)}"><input ${P('cor')} value="${esc(e.cor)}" id="cor-txt" aria-label="Cor em hexadecimal"></div></label>
          </div>
        </section>
        <section class="card">
          <div class="card-h"><h3>${ic('phone')} Contato</h3></div>
          <p class="hint">O WhatsApp é usado no botão “Aprovar esta opção” da proposta.</p>
          <div class="grid">
            ${inp('Telefone / WhatsApp', P('telefone'), e.telefone, { type: 'tel', ph: '(00) 00000-0000' })}
            ${inp('E-mail', P('email'), e.email, { type: 'email' })}
            ${inp('Site', P('site'), e.site, { ph: 'www.suaempresa.com.br' })}
            ${inp('Endereço / cidade', P('endereco'), e.endereco)}
          </div>
        </section>
        <section class="card">
          <div class="card-h"><h3>${ic('tag')} Tabela de preços</h3></div>
          <p class="hint">Usada no botão "Usar" de cada opção: <b>bandeirada + km × valor do km</b> (a mesma regra da calculadora do Financeiro). Se der menos que o mínimo, vale o mínimo. Ida e volta conta dois trechos. Pedágio e extras vão nos adicionais.</p>
          <datalist id="dl-veiculos">${VEICULOS.map(v => `<option value="${esc(v)}">`).join('')}</datalist>
          <div class="tarifa-head"><span>Veículo</span><span>Bandeirada</span><span>R$ por km</span><span>Mínimo</span><span></span></div>
          <div id="tarifas"></div>
          <button type="button" class="btn add-btn" data-act="add-tarifa">${ic('plus')}Adicionar veículo</button>
        </section>
        <section class="card">
          <div class="card-h"><h3>${ic('file')} Padrões para novas propostas</h3></div>
          <div class="grid">
            ${inp('Validade padrão (dias)', P('validade'), e.validade, { type: 'number', attrs: 'min="0" step="1"' })}
            <span></span>
            ${area('Forma de pagamento padrão', P('pagamento'), e.pagamento, { rows: 2 })}
            ${area('Condições gerais padrão (uma por linha)', P('condicoes'), e.condicoes, { rows: 5 })}
          </div>
        </section>
        <section class="card">
          <div class="card-h"><h3>${ic('download')} Backup</h3></div>
          <p class="hint" style="margin-top:-6px">As propostas ficam guardadas no servidor. Se quiser, baixe uma cópia em arquivo.</p>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <button type="button" class="btn" id="bk-exp">${ic('download')}Baixar cópia (backup)</button>          </div>
        </section>
      </form>
    </main>`;

  const form = document.getElementById('fe');
  const refreshLogo = () => {
    document.getElementById('logo-prev').innerHTML = logoHTML(e);
    document.getElementById('logo-rm').hidden = !e.logo;
  };
  e.tarifas = structuredClone(Array.isArray(e.tarifas) ? e.tarifas : []); // cópia: não mexe no padrão
  const tarifasHTML = () => e.tarifas.map((t, i) => `<div class="tarifa-row">
      <input ${L('tarifas', i, 'veiculo')} value="${esc(t.veiculo)}" list="dl-veiculos" placeholder="Veículo" aria-label="Veículo">
      <input type="number" ${MONEY} ${L('tarifas', i, 'bandeirada')} value="${esc(t.bandeirada)}" placeholder="R$ 0,00" aria-label="Bandeirada">
      <input type="number" ${MONEY} ${L('tarifas', i, 'valorKm')} value="${esc(t.valorKm)}" placeholder="R$ 0,00" aria-label="Valor por km">
      <input type="number" ${MONEY} ${L('tarifas', i, 'minimo')} value="${esc(t.minimo)}" placeholder="R$ 0,00" aria-label="Valor mínimo">
      <button type="button" class="icon-btn danger" data-act="del-tarifa" data-i="${i}" title="Remover">${ic('trash')}</button>
    </div>`).join('');
  const desenharTarifas = () => { document.getElementById('tarifas').innerHTML = tarifasHTML(); };
  desenharTarifas();
  form.addEventListener('click', ev => {
    const b = ev.target.closest('[data-act]'); if (!b) return;
    if (b.dataset.act === 'add-tarifa') e.tarifas.push({ veiculo: '', bandeirada: '', valorKm: '', minimo: '' });
    else if (b.dataset.act === 'del-tarifa') e.tarifas.splice(+b.dataset.i, 1);
    else return;
    desenharTarifas(); saveEmpresa(e);
    if (b.dataset.act === 'add-tarifa') document.querySelector('#tarifas .tarifa-row:last-child input')?.focus();
  });

  const onInput = ev => {
    const t = ev.target;
    const v = t.type === 'number' ? (t.value === '' ? '' : parseFloat(t.value)) : t.value;
    if (t.dataset.list === 'tarifas') { e.tarifas[+t.dataset.i][t.dataset.k] = v; saveEmpresa(e); return; }
    if (!t.dataset.path) return;
    setPath(e, t.dataset.path, v);
    if (t.dataset.path === 'cor') form.querySelectorAll('[data-path="cor"]').forEach(x => { if (x !== t && /^#[0-9a-f]{6}$/i.test(v)) x.value = v; });
    if (t.dataset.path === 'nome' && !e.logo) refreshLogo();
    saveEmpresa(e);
  };
  form.addEventListener('input', onInput);
  form.addEventListener('change', onInput);

  document.getElementById('logo-file').addEventListener('change', ev => {
    const f = ev.target.files[0]; if (!f) return;
    const img = new Image();
    img.onload = () => {
      const max = 160, s = Math.min(1, max / Math.max(img.width, img.height));
      const cv = document.createElement('canvas');
      cv.width = Math.round(img.width * s); cv.height = Math.round(img.height * s);
      cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
      let data = cv.toDataURL('image/webp', 0.85);
      if (!data.startsWith('data:image/webp')) data = cv.toDataURL('image/png');
      e.logo = data; saveEmpresa(e); refreshLogo(); URL.revokeObjectURL(img.src); toast('Logo atualizada');
    };
    img.onerror = () => toast('Não foi possível ler a imagem');
    img.src = URL.createObjectURL(f);
  });
  document.getElementById('logo-rm').addEventListener('click', () => { e.logo = ''; saveEmpresa(e); refreshLogo(); });

  document.getElementById('bk-exp').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify({ versao: 2, exportadoEm: new Date().toISOString(), empresa: getEmpresa(), propostas: getQuotes() }, null, 2)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `orcamentos-backup-${today()}.json`; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });
}

/* ---------- Roteador ---------- */
let navegacao = 0;
async function route() {
  const vez = ++navegacao;
  salvarPendentes(); salvarEmpresaAgora();
  window.scrollTo(0, 0);
  document.querySelectorAll('.modal-wrap').forEach(m => m.remove());
  document.body.className = '';
  const [, r, arg] = (location.hash.slice(1) || '/').split('/');
  if (r === 'ver') return viewLocal(arg);
  if (r === 'novo') {
    app.innerHTML = `<div class="container"><div class="empty"><p>Criando a proposta…</p></div></div>`;
    try {
      const q = await createQuote(newQuoteData());
      if (vez !== navegacao) return;
      history.replaceState(null, '', '#/editar/' + q.id);
      return viewEditor(q.id);
    } catch (e) { toast(e.message); history.replaceState(null, '', '#/'); return viewList(); }
  }
  if (r === 'editar') return viewEditor(arg);
  if (r === 'empresa') return viewEmpresa();
  return viewList();
}

/* ---------- Abertura ---------- */
async function iniciar() {
  // Página do cliente: /p/<código> (sem login)
  const pub = location.pathname.match(/^\/p\/([A-Za-z0-9_-]+)/);
  if (pub) return viewPublic(pub[1]);

  // Chegou pelo cartão do portal: …/#passe=… (lê, apaga do endereço e abre a sessão)
  const m = location.hash.match(/passe=([^&]+)/);
  if (m) {
    history.replaceState(null, '', location.pathname);
    try { await api('POST', '/api/entrar', { passe: decodeURIComponent(m[1]) }); }
    catch (e) { return viewSemAcesso(e.message); }
  }

  app.innerHTML = `<div class="container"><div class="empty"><p>Carregando…</p></div></div>`;
  try {
    const d = await api('GET', '/api/dados');
    S.usuario = d.usuario; S.empresa = d.empresa; S.propostas = d.propostas || [];
  } catch (e) {
    return viewSemAcesso(e.status === 401 ? null : e.message);
  }
  route();
}
// Um passe novo no endereço (mesmo com a página já aberta) abre a sessão; o resto é navegação normal.
window.addEventListener('hashchange', () => {
  if (/passe=/.test(location.hash)) iniciar();
  else if (S.usuario && !location.pathname.startsWith('/p/')) route();
});
iniciar();
