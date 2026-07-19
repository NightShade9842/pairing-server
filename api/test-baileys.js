const { makeWASocket } = require('@whiskeysockets/baileys');
module.exports = (req, res) => {
  res.status(200).json({ baileys: typeof makeWASocket });
};