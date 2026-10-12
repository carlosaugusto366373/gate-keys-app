require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('render.com')
    ? { rejectUnauthorized: false }
    : false
});

// Confia no proxy do Render pra pegar o IP real
app.set('trust proxy', true);

const CONFIG_PADRAO = {
  marca: 'QZZ Community',
  titulo: '🔑 Resgatar Key',
  subtitulo: 'Complete as etapas na ordem pra liberar sua key.',
  mensagemFinal: '✅ Tudo certo! Clique para resgatar.',
  etapas: [
    { texto: 'Deixe o <b>LIKE</b> no vídeo', link: 'https://youtube.com' },
    { texto: '<b>INSCREVA-SE</b> no canal', link: 'https://youtube.com' },
    { texto: 'Deixe um <b>COMENTÁRIO POSITIVO</b>', link: 'https://youtube.com' },
    { texto: 'Entre no <b>GRUPO DO WHATSAPP</b>', link: 'https://chat.whatsapp.com' },
    { texto: 'Entre no <b>DISCORD</b>', link: 'https://discord.gg' }
  ],
  keys: ['DEMO-KEY1-XXXX-YYYY'],
  downloads: {
    titulo: '📦 Downloads',
    subtitulo: 'Complete as etapas pra liberar o download.',
    etapas: [
      { texto: 'Deixe o <b>LIKE</b> no vídeo', link: 'https://youtube.com' },
      { texto: '<b>INSCREVA-SE</b> no canal', link: 'https://youtube.com' },
      { texto: 'Entre no <b>DISCORD</b>', link: 'https://discord.gg' }
    ],
    itens: [
      { nome: 'Programa Exemplo', link: 'https://exemplo.com/arquivo.zip' }
    ]
  }
};

