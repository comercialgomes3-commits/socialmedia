require('dotenv').config();

const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const NOTION_VERSION = '2022-06-28';

app.use(cors());
app.use(express.json({ limit: '25mb' }));
app.use(express.static(path.join(__dirname, '../public')));

// ─────────────────────────────────────────────
// Helpers gerais
// ─────────────────────────────────────────────

function extrairJson(texto) {
  const clean = String(texto || '').replace(/```json|```/g, '').trim();
  const start = clean.indexOf('{');
  const end = clean.lastIndexOf('}');

  if (start === -1 || end === -1) {
    throw new Error('A IA não retornou JSON válido.');
  }

  return JSON.parse(clean.slice(start, end + 1));
}

function normalizarPlataforma(plataforma, tipo) {
  if (Array.isArray(plataforma) && plataforma.length) return plataforma;
  if (typeof plataforma === 'string' && plataforma.trim()) return [plataforma.trim()];

  if (tipo === 'Status') return ['WhatsApp'];
  return ['Instagram'];
}

function getDiaSemana(dataStr) {
  const nomes = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
  const [ano, mes, dia] = dataStr.split('-').map(Number);
  const d = new Date(Date.UTC(ano, mes - 1, dia));
  return nomes[d.getUTCDay()];
}

function normalizarTipo(tipo) {
  const t = String(tipo || '').toLowerCase();

  if (t.includes('status') || t.includes('story')) return 'Status';
  if (t.includes('carrossel')) return 'Carrossel';
  if (t.includes('post')) return 'Post';
  if (t.includes('reel')) return 'Reels';

  return 'Reels';
}

function normalizarItem(item) {
  const tipo = normalizarTipo(item.tipo);

  return {
    tema: item.tema || item.titulo || item.nome || 'Conteúdo sem título',
    tipo,
    plataforma: normalizarPlataforma(item.plataforma, tipo),
    data: item.data,
    dia: item.dia || (item.data ? getDiaSemana(item.data) : '')
  };
}

// ─────────────────────────────────────────────
// Notion
// ─────────────────────────────────────────────

async function deletarItemNotion(pageId) {
  const notionToken = process.env.NOTION_TOKEN;

  const response = await fetch(`https://api.notion.com/v1/pages/${pageId}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${notionToken}`,
      'Notion-Version': NOTION_VERSION,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      archived: true
    })
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.message || 'Erro ao remover item do Notion.');
  }

  return data;
}

