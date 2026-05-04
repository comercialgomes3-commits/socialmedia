# Comando Social — Notion + Make Automation

Web app que envia comandos de texto para o Notion, disparando automaticamente a automação do Make para criar itens no calendário de redes sociais.

## Como funciona

1. Usuário digita um comando no site (ex: "reels decor entrecasa amanhã")
2. O backend cria um item no banco **Comando (Title)** do Notion com `status = Novo`
3. O Make detecta o novo item e dispara o fluxo de IA → webhook → calendário
4. O site monitora o status e exibe quando o comando foi processado

---

## Setup local

```bash
# 1. Clone o repositório
git clone https://github.com/SEU_USUARIO/notion-comando-social
cd notion-comando-social

# 2. Instale dependências
npm install

# 3. Configure as variáveis de ambiente
cp .env.example .env
# Edite o .env com seus valores

# 4. Rode em desenvolvimento
npm run dev

# 5. Acesse em http://localhost:3000
```

---

## Variáveis de ambiente

| Variável | Descrição | Onde pegar |
|---|---|---|
| `NOTION_TOKEN` | Token de integração interna | notion.so/my-integrations → Secrets |
| `NOTION_DATABASE_ID` | ID do banco "Comando (Title)" | URL do banco no Notion |
| `PORT` | Porta do servidor (opcional) | Railway/Render define automaticamente |

---

## Deploy no Railway

1. Faça push para o GitHub
2. Acesse [railway.app](https://railway.app) → **New Project** → **Deploy from GitHub**
3. Selecione o repositório
4. Vá em **Variables** e adicione:
   - `NOTION_TOKEN`
   - `NOTION_DATABASE_ID`
5. Railway detecta o `package.json` e faz deploy automático

## Deploy no Render

1. Faça push para o GitHub
2. Acesse [render.com](https://render.com) → **New** → **Web Service**
3. Conecte o repositório
4. Configure:
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
5. Adicione as variáveis de ambiente na aba **Environment**

---

## Estrutura do projeto

```
notion-comando-social/
├── src/
│   └── server.js          # Backend Express
├── public/
│   └── index.html         # Frontend
├── .env.example           # Exemplo de variáveis
├── .gitignore
├── package.json
└── README.md
```

---

## Endpoints da API

### `POST /api/comando`
Cria um novo item no Notion.

**Body:**
```json
{ "comando": "reels decor entrecasa amanhã" }
```

**Resposta:**
```json
{
  "success": true,
  "id": "page-id-do-notion",
  "message": "Comando enviado! O Make vai processar em instantes."
}
```

### `GET /api/status/:id`
Consulta o status de um item pelo ID do Notion.

**Resposta:**
```json
{
  "status": "Concluído",
  "resultado": "Reels 'Decoração Entrecasa' agendado para amanhã no Instagram."
}
```

### `GET /health`
Health check do servidor.
