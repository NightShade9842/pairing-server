// api/pair.js
const { makeWASocket, fetchLatestBaileysVersion, useMultiFileAuthState } = require('@whiskeysockets/baileys');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');

  try {
    const phone = (req.query.phone || '').replace(/[^0-9]/g, '');
    if (!phone) {
      return res.status(400).json({ success: false, error: 'Missing phone number. Usage: /api/pair?phone=233...' });
    }

    // Use a unique temporary auth folder for each request
    const authFolder = '/tmp/auth_info_' + Date.now();
    const { state } = await useMultiFileAuthState(authFolder);
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
      auth: state,
      version,
      printQRInTerminal: false,
      browser: ['SABAODY Pairing', 'Chrome', '1.0.0'],
    });

    // Request pairing code immediately (no need to wait for 'open')
    const code = await sock.requestPairingCode(phone);

    // Cleanly close the socket
    sock.ws?.close();

    return res.status(200).json({ success: true, phone, code });
  } catch (err) {
    console.error('Pairing error:', err);
    return res.status(500).json({ success: false, error: err.message || 'Internal error' });
  }
};