const express = require('express');
const cors = require('cors');
const fs = require('fs');
const pino = require('pino');
const axios = require('axios');
const QRCode = require('qrcode');
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
    console.log('🔍 Checking factory:', url);
    try {
      const { data } = await axios.get(url + '/status', { timeout: 10000 });
      console.log('   ✅ Response:', JSON.stringify(data));
      if (data.activeBots < data.maxBots) {
        console.log('   → Slot available!');
        return url;
      } else {
        console.log('   → Full');
      }
    } catch (e) {
      console.log('   ❌ Error:', e.message);
    }
  }
  console.log('❌ No available factory found');
  return null;
}

// ── PAIRING CODE ENDPOINT ─────────────────
app.get('/api/pair', async (req, res) => {
  let num = req.query.phone;
  if (!num) return res.status(400).json({ success: false, error: 'Missing phone number' });

  num = num.replace(/[^0-9]/g, '');
  const phoneObj = pn('+' + num);
  if (!phoneObj.isValid()) return res.status(400).json({ success: false, error: 'Invalid phone number' });
  num = phoneObj.getNumber('e164').replace('+', '');

  // ── Check factory capacity first ──
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
      defaultQueryTimeoutMs: 120000,
      connectTimeoutMs: 120000,
      keepAliveIntervalMs: 30000,
      retryRequestDelayMs: 250,
      maxRetries: 5,
    });

    // Wait for the socket to be ready (connecting or open)
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Connection timed out')), 120000);
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

    // ── Forward the session to the chosen factory once WhatsApp accepts the code ──
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

    // Keep the socket alive for 5 minutes in case the user is slow to link
    setTimeout(() => {
      try { sock.ws?.close(); removeDir(sessionDir); } catch (e) {}
    }, 300000);

    // Clean up if the socket disconnects before linking
    sock.ev.on('connection.update', (update) => {
      if (update.connection === 'close') {
        setTimeout(() => removeDir(sessionDir), 5000);
      }
    });

    sock.ev.on('creds.update', saveCreds);

  } catch (err) {
    console.error('Pairing error:', err);
    if (!res.headersSent) {
      res.status(500).json({ success: false, error: err.message || 'Internal error' });
    }
    removeDir(sessionDir);
  }
});

// ── QR CODE ENDPOINT ─────────────────────
app.get('/api/qr', async (req, res) => {
  const sessionDir = './qr_session_' + Date.now();

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
      defaultQueryTimeoutMs: 120000,
      connectTimeoutMs: 120000,
      keepAliveIntervalMs: 30000,
      retryRequestDelayMs: 250,
      maxRetries: 5,
    });

    // Wait for QR event
    const qrData = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('QR timeout')), 90000);
      sock.ev.on('connection.update', (update) => {
        const { qr } = update;
        if (qr) {
          clearTimeout(timer);
          resolve(qr);
        }
      });
    });

    // Convert QR string to data URL
    const qrImage = await QRCode.toDataURL(qrData, {
      errorCorrectionLevel: 'M',
      width: 512,
      margin: 2,
      color: { dark: '#000000', light: '#FFFFFF' },
    });

    res.json({
      success: true,
      qr: qrImage,
      instructions: [
        '1. Open WhatsApp on your phone',
        '2. Go to Settings > Linked Devices',
        '3. Tap "Link a Device"',
        '4. Scan the QR code above',
      ],
    });

    // Keep the socket alive for 60 seconds so the scan can complete
    setTimeout(() => {
      try { sock.ws?.close(); removeDir(sessionDir); } catch (e) {}
    }, 60000);

    // Forward session to factory if scanned successfully
    sock.ev.on('creds.update', async () => {
      try {
        await new Promise(r => setTimeout(r, 2000));
        const credsPath = sessionDir + '/creds.json';
        if (!fs.existsSync(credsPath)) return;

        const session = JSON.parse(fs.readFileSync(credsPath));
        const factoryUrl = await getAvailableFactory();
        if (factoryUrl) {
          await axios.post(factoryUrl + '/start-bot', {
            phone: 'qr_user',  // phone number unknown for QR, but factory will create
            session: session,
          });
          console.log('QR session forwarded to factory');
        }
        removeDir(sessionDir);
      } catch (err) {
        console.error('Failed to forward QR session:', err.message);
      }
    });

    sock.ev.on('connection.update', (update) => {
      if (update.connection === 'open') {
        // QR scan successful – session will be forwarded via creds.update
        setTimeout(() => {
          try { sock.ws?.close(); removeDir(sessionDir); } catch (e) {}
        }, 5000);
      } else if (update.connection === 'close') {
        setTimeout(() => removeDir(sessionDir), 5000);
      }
    });

    sock.ev.on('creds.update', saveCreds);
  } catch (err) {
    console.error('QR error:', err);
    if (!res.headersSent) {
      res.status(500).json({ success: false, error: err.message || 'QR generation failed' });
    }
    removeDir(sessionDir);
  }
});

// Health check
app.get('/', (req, res) => res.send('SABAODY Pairing API is running'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('Pairing API running on port ' + PORT));