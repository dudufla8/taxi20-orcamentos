/**
 * Rotas do Orçamentos. O mesmo código roda na Vercel (api/index.js) e no computador (servidor-local.mjs).
 *
 * Públicas:
 *   POST /api/entrar          { passe }  -> abre a sessão (cookie) com o passe do portal
 *   GET  /api/publico/:token             -> proposta para o cliente (sem login)
 * Com sessão:
 *   GET  /api/dados                      -> usuário, dados da empresa e propostas
 *   POST /api/propostas       { dados }  -> cria (o número é dado pelo servidor)
 *   PUT  /api/propostas/:id   { dados }  -> salva
 *   DELETE /api/propostas/:id            -> apaga (fica guardada no banco, só some da lista)
 *   PUT  /api/empresa         { empresa }
 *   POST /api/sair
 */
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { obterBanco } from './bd.js';
import { conferirPasse, segredoDoPasse } from './passe.js';

export const COOKIE_SESSAO = 'tx20_orc';
const HORAS_SESSAO = 12;
const LIMITE_PROPOSTA = 200_000; // caracteres do JSON
const LIMITE_EMPRESA = 400_000; // a logo enviada vai junto

class ErroApi extends Error {
  constructor(mensagem, status = 400) {
    super(mensagem);
    this.status = status;
  }
}

const resumo = (t) => createHash('sha256').update(t).digest('hex');
const ok = (corpo, cabecalhos) => ({ status: 200, corpo, cabecalhos });

export function lerCookies(cabecalho = '') {
  const cookies = {};
  for (const parte of String(cabecalho).split(';')) {
    const i = parte.indexOf('=');
    if (i < 0) continue;
    const k = parte.slice(0, i).trim();
    const v = parte.slice(i + 1).trim();
    if (!k) continue;
    try {
      cookies[k] = decodeURIComponent(v);
    } catch {
      cookies[k] = v;
    }
  }
  return cookies;
}

const cookieSessao = (token, https, maxAge = HORAS_SESSAO * 3600) =>
  `${COOKIE_SESSAO}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${https ? '; Secure' : ''}`;

async function auditar(b, quem, acao, registroId = '', descricao = '') {
  await b.consulta(`INSERT INTO auditoria (email, nome, acao, registro_id, descricao) VALUES ($1, $2, $3, $4, $5)`, [
    quem.email ?? '',
    quem.nome ?? '',
    acao,
    registroId,
    descricao
  ]);
}

async function usuarioDaSessao(b, cookies) {
  const token = cookies[COOKIE_SESSAO];
  if (!token) return null;
  const [s] = await b.consulta(`SELECT email, nome, perfil FROM sessoes WHERE token_hash = $1 AND expira_em > NOW()`, [resumo(token)]);
  return s ?? null;
}

const objetoSimples = (x) => !!x && typeof x === 'object' && !Array.isArray(x);

function limparProposta(dados) {
  if (!objetoSimples(dados)) throw new ErroApi('Proposta inválida.');
  const { id, token, atualizadoEm, atualizadoPor, ...resto } = dados;
  if (JSON.stringify(resto).length > LIMITE_PROPOSTA) throw new ErroApi('A proposta ficou grande demais para salvar.');
  return resto;
}

const paraTempo = (v) => (v instanceof Date ? v.getTime() : new Date(v).getTime());

const linhaParaProposta = (r) => ({
  ...(r.dados ?? {}),
  id: r.id,
  numero: r.numero,
  token: r.token,
  atualizadoEm: paraTempo(r.atualizado_em),
  atualizadoPor: r.atualizado_por
});

/** Próximo número do ano: 2026-0001, 2026-0002… (seguro com várias pessoas criando ao mesmo tempo). */
async function proximoNumero(b) {
  const ano = new Date().getFullYear();
  const [r] = await b.consulta(
    `INSERT INTO memoria (chave, dados) VALUES ($1, '{"n":1}'::jsonb)
     ON CONFLICT (chave) DO UPDATE SET dados = jsonb_build_object('n', (memoria.dados->>'n')::int + 1), atualizado_em = NOW()
     RETURNING dados->>'n' AS n`,
    [`numero:${ano}`]
  );
  return `${ano}-${String(r.n).padStart(4, '0')}`;
}

