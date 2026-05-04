require('dotenv').config();
const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const NOTION_VERSION = '2022-06-28';

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

function extrairJson(texto) {
  const clean = String(texto || '').replace(/```json|```/g, '').trim();
  const start = clean.indexOf('{');
  const end = clean.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('A IA não retornou JSON válido.');
  return JSON.parse(clean.slice(start, end + 1));
}

function normalizarPlataforma(plataforma, tipo) {
  if (Array.isArray(plataforma) && plataforma.length) return plataforma;
  if (typeof plataforma === 'string' && plataforma.trim()) return [plataforma.trim()];
  if (tipo === 'Status') return ['WhatsApp'];
  return ['Instagram'];
}

async function interpretarComando(comando) {
  const HF_TOKEN = process.env.HF_TOKEN || process.env.HF_API_KEY;
  if (!HF_TOKEN) throw new Error('HF_TOKEN não configurado.');

  const hoje = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });

  const prompt = `
Você é uma IA especialista em planejamento de redes sociais para a Comercial Gomes.

Data atual no Brasil: ${hoje}

Transforme este comando em JSON válido:
"${comando}"

Regras:
- Se o usuário pedir quantidade, crie vários itens dentro de "itens".
- Exemplo: "4 reels semana que vem" = 4 itens do tipo Reels distribuídos na semana.
- Distribuição padrão:
  - Reels: Segunda, Terça, Quinta e Sexta.
  - Status: Quarta e Sábado.
  - Carrossel: Sábado.
  - Post: Quarta.
- Se mencionar "semana que vem", use datas da próxima semana.
- Se mencionar "essa semana", use datas futuras desta semana.
- Se mencionar "amanhã", use amanhã.
- Se não houver data clara, use próximos dias disponíveis.
- Plataforma deve ser sempre array.
- Plataforma padrão para Reels, Carrossel e Post: ["Instagram"].
- Plataforma padrão para Status: ["WhatsApp"].
- Tema deve ser título comercial limpo.
- Dia deve ser em português: Segunda, Terça, Quarta, Quinta, Sexta, Sábado ou Domingo.

Responda SOMENTE JSON válido, sem markdown, nesse formato:

{
  "resumo": "",
  "itens": [
    {
      "tema": "",
      "tipo": "Reels",
      "plataforma": ["Instagram"],
      "data": "YYYY-MM-DD",
      "dia": "Segunda"
    }
  ]
}
`;

  const response = await fetch('https://router.huggingface.co/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${HF_TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: process.env.HF_MODEL || 'Qwen/Qwen2.5-7B-Instruct',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.2,
      max_tokens: 1200
    })
  });

  const raw = await response.text();

  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    console.error('Resposta não JSON da Hugging Face:', raw);
    throw new Error('Hugging Face retornou resposta inválida.');
  }

  if (!response.ok) {
    console.error('Erro Hugging Face:', data);
    throw new Error(data.error?.message || data.error || 'Erro na Hugging Face.');
  }

  const texto = data.choices?.[0]?.message?.content;
  if (!texto) throw new Error('A Hugging Face não retornou texto.');

  const parsed = extrairJson(texto);

  if (!Array.isArray(parsed.itens)) {
    throw new Error('A IA não retornou a lista "itens".');
  }

  parsed.itens = parsed.itens.map((item) => ({
    tema: item.tema || 'Conteúdo sem título',
    tipo: item.tipo || 'Reels',
    plataforma: normalizarPlataforma(item.plataforma, item.tipo || 'Reels'),
    data: item.data,
    dia: item.dia || ''
  }));

  return parsed;
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
          title: [{ text: { content: item.tema || 'Conteúdo sem título' } }]
        },
        Date: {
          date: { start: item.data }
        },
        Dia: {
          rich_text: [{ text: { content: item.dia || '' } }]
        },
        Select: {
          select: { name: item.tipo || 'Reels' }
        },
        Plataforma: {
          multi_select: normalizarPlataforma(item.plataforma, item.tipo).map((p) => ({ name: p }))
        }
      }
    })
  });

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
    const plano = await interpretarComando(comando.trim());

    const criados = [];
    for (const item of plano.itens) {
      const notionPage = await criarNoCronograma(item);
      criados.push({
        id: notionPage.id,
        tema: item.tema,
        data: item.data,
        tipo: item.tipo,
        plataforma: item.plataforma
      });
    }

    return res.json({
      success: true,
      message: plano.resumo || `${criados.length} conteúdo(s) criado(s) no cronograma.`,
      total: criados.length,
      itens: criados
    });
  } catch (err) {
    console.error('Erro ao processar comando:', err);
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