async function buscarCronogramaExistente(dataInicio, dataFim) {
  const notionToken = process.env.NOTION_TOKEN;
  const databaseId = process.env.NOTION_DATABASE_ID;

  if (!notionToken || !databaseId) {
    throw new Error('NOTION_TOKEN ou NOTION_DATABASE_ID não configurados.');
  }

  const response = await fetch(`https://api.notion.com/v1/databases/${databaseId}/query`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${notionToken}`,
      'Notion-Version': NOTION_VERSION,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      filter: {
        and: [
          { property: 'Date', date: { on_or_after: dataInicio } },
          { property: 'Date', date: { on_or_before: dataFim } }
        ]
      },
      page_size: 100
    })
  });

  const data = await response.json();

  if (!response.ok) {
    console.error('Erro ao buscar cronograma:', data);
    throw new Error(data.message || 'Erro ao buscar cronograma existente.');
  }

  return (data.results || []).map((page) => {
    const props = page.properties || {};

    return {
      id: page.id,
      tema: props.Tema?.title?.[0]?.plain_text || '',
      data: props.Date?.date?.start || '',
      dia: props.Dia?.rich_text?.[0]?.plain_text || '',
      tipo: props.Select?.select?.name || '',
      plataforma: (props.Plataforma?.multi_select || []).map((p) => p.name)
    };
  });
}

function filtrarDuplicatas(itensPlanejados, existentes) {
  return itensPlanejados.filter((novo) => {
    const duplicado = existentes.some(
      (ex) => ex.data === novo.data && ex.tipo === novo.tipo
    );

    if (duplicado) {
      console.warn(`Duplicata bloqueada: ${novo.tipo} em ${novo.data} - ${novo.tema}`);
    }

    return !duplicado;
  });
}

async function criarNoCronograma(item) {
  const notionToken = process.env.NOTION_TOKEN;
  const databaseId = process.env.NOTION_DATABASE_ID;

  if (!notionToken || !databaseId) {
    throw new Error('NOTION_TOKEN ou NOTION_DATABASE_ID não configurados.');
  }

  const itemFinal = normalizarItem(item);

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
          title: [{ text: { content: itemFinal.tema } }]
        },
        Date: {
          date: { start: itemFinal.data }
        },
        Dia: {
          rich_text: [{ text: { content: itemFinal.dia || '' } }]
        },
        Select: {
          select: { name: itemFinal.tipo }
        },
        Plataforma: {
          multi_select: itemFinal.plataforma.map((p) => ({ name: p }))
        },
        Andamento: {
          select: { name: 'A iniciar' }
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

// ─────────────────────────────────────────────
// Datas
// ─────────────────────────────────────────────

function hojeBrasil() {
  const agora = new Date();

  return new Date(
    agora.toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' })
  );
}

function formatarDataBrasil(data) {
  return data.toLocaleDateString('en-CA', {
    timeZone: 'America/Sao_Paulo'
  });
}

function proximaDataPorDia(nomeDia) {
  const mapa = {
    domingo: 0,
    segunda: 1,
    terça: 2,
    terca: 2,
    quarta: 3,
    quinta: 4,
    sexta: 5,
    sábado: 6,
    sabado: 6
  };

  const alvo = mapa[String(nomeDia || '').toLowerCase()];
  if (alvo === undefined) return null;

  const hoje = hojeBrasil();
  hoje.setHours(0, 0, 0, 0);

  const atual = hoje.getDay();
  let diasParaAdicionar = (alvo - atual + 7) % 7;

  if (diasParaAdicionar === 0) {
    diasParaAdicionar = 7;
  }

  const novaData = new Date(hoje);
  novaData.setDate(hoje.getDate() + diasParaAdicionar);

  return formatarDataBrasil(novaData);
}

function resolverDatasNoComando(comando) {
  const diasMap = {
    domingo: 0,
    segunda: 1,
    terça: 2,
    terca: 2,
    quarta: 3,
    quinta: 4,
    sexta: 5,
    sábado: 6,
    sabado: 6
  };

  const hoje = hojeBrasil();
  hoje.setHours(0, 0, 0, 0);
  const diaAtual = hoje.getDay();

  let comandoResolvido = comando;

  const regexDia =
    /(?:próxim[ao]\s+|proxim[ao]\s+)?(segunda|terça|terca|quarta|quinta|sexta|sábado|sabado|domingo)(?:\s+que\s+vem)?/gi;

  comandoResolvido = comandoResolvido.replace(regexDia, (match, nomeDia) => {
    const alvo = diasMap[nomeDia.toLowerCase()];
    if (alvo === undefined) return match;

    let diasParaAdicionar = (alvo - diaAtual + 7) % 7;

    if (diasParaAdicionar === 0) {
      diasParaAdicionar = 7;
    }

    const dataAlvo = new Date(hoje);
    dataAlvo.setDate(hoje.getDate() + diasParaAdicionar);

    const dataStr = formatarDataBrasil(dataAlvo);
    const diaNome = getDiaSemana(dataStr);

    return `${diaNome} (${dataStr})`;
  });

  if (/amanhã|amanha/i.test(comandoResolvido)) {
    const amanha = new Date(hoje);
    amanha.setDate(hoje.getDate() + 1);

    const dataStr = formatarDataBrasil(amanha);

    comandoResolvido = comandoResolvido.replace(
      /amanhã|amanha/gi,
      `amanhã (${dataStr})`
    );
  }

  return comandoResolvido;
}

function calcularJanelaDatas(comando) {
  const hoje = hojeBrasil();
  hoje.setHours(0, 0, 0, 0);

  const diaSemana = hoje.getDay();
  const cmd = String(comando || '').toLowerCase();

  let dataInicio;
  let dataFim;

  if (cmd.includes('semana que vem') || cmd.includes('próxima semana')) {
    const diasAteProxSeg = (8 - diaSemana) % 7 || 7;

    dataInicio = new Date(hoje);
    dataInicio.setDate(hoje.getDate() + diasAteProxSeg);

    dataFim = new Date(dataInicio);
    dataFim.setDate(dataInicio.getDate() + 6);
  } else if (cmd.includes('essa semana') || cmd.includes('esta semana')) {
    dataInicio = new Date(hoje);
    dataInicio.setDate(hoje.getDate() + 1);

    dataFim = new Date(hoje);
    dataFim.setDate(hoje.getDate() + (6 - diaSemana));
  } else if (cmd.includes('esse mês') || cmd.includes('este mês')) {
    dataInicio = new Date(hoje.getFullYear(), hoje.getMonth(), 1);
    dataFim = new Date(hoje.getFullYear(), hoje.getMonth() + 1, 0);
  } else {
    dataInicio = new Date(hoje);
    dataFim = new Date(hoje);
    dataFim.setDate(hoje.getDate() + 30);
  }

  return {
    inicio: formatarDataBrasil(dataInicio),
    fim: formatarDataBrasil(dataFim)
  };
}

// ─────────────────────────────────────────────
// IA por texto — Hugging Face
// ─────────────────────────────────────────────

function detectarTarefaRepetida(comando) {
  const cmd = String(comando || '').toLowerCase();

  if (
    !cmd.includes('todos os dias') ||
    !(cmd.includes('esta semana') || cmd.includes('essa semana'))
  ) {
    return null;
  }

  const match =
    comando.match(/tema\s+"([^"]+)"/i) ||
    comando.match(/tarefa\s+(.+?)\s+para/i);

  const tema = match ? match[1].trim() : 'Gravação de status';

  const tipo = tema.toLowerCase().includes('status') ? 'Status' : 'Reels';
  const plataforma = tipo === 'Status' ? ['WhatsApp'] : ['Instagram'];

  const hoje = hojeBrasil();
  hoje.setHours(0, 0, 0, 0);

  const diaSemana = hoje.getDay();

  const dataInicio = new Date(hoje);
  dataInicio.setDate(hoje.getDate() + 1);

  const dataFim = new Date(hoje);
  dataFim.setDate(hoje.getDate() + (6 - diaSemana));

  const itens = [];

  for (let d = new Date(dataInicio); d <= dataFim; d.setDate(d.getDate() + 1)) {
    const data = formatarDataBrasil(d);

    itens.push({
      tema,
      tipo,
      plataforma,
      data,
      dia: getDiaSemana(data)
    });
  }

  return {
    resumo: `Tarefa "${tema}" repetida todos os dias desta semana a partir de amanhã.`,
    itens
  };
}

async function interpretarComando(comando, conteudosExistentes = []) {
  const HF_TOKEN = process.env.HF_TOKEN || process.env.HF_API_KEY;

  if (!HF_TOKEN) {
    throw new Error('HF_TOKEN não configurado.');
  }

  const hoje = new Date().toLocaleDateString('en-CA', {
    timeZone: 'America/Sao_Paulo'
  });

  const existentesStr = conteudosExistentes.length
    ? JSON.stringify(conteudosExistentes, null, 2)
    : 'Nenhum conteúdo encontrado no período.';

  const comandoResolvido = resolverDatasNoComando(comando);

  const prompt = `Você é Gabi, uma IA especialista em planejamento de redes sociais para a Comercial Gomes.

Data atual no Brasil: ${hoje}

Conteúdos já existentes no cronograma, não duplique data + tipo:
${existentesStr}

Comando do usuário:
"${comandoResolvido}"

Regras:
- As datas já foram resolvidas no comando (formato YYYY-MM-DD entre parênteses). USE ESSAS DATAS EXATAS.
- Se o usuário pedir quantidade, crie vários itens dentro de "itens".
- Se pedir "essa semana", use datas futuras desta semana.
- Nunca crie dois Reels no mesmo dia.
- Pode ter Reels + Status no mesmo dia.
- Status vai para ["WhatsApp"].
- Reels, Post e Carrossel vão para ["Instagram"].
- Reels preferenciais: Segunda, Terça, Quinta e Sexta.
- Status preferenciais: Quarta e Sábado.
- Carrossel preferencial: Sábado.
- Post preferencial: Quarta.
- Tema deve ser um título comercial limpo.
- data deve estar em YYYY-MM-DD.
- dia deve estar em português.

Responda SOMENTE JSON válido, sem markdown, neste formato:

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
}`;

  const response = await fetch('https://router.huggingface.co/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${HF_TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: process.env.HF_MODEL || 'Qwen/Qwen2.5-7B-Instruct',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.25,
      max_tokens: 1500
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

  if (!texto) {
    throw new Error('A Hugging Face não retornou texto.');
  }

  let parsed;

  try {
    parsed = JSON.parse(texto);
  } catch {
    parsed = extrairJson(texto);
  }

  if (Array.isArray(parsed.videos) && !Array.isArray(parsed.itens)) {
    parsed.itens = parsed.videos.map((v) => ({
      tema: v.tema || v.nome || 'Conteúdo sem título',
      tipo: v.tipo || 'Reels',
      plataforma: v.plataforma,
      data: v.data,
      dia: v.dia
    }));
  }

  if (!Array.isArray(parsed.itens)) {
    console.error('Resposta sem itens:', texto);
    throw new Error('A IA não retornou a lista "itens".');
  }

parsed.itens = parsed.itens
  .map(normalizarItem)
  .map((item) => ({
    ...item,
    dia: item.data ? getDiaSemana(item.data) : item.dia
  }));
  return parsed;
}

// ─────────────────────────────────────────────
// IA visual — Gemini para print/screenshot
// ─────────────────────────────────────────────

function limparImagemBase64(imagemBase64) {
  const texto = String(imagemBase64 || '');

  const match = texto.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);

  if (match) {
    return {
      mimeType: match[1],
      base64: match[2]
    };
  }

  return {
    mimeType: 'image/png',
    base64: texto
  };
}

async function interpretarPrintComGemini(imagemBase64, instrucoes = '') {
  const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

  if (!GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY não configurado.');
  }

  const hoje = new Date().toLocaleDateString('en-CA', {
    timeZone: 'America/Sao_Paulo'
  });

  const { mimeType, base64 } = limparImagemBase64(imagemBase64);

  const prompt = `Você é uma IA que lê prints/screenshot de listas de conteúdos de social media.

Data atual no Brasil: ${hoje}

Tarefa:
- Leia a imagem enviada.
- Identifique os conteúdos/vídeos da lista.
- Transforme cada conteúdo em um item para agendar no Notion.
- Se aparecer data no print, use a data do print.
- Se não aparecer data, distribua nos próximos dias úteis a partir da data atual.
- Se aparecer formato/plataforma, respeite.
- Se não aparecer tipo, use "Reels".
- Se não aparecer plataforma, use:
  - Reels, Post e Carrossel: ["Instagram"]
  - Status: ["WhatsApp"]
- Não invente conteúdo que não esteja no print, exceto quando precisar organizar título e data.
- O campo tema deve ser curto, limpo e comercial.
- O campo data deve ser YYYY-MM-DD.
- O campo dia deve ser em português.

Instruções adicionais do usuário:
${instrucoes || 'Nenhuma.'}

Responda SOMENTE JSON válido, sem markdown, neste formato:

{
  "resumo": "Resumo do que foi identificado no print",
  "itens": [
    {
      "tema": "Título do conteúdo",
      "tipo": "Reels",
      "plataforma": ["Instagram"],
      "data": "YYYY-MM-DD",
      "dia": "Segunda"
    }
  ]
}`;

  const model = process.env.GEMINI_MODEL || 'gemini-2.0-flash';

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        contents: [
          {
            role: 'user',
            parts: [
              { text: prompt },
              {
                inline_data: {
                  mime_type: mimeType,
                  data: base64
                }
              }
            ]
          }
        ],
        generationConfig: {
          temperature: 0,
          maxOutputTokens: 2000,
          responseMimeType: 'application/json',
          responseSchema: {
            type: 'OBJECT',
            properties: {
              resumo: {
                type: 'STRING'
              },
              itens: {
                type: 'ARRAY',
                items: {
                  type: 'OBJECT',
                  properties: {
                    tema: { type: 'STRING' },
                    tipo: { type: 'STRING' },
                    plataforma: {
                      type: 'ARRAY',
                      items: { type: 'STRING' }
                    },
                    data: { type: 'STRING' },
                    dia: { type: 'STRING' }
                  },
                  required: ['tema', 'tipo', 'plataforma', 'data', 'dia']
                }
              }
            },
            required: ['resumo', 'itens']
          }
        }
      })
    }
  );

  const data = await response.json();

  if (!response.ok) {
    console.error('Erro Gemini:', data);
    throw new Error(data.error?.message || 'Erro ao interpretar print com Gemini.');
  }

  const texto = data.candidates?.[0]?.content?.parts
    ?.map((p) => p.text || '')
    .join('\n');

  if (!texto) {
    throw new Error('O Gemini não retornou texto.');
  }

  let parsed;

  try {
    parsed = JSON.parse(texto);
  } catch (err) {
    console.error('JSON inválido retornado pelo Gemini:', texto);
    throw new Error('A IA retornou um JSON inválido. Tente enviar um print mais nítido ou recortado apenas na lista.');
  }

  if (!Array.isArray(parsed.itens)) {
    throw new Error('A IA visual não retornou a lista "itens".');
  }

  parsed.itens = parsed.itens.map(normalizarItem);

  return parsed;
}

// ─────────────────────────────────────────────
// Rotas
// ─────────────────────────────────────────────

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString()
  });
});

// Texto normal
app.post('/api/comando', async (req, res) => {
  const { comando, tipoManual, plataformaManual } = req.body;

  if (!comando || !comando.trim()) {
    return res.status(400).json({ error: 'Comando não pode estar vazio.' });
  }

  try {
    const janela = calcularJanelaDatas(comando.trim());
    const existentes = await buscarCronogramaExistente(janela.inicio, janela.fim);

    const planoManual = detectarTarefaRepetida(comando.trim());
    const plano = planoManual || await interpretarComando(comando.trim(), existentes);

    let itens = plano.itens.map((item) => ({
      ...item,
      tipo: Array.isArray(tipoManual) && tipoManual.length ? tipoManual[0] : item.tipo,
      plataforma:
        Array.isArray(plataformaManual) && plataformaManual.length
          ? plataformaManual
          : item.plataforma
    }));

    itens = itens.map(normalizarItem);

    const filtrados = filtrarDuplicatas(itens, existentes);
    const bloqueados = itens.length - filtrados.length;

    const criados = [];
    const erros = [];

    for (const item of filtrados) {
      try {
        const page = await criarNoCronograma(item);

        criados.push({
          id: page.id,
          tema: item.tema,
          data: item.data,
          dia: item.dia,
          tipo: item.tipo,
          plataforma: item.plataforma
        });
      } catch (err) {
        erros.push({
          tema: item.tema,
          erro: err.message
        });
      }
    }

    return res.json({
      success: true,
      message: plano.resumo || `${criados.length} conteúdo(s) criado(s) no cronograma.`,
      total: criados.length,
      bloqueados,
      erros,
      itens: criados
    });
  } catch (err) {
    console.error('Erro ao processar comando:', err);
    return res.status(500).json({
      error: err.message || 'Erro interno do servidor.'
    });
  }
});

// Print/screenshot: interpreta imagem e já agenda
app.post('/api/interpretar-print', async (req, res) => {
  const {
    imagemBase64,
    imageBase64,
    print,
    instrucoes,
    tipoManual,
    plataformaManual,
    autoAgendar = true
  } = req.body;

  const imagem = imagemBase64 || imageBase64 || print;

  if (!imagem) {
    return res.status(400).json({
      error: 'Envie a imagem em base64 no campo imagemBase64.'
    });
  }

  try {
    const plano = await interpretarPrintComGemini(imagem, instrucoes);

    let itens = plano.itens.map((item) => ({
      ...item,
      tipo: Array.isArray(tipoManual) && tipoManual.length ? tipoManual[0] : item.tipo,
      plataforma:
        Array.isArray(plataformaManual) && plataformaManual.length
          ? plataformaManual
          : item.plataforma
    }));

    itens = itens.map(normalizarItem);

    if (!autoAgendar) {
      return res.json({
        success: true,
        agendado: false,
        message: plano.resumo || 'Print interpretado com sucesso.',
        total: itens.length,
        itens
      });
    }

    const datas = itens.map((i) => i.data).filter(Boolean).sort();

    if (!datas.length) {
      return res.status(400).json({
        error: 'A IA não conseguiu identificar datas válidas para os itens.',
        itens
      });
    }

    const existentes = await buscarCronogramaExistente(datas[0], datas[datas.length - 1]);
    const filtrados = filtrarDuplicatas(itens, existentes);
    const bloqueados = itens.length - filtrados.length;

    const criados = [];
    const erros = [];

    for (const item of filtrados) {
      try {
        const page = await criarNoCronograma(item);

        criados.push({
          id: page.id,
          tema: item.tema,
          data: item.data,
          dia: item.dia,
          tipo: item.tipo,
          plataforma: item.plataforma
        });
      } catch (err) {
        erros.push({
          tema: item.tema,
          erro: err.message
        });
      }
    }

    return res.json({
      success: true,
      agendado: true,
      message: `${criados.length} conteúdo(s) agendado(s) via print.${bloqueados ? ` ${bloqueados} duplicata(s) ignorada(s).` : ''}`,
      resumo: plano.resumo || '',
      total: criados.length,
      bloqueados,
      erros,
      interpretados: itens,
      itens: criados
    });
  } catch (err) {
    console.error('Erro em /api/interpretar-print:', err);
    return res.status(500).json({
      error: err.message || 'Erro interno ao interpretar print.'
    });
  }
});

// Agendamento direto: recebe JSON pronto e cria no Notion
app.post('/api/agendar-direto', async (req, res) => {
  const itensRecebidos = req.body._itens_diretos || req.body.itens;

  if (!Array.isArray(itensRecebidos) || itensRecebidos.length === 0) {
    return res.status(400).json({ error: 'Nenhum item para agendar.' });
  }

  try {
    const itens = itensRecebidos.map(normalizarItem);

    for (const item of itens) {
      if (!item.tema || !item.tipo || !item.data) {
        return res.status(400).json({
          error: `Item inválido. Cada item precisa ter tema, tipo e data. Recebido: ${JSON.stringify(item)}`
        });
      }
    }

    const datas = itens.map((i) => i.data).sort();
    const existentes = await buscarCronogramaExistente(datas[0], datas[datas.length - 1]);

    const filtrados = filtrarDuplicatas(itens, existentes);
    const bloqueados = itens.length - filtrados.length;

    const criados = [];
    const erros = [];

    for (const item of filtrados) {
      try {
        const page = await criarNoCronograma(item);

        criados.push({
          id: page.id,
          tema: item.tema,
          data: item.data,
          dia: item.dia,
          tipo: item.tipo,
          plataforma: item.plataforma
        });
      } catch (err) {
        erros.push({
          tema: item.tema,
          erro: err.message
        });
      }
    }

    return res.json({
      success: true,
      message: `${criados.length} conteúdo(s) agendado(s).${bloqueados ? ` ${bloqueados} duplicata(s) ignorada(s).` : ''}`,
      total: criados.length,
      bloqueados,
      erros,
      itens: criados
    });
  } catch (err) {
    console.error('Erro em /api/agendar-direto:', err);
    return res.status(500).json({
      error: err.message || 'Erro interno do servidor.'
    });
  }
});

// Consulta cronograma existente
app.get('/api/cronograma', async (req, res) => {
  const { inicio, fim } = req.query;

  const hoje = new Date().toLocaleDateString('en-CA', {
    timeZone: 'America/Sao_Paulo'
  });

  const fimPadrao = new Date();
  fimPadrao.setDate(fimPadrao.getDate() + 30);

  try {
    const itens = await buscarCronogramaExistente(
      inicio || hoje,
      fim || fimPadrao.toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })
    );

    return res.json({
      success: true,
      total: itens.length,
      itens
    });
  } catch (err) {
    return res.status(500).json({
      error: err.message || 'Erro ao consultar cronograma.'
    });
  }
});

app.post('/api/preparar-remocao', async (req, res) => {
  const { comando } = req.body;

  try {
    const hoje = new Date().toLocaleDateString('en-CA', {
      timeZone: 'America/Sao_Paulo'
    });

    const fim = new Date();
    fim.setDate(fim.getDate() + 14);

    const existentes = await buscarCronogramaExistente(
      hoje,
      fim.toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })
    );

    const cmd = String(comando || '').toLowerCase();

    const tipo =
      cmd.includes('reels') ? 'Reels' :
      cmd.includes('status') ? 'Status' :
      cmd.includes('post') ? 'Post' :
      cmd.includes('carrossel') ? 'Carrossel' :
      '';

    const dias = ['segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado', 'domingo'];
    const diaBusca = dias.find(d => cmd.includes(d));

    const encontrados = existentes.filter(item => {
      const bateTipo = tipo ? item.tipo === tipo : true;
      const bateDia = diaBusca ? item.dia.toLowerCase().includes(diaBusca) : true;
      return bateTipo && bateDia;
    });

    return res.json({
      success: true,
      total: encontrados.length,
      itens: encontrados
    });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

app.post('/api/confirmar-remocao', async (req, res) => {
  const { ids } = req.body;

  if (!Array.isArray(ids) || !ids.length) {
    return res.status(400).json({ error: 'Nenhum item selecionado para remover.' });
  }

  try {
    for (const id of ids) {
      await deletarItemNotion(id);
    }

    return res.json({
      success: true,
      message: `${ids.length} item(ns) removido(s) do cronograma.`
    });

  } catch (err) {
    return res.status(500).json({ error: err.message });
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
  console.log(`Servidor rodando na porta ${PORT}`);
});
