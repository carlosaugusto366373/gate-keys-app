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
  await pool.query(`
    CREATE TABLE IF NOT EXISTS config (
      id INTEGER PRIMARY KEY,
      dados JSONB NOT NULL,
      atualizado_em TIMESTAMP DEFAULT NOW()
    );
  `);

  const { rows } = await pool.query('SELECT * FROM config WHERE id = 1');
  if (rows.length === 0) {
    await pool.query('INSERT INTO config (id, dados) VALUES (1, $1)', [CONFIG_PADRAO]);
    console.log('✅ Config padrão inserida no banco.');
  } else {
    // Migração: se já existe config mas não tem downloads, mescla
    const atual = rows[0].dados;
    let precisaAtualizar = false;

    if (!atual.marca) { atual.marca = CONFIG_PADRAO.marca; precisaAtualizar = true; }
    if (!atual.downloads) { atual.downloads = CONFIG_PADRAO.downloads; precisaAtualizar = true; }

    if (precisaAtualizar) {
      await pool.query('UPDATE config SET dados = $1 WHERE id = 1', [atual]);
      console.log('✅ Config atualizada com novos campos (downloads / marca).');
    } else {
      console.log('✅ Config já existe no banco.');
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
    if (!nova || typeof nova !== 'object') {
      return res.status(400).json({ erro: 'Config inválida' });
    }
    await pool.query(
      'UPDATE config SET dados = $1, atualizado_em = NOW() WHERE id = 1',
      [nova]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: 'Erro ao salvar' });
  }
});

initDB()
  .then(() => {
    app.listen(PORT, () => console.log(`🚀 Servidor rodando na porta ${PORT}`));
  })
  .catch(err => {
    console.error('❌ Erro ao iniciar banco:', err);
    process.exit(1);
  });
