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

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// POST /api/comando — cria item no Notion
app.post('/api/comando', async (req, res) => {
  const { comando } = req.body;

  if (!comando || !comando.trim()) {
    return res.status(400).json({ error: 'Comando não pode estar vazio.' });
  }

  const token = process.env.NOTION_TOKEN;
  const databaseId = process.env.NOTION_DATABASE_ID;

  if (!token || !databaseId) {
    console.error('NOTION_TOKEN ou NOTION_DATABASE_ID não configurados.');
    return res.status(500).json({ error: 'Servidor não configurado corretamente.' });
  }

  try {
    const response = await fetch('https://api.notion.com/v1/pages', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Notion-Version': '2022-06-28',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        parent: { database_id: databaseId },
        properties: {
          Comando: {
            title: [
              {
                text: { content: comando.trim() }
              }
            ]
          },
          status: {
            select: { name: 'Novo' }
          }
        }
      })
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('Erro Notion API:', data);
      return res.status(response.status).json({
        error: data.message || 'Erro ao criar item no Notion.'
      });
    }

    return res.json({
      success: true,
      id: data.id,
      message: 'Comando enviado! O Make vai processar em instantes.'
    });

  } catch (err) {
    console.error('Erro interno:', err);
    return res.status(500).json({ error: 'Erro interno do servidor.' });
  }
});

// GET /api/status/:id — consulta status do item no Notion
app.get('/api/status/:id', async (req, res) => {
  const { id } = req.params;
  const token = process.env.NOTION_TOKEN;

  try {
    const response = await fetch(`https://api.notion.com/v1/pages/${id}`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Notion-Version': '2022-06-28',
      }
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({ error: 'Item não encontrado.' });
    }

    const status = data.properties?.status?.select?.name || 'Desconhecido';
    const resultado = data.properties?.resultado?.rich_text?.[0]?.text?.content || '';

    return res.json({ status, resultado });

  } catch (err) {
    console.error('Erro ao consultar status:', err);
    return res.status(500).json({ error: 'Erro ao consultar status.' });
  }
});

// Fallback — serve o index.html para qualquer rota não encontrada
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

app.listen(PORT, () => {
  console.log(`✅ Servidor rodando na porta ${PORT}`);
});
