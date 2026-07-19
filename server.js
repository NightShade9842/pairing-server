const express = require('express');
const cors = require('cors');
const { makeWASocket, fetchLatestBaileysVersion, useMultiFileAuthState } = require('@whiskeysockets/baileys');

const app = express();
app.use(cors());

app.get('/api/pair', async (req, res) => {
  try {
    const phone = (req.query.phone || '').replace(/[^0-9]/g, '');
    if (!phone) return res.status(400).json({ success: false, error: 'Missing phone number' });

    const authFolder = '/tmp/auth_info_' + Date.now();
    const { state } = await useMultiFileAuthState(authFolder);
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
      auth: state,
      version,
      printQRInTerminal: false,
      browser: ['SABAODY Pairing', 'Chrome', '1.0.0'],
    });

    // Wait until socket is ready (connecting or open)
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Timeout')), 30000);
      sock.ev.on('connection.update', (update) => {
        if (update.connection === 'connecting' || update.connection === 'open') {
          clearTimeout(timer);
          resolve();
        }
      });
    });

    const code = await sock.requestPairingCode(phone);
    sock.ws?.close();

    return res.json({ success: true, phone, code });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('Pairing API running on port ' + PORT));