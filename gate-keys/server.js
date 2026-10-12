require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// ===== Conexão com o PostgreSQL do Render =====
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('render.com')
    ? { rejectUnauthorized: false }
    : false
});

// ===== Config padrão (usado se o banco estiver vazio) =====
const CONFIG_PADRAO = {
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
  keys: ['DEMO-KEY1-XXXX-YYYY']
};

// ===== Cria a tabela se não existir e insere padrão =====
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
    await pool.query(
      'INSERT INTO config (id, dados) VALUES (1, $1)',
      [CONFIG_PADRAO]
    );
    console.log('✅ Config padrão inserida no banco.');
  } else {
    console.log('✅ Config já existe no banco.');
  }
}

// ===== Middlewares =====
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ===== Middleware de autenticação do admin =====
function authAdmin(req, res, next) {
  const senha = req.headers['x-admin-password'];
  if (!senha || senha !== process.env.ADMIN_PASSWORD) {
    return res.status(401).json({ erro: 'Senha inválida' });
  }
  next();
}

// ===== Rotas da API =====

// Público: retorna a config atual
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

// Admin: verifica a senha
app.post('/api/login', (req, res) => {
  const { senha } = req.body;
  if (senha === process.env.ADMIN_PASSWORD) {
    res.json({ ok: true });
  } else {
    res.status(401).json({ ok: false, erro: 'Senha incorreta' });
  }
});

// Admin: salva a config
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

// ===== Sobe o servidor =====
initDB()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`🚀 Servidor rodando na porta ${PORT}`);
    });
  })
  .catch(err => {
    console.error('❌ Erro ao iniciar banco:', err);
    process.exit(1);
  });