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
  'Alterações de endereço, horário ou quantidade de passageiros/volumes podem gerar revisão dos valores.',
  'Tempo de espera acima do combinado será cobrado à parte.',
  'Pedágios e estacionamentos só estão incluídos quando aparecem nos adicionais.',
].join('\n');

const STATUS = {
  rascunho: ['Rascunho', 'gray'],
  enviada: ['Enviada', 'blue'],
  aprovada: ['Aprovada', 'green'],
  recusada: ['Recusada', 'red'],
};

const TIPOS_CARGA = ['Transporte de passageiros', 'Transporte executivo', 'Transfer aeroporto', 'Fretamento', 'Entrega / encomenda', 'Carga geral', 'Carga fracionada', 'Carga paletizada', 'Refrigerada', 'Mudança', 'Outra'];
const VEICULOS = ['Sedan', 'Sedan executivo', 'SUV', 'Minivan', 'Van', 'Micro-ônibus', 'Ônibus', 'Utilitário (Fiorino)', 'VUC', '3/4', 'Toco', 'Truck', 'Carreta'];

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
  truck: '<path d="M1 4h14v12H1z"/><path d="M15 8h4l4 4v4h-8z"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/>',
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
async function enviarProposta(id) {
  pendentes.delete(id);
  const q = getQuote(id); if (!q) return;
  try {
    const { proposta } = await api('PUT', `/api/propostas/${encodeURIComponent(id)}`, { dados: q });
    q.atualizadoPor = proposta.atualizadoPor;
    falhaAoSalvar = false;
  } catch (e) {
    falhaAoSalvar = true;
    toast(e.status === 401 ? 'Sua sessão terminou. Abra de novo pelo portal.' : e.message);
  }
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
    rota: { origem: '', destino: '', distanciaKm: '', coleta: '', entrega: '' },
    carga: { tipo: TIPOS_CARGA[0], descricao: '', passageiros: '', peso: '', volume: '', quantidade: '', valor: '' },
    opcoes: [{ nome: 'Transporte dedicado', veiculo: 'Sedan executivo', prazo: '', valor: '', descricao: '', recomendado: true }],
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

function approveLink(q, e, o) {
  const msg = `Olá${e.nome ? ', ' + e.nome : ''}! Gostaria de aprovar a proposta Nº ${q.numero} — opção "${o.nome || 'Transporte'}" no valor de ${brl(calc(q, o).total)}.`;
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
    ['weight', 'Peso', n(g.peso) ? `${fmtNum(g.peso)} kg` : ''],
    ['cube', 'Volume', n(g.volume) ? `${fmtNum(g.volume)} m³` : ''],
    ['layers', 'Volumes / malas', n(g.quantidade) ? fmtNum(g.quantidade, 0) : ''],
    ['shield', 'Valor da mercadoria', n(g.valor) ? brl(g.valor) : ''],
  ].filter(f => f[2]);

  const hasBreakdown = (q.adicionais || []).some(a => n(a.valor)) || n(q.desconto) > 0;

  const optionCard = o => {
    const t = calc(q, o);
    const link = interactive && q.status !== 'aprovada' && !isExpired(q) ? approveLink(q, e, o) : '';
    return `<article class="option ${o.recomendado && opcoes.length > 1 ? 'is-rec' : opcoes.length === 1 ? 'is-rec' : ''}">
      ${o.recomendado && opcoes.length > 1 ? `<span class="rec-badge">${ic('star')} Recomendado</span>` : ''}
      <h3>${esc(o.nome || 'Transporte')}</h3>
      ${o.veiculo || o.prazo ? `<div class="opt-meta">${o.veiculo ? `<span>${ic('truck')}${esc(o.veiculo)}</span>` : ''}${o.prazo ? `<span>${ic('clock')}${esc(o.prazo)}</span>` : ''}</div>` : ''}
      ${o.descricao ? `<p>${esc(o.descricao)}</p>` : ''}
      <div class="option-spacer"></div>
      <div class="opt-price"><small>Valor total</small><strong>${brl(t.total)}</strong></div>
      ${hasBreakdown ? `<dl class="breakdown">
        <div><dt>Transporte</dt><dd>${brl(t.base)}</dd></div>
        ${(q.adicionais || []).filter(a => n(a.valor)).map(a => `<div><dt>${esc(a.descricao || 'Adicional')}</dt><dd>${brl(a.valor)}</dd></div>`).join('')}
        ${t.desc > 0 ? `<div class="minus"><dt>Desconto${q.descontoTipo === '%' ? ` (${fmtNum(q.desconto)}%)` : ''}</dt><dd>− ${brl(t.desc)}</dd></div>` : ''}
      </dl>` : ''}
      ${link ? `<a class="btn btn-brand" href="${esc(link)}" target="_blank" rel="noopener">${ic('check')} Aprovar esta opção</a>` : ''}
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
        ${n(r.distanciaKm) ? `<span class="p-chip">${ic('route')} ${fmtNum(r.distanciaKm, 0)} km</span>` : ''}
        ${opcoes.length > 1 ? `<span class="p-chip">${ic('layers')} ${opcoes.length} opções</span>` : ''}
        ${validity}
      </div>
    </header>

    ${q.status === 'recusada' ? `<div class="p-status bad">${ic('x')} Esta proposta foi recusada ou cancelada.</div>` : ''}

    <div class="p-cols">
      <section class="p-section p-client">
        <h2>${ic('building')} Cliente</h2>
        <strong>${esc(clientName || '—')}</strong>
        ${clientLines.map(([i, t]) => `<div class="line">${i}${esc(t)}</div>`).join('')}
      </section>
      <section class="p-section">
        <h2>${ic('route')} Rota</h2>
        <div class="route">
          <div class="route-pt"><small>Origem</small><strong>${esc(r.origem || '—')}</strong>${r.coleta ? `<span>Saída: ${fmtDate(r.coleta)}</span>` : ''}</div>
          <div class="route-line"><span class="truck">${ic('truck')}</span>${n(r.distanciaKm) ? `<em>${fmtNum(r.distanciaKm, 0)} km</em>` : ''}</div>
          <div class="route-pt end"><small>Destino</small><strong>${esc(r.destino || '—')}</strong>${r.entrega ? `<span>Chegada prevista: ${fmtDate(r.entrega)}</span>` : ''}</div>
        </div>
      </section>
    </div>

    ${facts.length || g.descricao ? `<section class="p-section">
      <h2>${ic('box')} Detalhes do serviço</h2>
      <div class="facts">
        ${facts.map(([i, l, v]) => `<div class="fact"><small>${ic(i)}${l}</small><strong>${esc(v)}</strong></div>`).join('')}
        ${g.descricao ? `<div class="fact wide"><small>${ic('file')}Descrição</small><strong>${esc(g.descricao)}</strong></div>` : ''}
      </div>
    </section>` : ''}

    <section class="p-section">
      <h2>${ic('truck')} ${opcoes.length > 1 ? 'Opções' : 'Valor'}</h2>
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
  return `<a href="#/" class="app-mark" title="Início" style="text-decoration:none">${ic('truck')}</a>
    <h1>Orçamentos${e.nome ? ` <span style="color:var(--muted);font-weight:500">· ${esc(e.nome)}</span>` : ''}</h1>`;
}

/* ---------- Lista ---------- */
function statusPill(q) {
  if ((q.status === 'enviada' || q.status === 'rascunho') && isExpired(q)) return '<span class="pill amber">Expirada</span>';
  const [l, c] = STATUS[q.status] || STATUS.rascunho;
  return `<span class="pill ${c}">${l}</span>`;
}

function viewList() {
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
        <span class="pill-c">${statusPill(q)}</span>
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
      ${inp('Prazo / duração', L('opcoes', i, 'prazo'), o.prazo, { ph: 'Ex.: 3 horas, 2 dias úteis' })}
      ${inp('Valor (R$)', L('opcoes', i, 'valor'), o.valor, { type: 'number', attrs: MONEY, ph: '0,00' })}
      ${area('Descrição (opcional)', L('opcoes', i, 'descricao'), o.descricao, { rows: 2, ph: 'O que está incluso nesta opção' })}
    </div>
  </div>`).join('');
}

