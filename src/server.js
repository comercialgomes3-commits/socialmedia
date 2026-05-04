require('dotenv').config();
const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});


// 🔥 FUNÇÃO IA (Hugging Face)
async function interpretarComando(comando) {
  const HF_TOKEN = process.env.HF_API_KEY;

  const prompt = `
Transforme o comando abaixo em JSON estruturado.

REGRAS:
- tipo: Reels, Post, Carrossel ou Status
- plataforma: array (Instagram, TikTok, WhatsApp)
- data: YYYY-MM-DD
- dia: Segunda, Terça, etc

Exemplo:
{
 "tema": "Reels decor entrecasa",
 "tipo": "Reels",
 "plataforma": ["Instagram"],
 "data": "2026-05-05",
 "dia": "Segunda"
}

COMANDO:
"${comando}"

RESPONDA APENAS JSON.
`;

  const response = await fetch(
    "https://api-inference.huggingface.co/models/google/flan-t5-large",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${HF_TOKEN}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        inputs: prompt
      })
    }
  );

  const data = await response.json();

  let texto = data?.[0]?.generated_text || "";

  try {
    return JSON.parse(texto);
  } catch {
    throw new Error("IA retornou JSON inválido");
  }
}


// 🔥 CRIAR ITEM NO NOTION
async function criarItemNotion(dados) {
  const token = process.env.NOTION_TOKEN;
  const databaseId = process.env.NOTION_DATABASE_ID;

  return await fetch("https://api.notion.com/v1/pages", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Notion-Version": "2022-06-28",
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      parent: { database_id: databaseId },
      properties: {
        Tema: {
          title: [
            {
              text: {
                content: dados.tema || "Sem título"
              }
            }
          ]
        },
        Date: {
          date: {
            start: dados.data
          }
        },
        Dia: {
          rich_text: [
            {
              text: {
                content: dados.dia
              }
            }
          ]
        },
        Select: {
          select: {
            name: dados.tipo
          }
        },
        Plataforma: {
          multi_select: dados.plataforma.map(p => ({ name: p }))
        }
      }
    })
  });
}


// 🔥 ROTA PRINCIPAL
app.post('/api/comando', async (req, res) => {
  const { comando } = req.body;

  if (!comando) {
    return res.status(400).json({ error: 'Comando vazio' });
  }

  try {
    // 1. IA interpreta
    const estruturado = await interpretarComando(comando);

    // 2. Cria no Notion
    const response = await criarItemNotion(estruturado);
    const data = await response.json();

    if (!response.ok) {
      console.error(data);
      return res.status(500).json({
        error: data.message || 'Erro no Notion'
      });
    }

    res.json({
      success: true,
      message: "Criado com sucesso 🚀",
      data: estruturado
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({
      error: err.message || "Erro interno"
    });
  }
});


// fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

app.listen(PORT, () => {
  console.log(`🚀 Rodando na porta ${PORT}`);
});
