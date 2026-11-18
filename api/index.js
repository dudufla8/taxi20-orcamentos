/**
 * Servidor do Orçamentos na Vercel: todas as rotas /api/* chegam aqui (ver vercel.json)
 * e são tratadas pelo mesmo código usado no computador (servidor/api.js).
 * DATABASE_URL e PORTAL_PASSE_SEGREDO ficam nas variáveis de ambiente da Vercel.
 */
import { lerCookies, tratarApi } from '../servidor/api.js';

export default async function handler(req, res) {
  const url = new URL(req.url ?? '/', 'https://orcamentos.local');
  // O vercel.json manda /api/<rota> para /api/index?rota=<rota>
  const rota = url.searchParams.get('rota') ?? '';
  let corpo = req.body ?? {};
  if (typeof corpo === 'string') {
    try {
      corpo = corpo ? JSON.parse(corpo) : {};
    } catch {
      res.status(400).json({ erro: 'Corpo da requisição inválido.' });
      return;
    }
  }
  const r = await tratarApi({
    metodo: req.method ?? 'GET',
    caminho: `/api/${rota}`,
    corpo,
    cookies: lerCookies(req.headers.cookie),
    https: true
  });
  for (const [k, v] of Object.entries(r.cabecalhos ?? {})) res.setHeader(k, v);
  res.setHeader('Cache-Control', 'no-store');
  res.status(r.status).json(r.corpo);
}
