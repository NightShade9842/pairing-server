const { makeWASocket, fetchLatestBaileysVersion, useMultiFileAuthState } = require('@whiskeysockets/baileys');

module.exports = async (req, res) => {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  const phone = (req.query.phone || '').replace(/[^0-9]/g, '');
  if (!phone) {
    return res.status(400).json({ error: 'Missing phone number' });
  }

  try {
    // Create a temporary auth state (in memory)
    const { state, saveCreds } = await useMultiFileAuthState('/tmp/auth_info');
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
      auth: state,
      version,
      printQRInTerminal: false,
    });

    // Request pairing code
    const code = await sock.requestPairingCode(phone);
    console.log(`Generated code for ${phone}: ${code}`);

    // Disconnect gracefully
    await sock.logout();
    await new Promise(resolve => setTimeout(resolve, 1000)); // let socket close

    return res.status(200).json({ code: code, phone: phone });
  } catch (err) {
    console.error('Error:', err.message);
    return res.status(500).json({ error: 'Failed to generate pairing code. Make sure the number is valid and not already registered.' });
  }
};