async function initDB() {
  // Tabela de config
  await pool.query(`
    CREATE TABLE IF NOT EXISTS config (
      id INTEGER PRIMARY KEY,
      dados JSONB NOT NULL,
      atualizado_em TIMESTAMP DEFAULT NOW()
    );
  `);

  // Tabela de resgates (bloqueio por IP)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS resgates (
      id SERIAL PRIMARY KEY,
      ip TEXT NOT NULL,
      tipo TEXT NOT NULL,
      valor TEXT,
      criado_em TIMESTAMP DEFAULT NOW()
    );
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_resgates_ip_tipo ON resgates (ip, tipo);
  `);

  const { rows } = await pool.query('SELECT * FROM config WHERE id = 1');
  if (rows.length === 0) {
    await pool.query('INSERT INTO config (id, dados) VALUES (1, $1)', [CONFIG_PADRAO]);
    console.log('✅ Config padrão inserida.');
  } else {
    const atual = rows[0].dados;
    let precisa = false;
    if (!atual.marca) { atual.marca = CONFIG_PADRAO.marca; precisa = true; }
    if (!atual.downloads) { atual.downloads = CONFIG_PADRAO.downloads; precisa = true; }
    if (precisa) {
      await pool.query('UPDATE config SET dados = $1 WHERE id = 1', [atual]);
      console.log('✅ Config migrada com novos campos.');
    } else {
      console.log('✅ Config já existe.');
    }
  }
}

app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));

function authAdmin(req, res, next) {
  const senha = req.headers['x-admin-password'];
  if (!senha || senha !== process.env.ADMIN_PASSWORD) {
    return res.status(401).json({ erro: 'Senha inválida' });
  }
  next();
}

// Pega IP real do cliente (funciona atrás do proxy do Render)
function pegarIP(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (fwd) return fwd.split(',')[0].trim();
  return req.ip || req.connection?.remoteAddress || 'desconhecido';
}

app.get('/api/config', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT dados FROM config WHERE id = 1');
    if (rows.length === 0) return res.json(CONFIG_PADRAO);
    res.json(rows[0].dados);
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: 'Erro ao ler config' });
  }
});

app.post('/api/login', (req, res) => {
  const { senha } = req.body;
  if (senha === process.env.ADMIN_PASSWORD) res.json({ ok: true });
  else res.status(401).json({ ok: false, erro: 'Senha incorreta' });
});

app.post('/api/config', authAdmin, async (req, res) => {
  try {
    const nova = req.body;
    if (!nova || typeof nova !== 'object') return res.status(400).json({ erro: 'Inválida' });
    await pool.query('UPDATE config SET dados = $1, atualizado_em = NOW() WHERE id = 1', [nova]);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: 'Erro ao salvar' });
  }
});

// Verifica se o IP já resgatou key ou download
app.get('/api/status/:tipo', async (req, res) => {
  try {
    const tipo = req.params.tipo; // "keys" ou "downloads"
    if (!['keys', 'downloads'].includes(tipo)) return res.status(400).json({ erro: 'Tipo inválido' });
    const ip = pegarIP(req);
    const { rows } = await pool.query(
      'SELECT valor, criado_em FROM resgates WHERE ip = $1 AND tipo = $2 ORDER BY criado_em DESC LIMIT 1',
      [ip, tipo]
    );
    if (rows.length === 0) return res.json({ resgatou: false });
    res.json({ resgatou: true, valor: rows[0].valor, quando: rows[0].criado_em });
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: 'Erro ao verificar' });
  }
});

// Resgata key (bloqueado por IP)
app.post('/api/resgatar/key', async (req, res) => {
  try {
    const ip = pegarIP(req);
    const { rows: ja } = await pool.query(
      'SELECT valor FROM resgates WHERE ip = $1 AND tipo = $2 LIMIT 1',
      [ip, 'keys']
    );
    if (ja.length > 0) {
      return res.status(409).json({ erro: 'Você já resgatou uma key.', valor: ja[0].valor });
    }

    const { rows: cfg } = await pool.query('SELECT dados FROM config WHERE id = 1');
    const keys = (cfg[0]?.dados?.keys || []).filter(Boolean);
    if (!keys.length) return res.status(500).json({ erro: 'Nenhuma key cadastrada' });

    const key = keys[Math.floor(Math.random() * keys.length)];
    await pool.query('INSERT INTO resgates (ip, tipo, valor) VALUES ($1, $2, $3)', [ip, 'keys', key]);
    res.json({ ok: true, valor: key });
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: 'Erro ao resgatar' });
  }
});

// Libera downloads (bloqueado por IP)
app.post('/api/resgatar/downloads', async (req, res) => {
  try {
    const ip = pegarIP(req);
    const { rows: ja } = await pool.query(
      'SELECT id FROM resgates WHERE ip = $1 AND tipo = $2 LIMIT 1',
      [ip, 'downloads']
    );
    if (ja.length > 0) {
      // Já liberou antes — devolve os links de novo (não é problema)
      const { rows: cfg } = await pool.query('SELECT dados FROM config WHERE id = 1');
      const itens = cfg[0]?.dados?.downloads?.itens || [];
      return res.json({ ok: true, jaResgatou: true, itens });
    }

    const { rows: cfg } = await pool.query('SELECT dados FROM config WHERE id = 1');
    const itens = cfg[0]?.dados?.downloads?.itens || [];
    if (!itens.length) return res.status(500).json({ erro: 'Nenhum download cadastrado' });

    await pool.query('INSERT INTO resgates (ip, tipo, valor) VALUES ($1, $2, $3)', [ip, 'downloads', 'ok']);
    res.json({ ok: true, itens });
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: 'Erro ao liberar downloads' });
  }
});

// Admin: ver quantos resgates já rolaram
app.get('/api/admin/resgates', authAdmin, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT tipo, COUNT(*) as total FROM resgates GROUP BY tipo'
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ erro: 'Erro' });
  }
});

initDB()
  .then(() => app.listen(PORT, () => console.log(`🚀 Servidor rodando na porta ${PORT}`)))
  .catch(err => {
    console.error('❌ Erro ao iniciar banco:', err);
    process.exit(1);
  });