function adicionaisHTML(q) {
  return q.adicionais.map((a, i) => `<div class="row-line">
    <input ${L('adicionais', i, 'descricao')} value="${esc(a.descricao)}" placeholder="Ex.: Seguro, pedágio, ajudantes" aria-label="Descrição do adicional">
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
          <div class="card-h"><h3>${ic('file')} Proposta</h3></div>
          <div class="grid">
            ${inp('Número', P('numero'), q.numero)}
            ${sel('Status', P('status'), q.status, Object.entries(STATUS).map(([k, [l]]) => [k, l]))}
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
            ${inp('Origem', P('rota.origem'), r.origem, { ph: 'Cidade, UF' })}
            ${inp('Destino', P('rota.destino'), r.destino, { ph: 'Cidade, UF' })}
            ${inp('Distância (km)', P('rota.distanciaKm'), r.distanciaKm, { type: 'number', attrs: 'min="0"' })}
            ${inp('Data de saída / coleta', P('rota.coleta'), r.coleta, { type: 'date' })}
            ${inp('Chegada / entrega prevista', P('rota.entrega'), r.entrega, { type: 'date' })}
          </div>
        </section>

        <section class="card">
          <div class="card-h"><h3>${ic('box')} Serviço</h3></div>
          <p class="hint">Preencha só o que fizer sentido: passageiros para viagens, peso e volume para cargas.</p>
          <div class="grid">
            ${sel('Tipo de serviço', P('carga.tipo'), g.tipo, TIPOS_CARGA.includes(g.tipo) || !g.tipo ? TIPOS_CARGA : [g.tipo, ...TIPOS_CARGA])}
            ${inp('Passageiros', P('carga.passageiros'), g.passageiros, { type: 'number', attrs: 'min="0" step="1"' })}
            ${inp('Peso (kg)', P('carga.peso'), g.peso, { type: 'number', attrs: 'min="0" step="any"' })}
            ${inp('Volume (m³)', P('carga.volume'), g.volume, { type: 'number', attrs: 'min="0" step="any"' })}
            ${inp('Quantidade de volumes / malas', P('carga.quantidade'), g.quantidade, { type: 'number', attrs: 'min="0" step="1"' })}
            ${inp('Valor da mercadoria (R$)', P('carga.valor'), g.valor, { type: 'number', attrs: MONEY })}
            ${area('Descrição', P('carga.descricao'), g.descricao, { rows: 2, ph: 'Ex.: ida e volta com espera, motorista bilíngue, carga frágil…' })}
          </div>
        </section>

        <section class="card">
          <div class="card-h"><h3>${ic('truck')} Opções de valor</h3></div>
          <p class="hint">Ofereça uma ou mais alternativas (ex.: sedan, executivo, van). O cliente vê cada uma lado a lado.</p>
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
            ${area('Forma de pagamento', P('pagamento'), q.pagamento, { rows: 2, ph: 'Ex.: Boleto 15 dias após a entrega' })}
            ${area('Observações', P('observacoes'), q.observacoes, { rows: 3, ph: 'Horários, restrições, agendamentos…' })}
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
  const changed = (immediate) => {
    saveQuote(q);
    document.getElementById('ed-title').textContent = `Proposta Nº ${q.numero}`;
    clearTimeout(pvT);
    if (immediate) drawPreview(); else pvT = setTimeout(drawPreview, 120);
  };

  const onInput = ev => {
    const t = ev.target;
    const v = t.type === 'number' ? (t.value === '' ? '' : parseFloat(t.value)) : t.value;
    if (t.dataset.path) setPath(q, t.dataset.path, v);
    else if (t.dataset.list) {
      const arr = q[t.dataset.list], i = +t.dataset.i, k = t.dataset.k;
      if (k === 'recomendado') arr.forEach((o, j) => { o.recomendado = j === i; });
      else arr[i][k] = v;
    } else return;
    changed();
  };
  form.addEventListener('input', onInput);
  form.addEventListener('change', onInput);

  form.addEventListener('click', ev => {
    const b = ev.target.closest('[data-act]'); if (!b) return;
    const i = +b.dataset.i;
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
    form.querySelector('[data-path="status"]').value = q.status; drawPreview();
  }));

  drawPreview();
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
    app.innerHTML = `
      <div class="client-bar no-print"><div>
        <span class="t">Proposta Nº ${esc(q.numero)}${e.nome ? ` · ${esc(e.nome)}` : ''}</span>
        <button class="btn btn-sm" onclick="window.print()">${ic('print')}Imprimir / PDF</button>
      </div></div>
      <div class="client-wrap">${renderProposal(q, e, { interactive: true })}</div>`;
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
  const onInput = ev => {
    const t = ev.target; if (!t.dataset.path) return;
    const v = t.type === 'number' ? (t.value === '' ? '' : parseFloat(t.value)) : t.value;
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
