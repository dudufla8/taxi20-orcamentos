/**
 * Testes do servidor do Orçamentos (banco de teste em memória; nunca o Neon).
 * Rodar: npm test
 */
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { abrirPglite, usarBanco } from '../servidor/bd.js';
import { gerarPasse, conferirPasse } from '../servidor/passe.js';
import { tratarApi, COOKIE_SESSAO } from '../servidor/api.js';

const SEGREDO = 'segredo-de-teste-com-mais-de-32-caracteres!!';
process.env.PORTAL_PASSE_SEGREDO = SEGREDO;

before(async () => {
  await usarBanco(await abrirPglite());
});

const chamar = (metodo, caminho, corpo, cookies = {}) => tratarApi({ metodo, caminho, corpo, cookies });

async function entrar(nome = 'Ana') {
  const passe = gerarPasse({ email: `${nome.toLowerCase()}@taxi20.test`, nome, perfilId: 'atendimento' }, SEGREDO);
  const r = await chamar('POST', '/api/entrar', { passe });
  assert.equal(r.status, 200, JSON.stringify(r.corpo));
  const token = r.cabecalhos['Set-Cookie'].match(new RegExp(`${COOKIE_SESSAO}=([^;]+)`))[1];
  return { passe, cookies: { [COOKIE_SESSAO]: token } };
}

test('passe: aceita o verdadeiro e recusa alterado ou vencido', () => {
  const p = gerarPasse({ email: 'a@b.c', nome: 'A' }, SEGREDO);
  assert.ok(conferirPasse(p, SEGREDO));
  assert.equal(conferirPasse(p, 'outro-segredo-qualquer-com-32-caracteres!'), null);
  assert.equal(conferirPasse(p.slice(0, -2) + 'xx', SEGREDO), null);
  const vencido = gerarPasse({ email: 'a@b.c', nome: 'A' }, SEGREDO, Date.now() - 120_000);
  assert.equal(conferirPasse(vencido, SEGREDO), null);
});

test('entrada: o mesmo passe só entra uma vez', async () => {
  const { passe } = await entrar('Bia');
  const de_novo = await chamar('POST', '/api/entrar', { passe });
  assert.equal(de_novo.status, 401);
});

test('sem sessão não vê nem altera propostas', async () => {
  assert.equal((await chamar('GET', '/api/dados')).status, 401);
  assert.equal((await chamar('POST', '/api/propostas', { dados: {} })).status, 401);
  assert.equal((await chamar('GET', '/api/dados', undefined, { [COOKIE_SESSAO]: 'falso' })).status, 401);
});

test('propostas: numeração, salvar, link do cliente e apagar', async () => {
  const { cookies } = await entrar('Caio');
  const ano = new Date().getFullYear();

  const a = await chamar('POST', '/api/propostas', { dados: { numero: 'ignorado', cliente: { nome: 'Cliente X' }, opcoes: [] } }, cookies);
  const b = await chamar('POST', '/api/propostas', { dados: { cliente: { nome: 'Cliente Y' } } }, cookies);
  assert.equal(a.corpo.proposta.numero, `${ano}-0001`);
  assert.equal(b.corpo.proposta.numero, `${ano}-0002`);
  const p = a.corpo.proposta;
  assert.ok(p.token.length >= 10);

  // Salvar: o servidor não deixa trocar o id nem o código do link
  const salvo = await chamar('PUT', `/api/propostas/${p.id}`, { dados: { ...p, token: 'outro', rota: { origem: 'Curitiba, PR' } } }, cookies);
  assert.equal(salvo.status, 200);
  assert.equal(salvo.corpo.proposta.token, p.token);
  assert.equal(salvo.corpo.proposta.atualizadoPor, 'Caio');

  // Lista
  const dados = await chamar('GET', '/api/dados', undefined, cookies);
  assert.equal(dados.corpo.propostas.length, 2);
  assert.equal(dados.corpo.usuario.nome, 'Caio');

  // Empresa + página pública (sem login), sem dados internos
  await chamar('PUT', '/api/empresa', { empresa: { nome: 'Táxi 2.0', pagamento: 'interno' } }, cookies);
  const pub = await chamar('GET', `/api/publico/${p.token}`);
  assert.equal(pub.status, 200);
  assert.equal(pub.corpo.q.rota.origem, 'Curitiba, PR');
  assert.equal(pub.corpo.q.atualizadoPor, undefined);
  assert.equal(pub.corpo.e.nome, 'Táxi 2.0');
  assert.equal(pub.corpo.e.pagamento, undefined);
  assert.equal((await chamar('GET', '/api/publico/nao-existe')).status, 404);

  // Apagar: some da lista e do link do cliente
  assert.equal((await chamar('DELETE', `/api/propostas/${p.id}`, undefined, cookies)).status, 200);
  assert.equal((await chamar('GET', `/api/publico/${p.token}`)).status, 404);
  assert.equal((await chamar('GET', '/api/dados', undefined, cookies)).corpo.propostas.length, 1);
});

test('sair encerra a sessão', async () => {
  const { cookies } = await entrar('Davi');
  await chamar('POST', '/api/sair', {}, cookies);
  assert.equal((await chamar('GET', '/api/dados', undefined, cookies)).status, 401);
});

test('recusa proposta grande demais', async () => {
  const { cookies } = await entrar('Eva');
  const r = await chamar('POST', '/api/propostas', { dados: { observacoes: 'x'.repeat(250_000) } }, cookies);
  assert.equal(r.status, 400);
});