export async function tratarApi({ metodo, caminho, corpo = {}, cookies = {}, https = false }) {
  try {
    const partes = String(caminho).split('?')[0].split('/').filter(Boolean); // ['api', 'propostas', ':id']
    const recurso = partes[1] ?? '';
    const id = partes[2] ? decodeURIComponent(partes[2]) : '';
    const rota = `${String(metodo).toUpperCase()} /${recurso}`;
    const c = objetoSimples(corpo) ? corpo : {};
    const b = await obterBanco();

    // ---------- Público: página do cliente ----------
    if (rota === 'GET /publico') {
      const [r] = await b.consulta(`SELECT * FROM propostas WHERE token = $1 AND NOT apagada`, [id]);
      if (!r) throw new ErroApi('Proposta não encontrada.', 404);
      const [emp] = await b.consulta(`SELECT dados FROM memoria WHERE chave = 'empresa'`);
      const { criadoEm, ...q } = r.dados ?? {};
      const { pagamento, condicoes, validade, ...e } = emp?.dados ?? {};
      return ok({ q: { ...q, numero: r.numero }, e });
    }

    // ---------- Entrada pelo portal ----------
    if (rota === 'POST /entrar') {
      const segredo = segredoDoPasse();
      if (!segredo) throw new ErroApi('A entrada pelo portal ainda não foi configurada (falta PORTAL_PASSE_SEGREDO).', 503);
      const d = conferirPasse(String(c.passe ?? ''), segredo);
      if (!d) throw new ErroApi('O link de entrada venceu ou é inválido. Abra de novo pelo portal.', 401);
      const usado = await b.consulta(`INSERT INTO passes_usados (id) VALUES ($1) ON CONFLICT (id) DO NOTHING RETURNING id`, [d.id]);
      if (!usado.length) throw new ErroApi('Este link de entrada já foi usado. Abra de novo pelo portal.', 401);
      await b.consulta(`DELETE FROM passes_usados WHERE usado_em < NOW() - INTERVAL '1 day'`);
      await b.consulta(`DELETE FROM sessoes WHERE expira_em < NOW()`);
      const token = randomBytes(32).toString('base64url');
      const usuario = { email: d.e, nome: String(d.n || d.e), perfil: String(d.p ?? '') };
      await b.consulta(
        `INSERT INTO sessoes (token_hash, email, nome, perfil, expira_em) VALUES ($1, $2, $3, $4, NOW() + ($5 || ' hours')::interval)`,
        [resumo(token), usuario.email, usuario.nome, usuario.perfil, String(HORAS_SESSAO)]
      );
      await auditar(b, usuario, 'entrou_pelo_portal');
      return ok({ usuario }, { 'Set-Cookie': cookieSessao(token, https) });
    }

    if (rota === 'POST /sair') {
      const token = cookies[COOKIE_SESSAO];
      if (token) await b.consulta(`DELETE FROM sessoes WHERE token_hash = $1`, [resumo(token)]);
      return ok({ ok: true }, { 'Set-Cookie': cookieSessao('', https, 0) });
    }

    // ---------- Daqui para baixo, só com sessão ----------
    const u = await usuarioDaSessao(b, cookies);
    if (!u) throw new ErroApi('Entre pelo Portal Táxi 2.0 para abrir os orçamentos.', 401);

    if (rota === 'GET /dados') {
      const linhas = await b.consulta(`SELECT * FROM propostas WHERE NOT apagada ORDER BY atualizado_em DESC`);
      const [emp] = await b.consulta(`SELECT dados FROM memoria WHERE chave = 'empresa'`);
      return ok({ usuario: u, empresa: emp?.dados ?? null, propostas: linhas.map(linhaParaProposta) });
    }

    if (rota === 'POST /propostas' && !id) {
      const dados = limparProposta(c.dados);
      const numero = await proximoNumero(b);
      const novoId = randomUUID();
      const token = randomBytes(9).toString('base64url');
      dados.numero = numero;
      const [r] = await b.consulta(
        `INSERT INTO propostas (id, numero, token, dados, criado_por, atualizado_por) VALUES ($1, $2, $3, $4::jsonb, $5, $5) RETURNING *`,
        [novoId, numero, token, JSON.stringify(dados), u.nome]
      );
      await auditar(b, u, 'criou_proposta', novoId, `Proposta ${numero}`);
      return ok({ proposta: linhaParaProposta(r) });
    }

    if (rota === 'PUT /propostas' && id) {
      const dados = limparProposta(c.dados);
      const numero = String(dados.numero ?? '').trim().slice(0, 40);
      const [r] = await b.consulta(
        `UPDATE propostas SET dados = $2::jsonb, numero = COALESCE(NULLIF($3, ''), numero), atualizado_em = NOW(), atualizado_por = $4
         WHERE id = $1 AND NOT apagada RETURNING *`,
        [id, JSON.stringify(dados), numero, u.nome]
      );
      if (!r) throw new ErroApi('Proposta não encontrada (pode ter sido apagada por outra pessoa).', 404);
      return ok({ proposta: linhaParaProposta(r) });
    }

    if (rota === 'DELETE /propostas' && id) {
      const [r] = await b.consulta(
        `UPDATE propostas SET apagada = TRUE, atualizado_em = NOW(), atualizado_por = $2 WHERE id = $1 AND NOT apagada RETURNING numero`,
        [id, u.nome]
      );
      if (!r) throw new ErroApi('Proposta não encontrada.', 404);
      await auditar(b, u, 'apagou_proposta', id, `Proposta ${r.numero}`);
      return ok({ ok: true });
    }

    if (rota === 'PUT /empresa') {
      if (!objetoSimples(c.empresa)) throw new ErroApi('Dados da empresa inválidos.');
      const texto = JSON.stringify(c.empresa);
      if (texto.length > LIMITE_EMPRESA) throw new ErroApi('Os dados da empresa ficaram grandes demais (a logo é grande?).');
      await b.consulta(
        `INSERT INTO memoria (chave, dados) VALUES ('empresa', $1::jsonb)
         ON CONFLICT (chave) DO UPDATE SET dados = EXCLUDED.dados, atualizado_em = NOW()`,
        [texto]
      );
      return ok({ ok: true });
    }

    throw new ErroApi('Rota não encontrada.', 404);
  } catch (erro) {
    if (erro instanceof ErroApi) return { status: erro.status, corpo: { erro: erro.message } };
    console.error(erro);
    const msg = String(erro?.message ?? '');
    return { status: 500, corpo: { erro: msg.includes('DATABASE_URL') ? msg : 'Erro no servidor. Tente de novo em instantes.' } };
  }
}
