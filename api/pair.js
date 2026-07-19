// api/pair.js
const { makeWASocket, fetchLatestBaileysVersion, useMultiFileAuthState } = require('@whiskeysockets/baileys');

module.exports = async (req, res) => {
  // Allow requests from any origin
  res.setHeader('Access-Control-Allow-Origin', '*');

  try {
    const phone = (req.query.phone || '').replace(/[^0-9]/g, '');
    if (!phone) {
      return res.status(400).json({ success: false, error: 'Missing phone number. Usage: /api/pair?phone=233...' });
    }

    // Use a unique temporary folder so multiple requests don't clash
    const authFolder = '/tmp/auth_info_' + Date.now();
    const { state } = await useMultiFileAuthState(authFolder);
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
      auth: state,
      version,
      printQRInTerminal: false,
      browser: ['SABAODY Pairing', 'Chrome', '1.0.0'],
    });

    // Wait for the socket to open (or timeout after 15 seconds)
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Connection timed out')), 15000);
      sock.ev.on('connection.update', (update) => {
        if (update.connection === 'open') {
          clearTimeout(timer);
          resolve();
        }
      });
    });

    const code = await sock.requestPairingCode(phone);

    // Cleanly disconnect
    try { sock.logout(); } catch (e) {}
    setTimeout(() => sock.ws?.close(), 500);

    return res.status(200).json({ success: true, phone, code });
  } catch (err) {
    console.error('Pairing error:', err);
    return res.status(500).json({ success: false, error: err.message || 'Internal error' });
  }
};