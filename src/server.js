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

const NOTION_VERSION = '2022-06-28';

function hojeBrasil() {
  return new Date().toLocaleDateString('en-CA', {
    timeZone: 'America/Sao_Paulo'
  });
}

function limparJson(texto) {
  const clean = texto.replace(/```json|```/g, '').trim();
  const start = clean.indexOf('{');
  const end = clean.lastIndexOf('}');

  if (start === -1 || end === -1) {
    throw new Error('A IA não retornou JSON válido.');
  }

  return JSON.parse(clean.slice(start, end + 1));
}

async function interpretarComando(comando) {
  const hfToken = process.env.HF_TOKEN;

  if (!hfToken) {
    throw new Error('HF_TOKEN não configurado.');
  }

  const hoje = hojeBrasil();

  const prompt = `
Você é uma IA especialista em planejamento de redes sociais para a Comercial Gomes.

Interprete o comando abaixo e transforme em JSON válido para criar um item no cronograma.

Data atual no Brasil: ${hoje}

Comando:
"${comando}"

Regras:
- Se mencionar reels, tipo = "Reels"
- Se mencionar carrossel, tipo = "Carrossel"
- Se mencionar status, stories ou whatsapp, tipo = "Status"
- Se não mencionar tipo, use "Reels"
- Se mencionar TikTok, plataforma = "TikTok"
- Se mencionar WhatsApp, plataforma = "WhatsApp"
- Se for Status e não mencionar plataforma, plataforma = "WhatsApp"
- Caso contrário, plataforma = "Instagram"
- Se mencionar amanhã, use a data de amanhã
- Se mencionar hoje, use a data atual
- Se não houver data clara, use o próximo dia útil
- O campo dia deve ser: Segunda, Terça, Quarta, Quinta, Sexta, Sábado ou Domingo
- O tema deve ser um título comercial limpo

Responda SOMENTE JSON válido, sem markdown:

{
  "tema": "",
  "data": "YYYY-MM-DD",
  "dia": "",
  "tipo": "",
  "plataforma": "",
  "resumo": ""
}
`;

  const response = await fetch('https://router.huggingface.co/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${hfToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: process.env.HF_MODEL || 'Qwen/Qwen2.5-7B-Instruct',
      messages: [
        {
          role: 'user',
          content: prompt
        }
      ],
      temperature: 0.2,
      max_tokens: 500
    })
  });

  const data = await response.json();

  if (!response.ok) {
    console.error('Erro Hugging Face:', data);
    throw new Error(data.error?.message || data.error || 'Erro ao interpretar comando com Hugging Face.');
  }

  const texto = data.choices?.[0]?.message?.content;

  if (!texto) {
    console.error('Resposta Hugging Face sem texto:', data);
    throw new Error('A Hugging Face não retornou texto.');
  }

  return limparJson(texto);
}

async function criarNoCronograma(item) {
  const notionToken = process.env.NOTION_TOKEN;
  const databaseId = process.env.NOTION_DATABASE_ID;

  if (!notionToken || !databaseId) {
    throw new Error('NOTION_TOKEN ou NOTION_DATABASE_ID não configurados.');
  }

  const response = await fetch('https://api.notion.com/v1/pages', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${notionToken}`,
      'Notion-Version': NOTION_VERSION,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      parent: { database_id: databaseId },
      properties: {
        Tema: {
          title: [
            {
              text: {
                content: item.tema || 'Conteúdo sem título'
              }
            }
          ]
        },
        Date: {
          date: {
            start: item.data
          }
        },
        Dia: {
          rich_text: [
            {
              text: {
                content: item.dia || ''
              }
            }
          ]
        },
        Select: {
          select: {
            name: item.tipo || 'Reels'
          }
        },
        Plataforma: {
  multi_select: [
    {
      name: item.plataforma || 'Instagram'
    }
  ]
}

  const data = await response.json();

  if (!response.ok) {
    console.error('Erro Notion:', data);
    throw new Error(data.message || 'Erro ao criar item no Notion.');
  }

  return data;
}

app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.post('/api/comando', async (req, res) => {
  const { comando } = req.body;

  if (!comando || !comando.trim()) {
    return res.status(400).json({ error: 'Comando não pode estar vazio.' });
  }

  try {
    const item = await interpretarComando(comando.trim());
    const notionPage = await criarNoCronograma(item);

    return res.json({
      success: true,
      id: notionPage.id,
      message: item.resumo || 'Conteúdo criado no cronograma com sucesso.',
      item
    });
  } catch (err) {
    console.error('Erro:', err);
    return res.status(500).json({
      error: err.message || 'Erro interno do servidor.'
    });
  }
});

app.get('/api/status/:id', async (req, res) => {
  res.json({
    status: 'Concluído',
    resultado: 'Conteúdo enviado diretamente para o cronograma.'
  });
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

app.listen(PORT, () => {
  console.log(`✅ Servidor rodando na porta ${PORT}`);
});
