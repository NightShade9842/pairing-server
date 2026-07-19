// server.js
const express = require('express');
const cors = require('cors');
const { makeWASocket, fetchLatestBaileysVersion, useMultiFileAuthState } = require('@whiskeysockets/baileys');

const app = express();
app.use(cors());

// Store active temporary sockets with their cleanup timers
const activeSockets = new Map();

app.get('/api/pair', async (req, res) => {
  try {
    const phone = (req.query.phone || '').replace(/[^0-9]/g, '');
    if (!phone) {
      return res.status(400).json({ success: false, error: 'Missing phone number' });
    }

    const authFolder = '/tmp/auth_info_' + Date.now();
    const { state, saveCreds } = await useMultiFileAuthState(authFolder);
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
      auth: state,
      version,
      printQRInTerminal: false,
      browser: ['SABAODY Pairing', 'Chrome', '1.0.0'],
    });

    // Wait until the socket is ready
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Timeout waiting for connection')), 30000);
      sock.ev.on('connection.update', (update) => {
        const { connection } = update;
        if (connection === 'connecting' || connection === 'open') {
          clearTimeout(timer);
          resolve();
        }
      });
    });

    const code = await sock.requestPairingCode(phone);

    // Keep the socket alive for 60 seconds so WhatsApp accepts the code
    const socketId = Date.now().toString();
    activeSockets.set(socketId, sock);

    // Schedule cleanup
    setTimeout(() => {
      try {
        sock.ws?.close();
        activeSockets.delete(socketId);
      } catch (e) {}
    }, 60000);

    // Also listen for the socket closing on its own
    sock.ev.on('connection.update', (update) => {
      if (update.connection === 'close') {
        clearTimeout(/* we don't have a direct ref, but we can ignore */);
        activeSockets.delete(socketId);
      }
    });

    // Send the response immediately
    return res.json({ success: true, phone, code });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// Cleanup endpoint (optional) – call /api/cleanup to close all idle sockets
app.get('/api/cleanup', (req, res) => {
  activeSockets.forEach((sock, id) => {
    try { sock.ws?.close(); } catch (e) {}
  });
  activeSockets.clear();
  res.json({ cleaned: true });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('Pairing API running on port ' + PORT));