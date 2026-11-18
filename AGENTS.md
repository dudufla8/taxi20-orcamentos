# Regras para qualquer assistente de IA neste projeto

## Quem usa
- O dono do projeto é **iniciante**. Responda **sempre em português do Brasil**, com **passos numerados e simples**.
- Só faça `git commit` quando ele disser **"salvar"**, e `git push` só com **"pode publicar"**. Cada push na `main` publica sozinho na Vercel.

## O que é
Módulo **Orçamentos** do Portal Táxi 2.0 (`../taxi20-app`). A equipe entra pelo passe do portal; o cliente abre `/p/<código>` sem login.
Leia o `README.md` (arquitetura e publicação).

## Segurança (obrigatório)
- **Nunca** peça, mostre ou grave no Git: `DATABASE_URL`, `PORTAL_PASSE_SEGREDO` ou outras senhas. Ficam só no `.env.local` e nas variáveis da Vercel.
- **Nunca teste contra o banco Neon de produção.** No computador, `DATABASE_URL` fica vazio (o servidor local se recusa a abrir com ele preenchido).
- `servidor/passe.js` é cópia de `taxi20-app/src/servidor/passe.ts`. Se um mudar, mude o outro.
- A rota pública `GET /api/publico/:token` não pode devolver dados internos (quem editou, pagamento padrão etc.). Há teste para isso.

## Comandos
```
npm test             # testes do servidor (devem passar todos)
npm run dev          # roda em http://localhost:5180 com banco de teste
npm run passe-teste  # link de entrada local (vale 60 s)
```
