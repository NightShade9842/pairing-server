const express = require('express');
const cors = require('cors');
const fs = require('fs');
const pino = require('pino');
const axios = require('axios');
const {
  makeWASocket,
  useMultiFileAuthState,
  makeCacheableSignalKeyStore,
  Browsers,
  fetchLatestBaileysVersion,
} = require('@whiskeysockets/baileys');
const pn = require('awesome-phonenumber');

const app = express();
app.use(cors());

// ── Factory URLs (comma‑separated, set in Render env) ──
const FACTORY_URLS = (process.env.FACTORY_URLS || 'https://sabaody-bot-factory.onrender.com')
  .split(',')
  .map(u => u.trim());

function removeDir(dir) {
  try { if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true }); } catch (e) {}
}

// ── Helper: find a factory with a free slot ──
async function getAvailableFactory() {
  for (const url of FACTORY_URLS) {
    try {
      const { data } = await axios.get(url + '/status', { timeout: 5000 });
      if (data.activeBots < data.maxBots) return url;
    } catch (e) { /* skip dead factories */ }
  }
  return null;
}

app.get('/api/pair', async (req, res) => {
  let num = req.query.phone;
  if (!num) return res.status(400).json({ success: false, error: 'Missing phone number' });

  num = num.replace(/[^0-9]/g, '');
  const phoneObj = pn('+' + num);
  if (!phoneObj.isValid()) return res.status(400).json({ success: false, error: 'Invalid phone number' });
  num = phoneObj.getNumber('e164').replace('+', '');

  // ── Check factory capacity before even connecting ──
  const factoryUrl = await getAvailableFactory();
  if (!factoryUrl) {
    return res.status(503).json({ success: false, error: 'All servers are full. Please try again later.' });
  }

  const sessionDir = './session_' + Date.now();

  try {
    const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
      version,
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'fatal' }).child({ level: 'fatal' })),
      },
      printQRInTerminal: false,
      logger: pino({ level: 'fatal' }).child({ level: 'fatal' }),
      browser: Browsers.windows('Chrome'),
      markOnlineOnConnect: false,
      generateHighQualityLinkPreview: false,
      defaultQueryTimeoutMs: 90000,
      connectTimeoutMs: 90000,
      keepAliveIntervalMs: 30000,
      retryRequestDelayMs: 250,
      maxRetries: 5,
    });

    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Connection timed out')), 90000);
      sock.ev.on('connection.update', (update) => {
        if (update.connection === 'open') {
          clearTimeout(timer);
          setTimeout(resolve, 4000);
        }
      });
    });

    const code = await sock.requestPairingCode(num);
    const formattedCode = code?.match(/.{1,4}/g)?.join('-') || code;

    res.json({ success: true, phone: num, code: formattedCode });

    // When WhatsApp accepts the code, forward the session to the chosen factory
    sock.ev.on('creds.update', async () => {
      try {
        await new Promise(r => setTimeout(r, 2000));
        const credsPath = sessionDir + '/creds.json';
        if (!fs.existsSync(credsPath)) return;

        const session = JSON.parse(fs.readFileSync(credsPath));
        await axios.post(factoryUrl + '/start-bot', {
          phone: num,
          session: session,
        });

        console.log(`Session for ${num} forwarded to ${factoryUrl}`);
        removeDir(sessionDir);
      } catch (err) {
        console.error('Failed to forward session:', err.message);
      }
    });

    setTimeout(() => { try { sock.ws?.close(); removeDir(sessionDir); } catch (e) {} }, 300000);

    sock.ev.on('connection.update', (update) => {
      if (update.connection === 'close') {
        setTimeout(() => removeDir(sessionDir), 5000);
      }
    });

    sock.ev.on('creds.update', saveCreds);

  } catch (err) {
    console.error('Pairing error:', err);
    if (!res.headersSent) res.status(500).json({ success: false, error: err.message || 'Internal error' });
    removeDir(sessionDir);
  }
});

app.get('/', (req, res) => res.send('SABAODY Pairing API'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('Pairing API running on port ' + PORT));