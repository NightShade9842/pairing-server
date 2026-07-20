const express = require('express');
const cors = require('cors');
const fs = require('fs');
const pino = require('pino');
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

function removeDir(dir) {
  try {
    if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
  } catch (e) {}
}

app.get('/api/pair', async (req, res) => {
  let num = req.query.phone;
  if (!num) return res.status(400).json({ success: false, error: 'Missing phone number' });

  num = num.replace(/[^0-9]/g, '');
  const phoneObj = pn('+' + num);
  if (!phoneObj.isValid()) return res.status(400).json({ success: false, error: 'Invalid phone number' });
  num = phoneObj.getNumber('e164').replace('+', '');

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

    // Wait for the socket to be ready (connecting or open)
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Connection timed out')), 70000);
      sock.ev.on('connection.update', (update) => {
        const { connection } = update;
        if (connection === 'connecting' || connection === 'open') {
          clearTimeout(timer);
          setTimeout(resolve, 4000);
        }
      });
    });

    const code = await sock.requestPairingCode(num);
    const formattedCode = code?.match(/.{1,4}/g)?.join('-') || code;

    // Send the pairing code immediately
    res.json({ success: true, phone: num, code: formattedCode });

    // Keep the socket alive for 3 minutes so WhatsApp accepts the code
    setTimeout(() => {
      try { sock.ws?.close(); removeDir(sessionDir); } catch (e) {}
    }, 180000);

    // Do not force-close on disconnect — let WhatsApp handle the lifecycle
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

app.get('/', (req, res) => res.send('SABAODY Pairing API is running'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('Pairing API running on port ' + PORT));