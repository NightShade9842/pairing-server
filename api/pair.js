// api/pair.js
const { makeWASocket, fetchLatestBaileysVersion, useMultiFileAuthState } = require('@whiskeysockets/baileys');

module.exports = async (req, res) => {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');

  try {
    const phone = (req.query.phone || '').replace(/[^0-9]/g, '');
    if (!phone) {
      return res.status(400).json({ success: false, error: 'Missing phone number. Usage: /api/pair?phone=233...' });
    }

    // Unique temporary auth folder to avoid clashes
    const authFolder = '/tmp/auth_info_' + Date.now();
    const { state } = await useMultiFileAuthState(authFolder);
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
      auth: state,
      version,
      printQRInTerminal: false,
      browser: ['SABAODY Pairing', 'Chrome', '1.0.0'],
    });

    // Wait until the socket is at least in "connecting" or "open" state
    // This is necessary before requesting a pairing code.
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Timeout waiting for WhatsApp connection')), 20000);
      sock.ev.on('connection.update', (update) => {
        const { connection } = update;
        console.log('Baileys connection state:', connection);
        // Both "connecting" and "open" allow pairing code request
        if (connection === 'connecting' || connection === 'open') {
          clearTimeout(timer);
          resolve();
        }
      });
    });

    const code = await sock.requestPairingCode(phone);
    console.log('Pairing code generated:', code);

    // Clean disconnect
    sock.ws?.close();

    return res.status(200).json({ success: true, phone, code });
  } catch (err) {
    console.error('Pairing error:', err.message);
    return res.status(500).json({ success: false, error: err.message || 'Internal server error' });
  }
};