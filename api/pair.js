const { makeWASocket, fetchLatestBaileysVersion, useMultiFileAuthState } = require('@whiskeysockets/baileys');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const phone = (req.query.phone || '').replace(/[^0-9]/g, '');
  if (!phone) {
    return res.status(400).json({ error: 'Missing phone number. Usage: /api/pair?phone=233...' });
  }

  try {
    const { state } = await useMultiFileAuthState('/tmp/auth_info');
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
      auth: state,
      version,
      printQRInTerminal: false,
    });

    const code = await sock.requestPairingCode(phone);
    // Disconnect after getting the code
    sock.logout().catch(() => {});
    setTimeout(() => sock.ws?.close?.(), 1000);

    return res.status(200).json({ success: true, phone, code });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message || 'Could not generate code.' });
  }
};