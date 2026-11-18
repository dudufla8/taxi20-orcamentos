/**
 * Banco de dados do Orçamentos (Postgres) — o mesmo jeito do portal e do financeiro.
 * - Com DATABASE_URL (Neon): usa o banco na nuvem.
 * - Sem DATABASE_URL: usa um banco de teste (PGlite) em dados/banco-local, só neste computador.
 */
import { mkdirSync } from 'node:fs';

let banco = null;

async function abrirNeon(url) {
  const { neon } = await import('@neondatabase/serverless');
  const sql = neon(url);
  return { tipo: 'nuvem', consulta: async (texto, parametros = []) => await sql.query(texto, parametros) };
}

export async function abrirPglite(pasta) {
  const { PGlite } = await import('@electric-sql/pglite');
  if (pasta) mkdirSync(pasta, { recursive: true });
  const db = pasta ? new PGlite(pasta) : new PGlite();
  return { tipo: 'local', consulta: async (texto, parametros = []) => (await db.query(texto, parametros)).rows };
}

/** Banco em uso (abre e prepara as tabelas na primeira vez). */
export function obterBanco() {
  if (!banco) {
    banco = (async () => {
      const url = process.env.DATABASE_URL?.trim();
      if (!url && process.env.VERCEL) throw new Error('Falta configurar o banco (DATABASE_URL) nas variáveis de ambiente da Vercel.');
      const b = url ? await abrirNeon(url) : await abrirPglite(process.env.BANCO_LOCAL_PASTA?.trim() || 'dados/banco-local');
      await prepararTabelas(b);
      return b;
    })().catch((erro) => {
      banco = null;
      throw erro;
    });
  }
  return banco;
}

/** Só para testes: usa um banco já aberto. */
export async function usarBanco(b) {
  await prepararTabelas(b);
  banco = Promise.resolve(b);
}

/** Cria as tabelas se não existirem (pode rodar várias vezes). */
export async function prepararTabelas(b) {
  const comandos = [
    `CREATE TABLE IF NOT EXISTS propostas (
      id TEXT PRIMARY KEY,
      numero TEXT NOT NULL,
      token TEXT NOT NULL UNIQUE,
      dados JSONB NOT NULL,
      criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      criado_por TEXT NOT NULL DEFAULT '',
      atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      atualizado_por TEXT NOT NULL DEFAULT '',
      apagada BOOLEAN NOT NULL DEFAULT FALSE
    )`,
    `CREATE INDEX IF NOT EXISTS propostas_atualizado ON propostas (atualizado_em DESC)`,
    // Aprovação feita pelo cliente no link e visualizações do link (ficam fora de "dados"
    // para que um salvamento da equipe nunca apague o que o cliente fez).
    `ALTER TABLE propostas ADD COLUMN IF NOT EXISTS aprovado_em TIMESTAMPTZ`,
    `ALTER TABLE propostas ADD COLUMN IF NOT EXISTS aprovado_por TEXT`,
    `ALTER TABLE propostas ADD COLUMN IF NOT EXISTS aprovado_opcao TEXT`,
    `ALTER TABLE propostas ADD COLUMN IF NOT EXISTS aprovado_valor NUMERIC`,
    `ALTER TABLE propostas ADD COLUMN IF NOT EXISTS visto_primeiro TIMESTAMPTZ`,
    `ALTER TABLE propostas ADD COLUMN IF NOT EXISTS visto_ultimo TIMESTAMPTZ`,
    `ALTER TABLE propostas ADD COLUMN IF NOT EXISTS visualizacoes INTEGER NOT NULL DEFAULT 0`,
    // Sessões abertas pelo passe do portal (o token fica no cookie; aqui só o resumo SHA-256).
    `CREATE TABLE IF NOT EXISTS sessoes (
      token_hash TEXT PRIMARY KEY,
      email TEXT NOT NULL,
      nome TEXT NOT NULL,
      perfil TEXT NOT NULL DEFAULT '',
      criada_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      expira_em TIMESTAMPTZ NOT NULL
    )`,
    // Cada passe do portal entra uma vez só.
    `CREATE TABLE IF NOT EXISTS passes_usados (
      id TEXT PRIMARY KEY,
      usado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    // Dados da empresa e numeração das propostas.
    `CREATE TABLE IF NOT EXISTS memoria (
      chave TEXT PRIMARY KEY,
      dados JSONB NOT NULL,
      atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    // Registro de auditoria: só inclusão. Alterar ou apagar uma linha dá erro.
    `CREATE TABLE IF NOT EXISTS auditoria (
      id BIGSERIAL PRIMARY KEY,
      quando TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      email TEXT NOT NULL DEFAULT '',
      nome TEXT NOT NULL DEFAULT '',
      acao TEXT NOT NULL,
      registro_id TEXT NOT NULL DEFAULT '',
      descricao TEXT NOT NULL DEFAULT ''
    )`,
    `CREATE OR REPLACE FUNCTION auditoria_somente_inclusao() RETURNS trigger AS $$
     BEGIN
       RAISE EXCEPTION 'O registro de auditoria não pode ser alterado nem apagado.';
     END;
     $$ LANGUAGE plpgsql`,
    `DROP TRIGGER IF EXISTS auditoria_protegida ON auditoria`,
    `CREATE TRIGGER auditoria_protegida BEFORE UPDATE OR DELETE ON auditoria FOR EACH ROW EXECUTE FUNCTION auditoria_somente_inclusao()`
  ];
  for (const c of comandos) await b.consulta(c);
}
