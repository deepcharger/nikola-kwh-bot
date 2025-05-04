/**
 * Configurazione del bot Nikola kWh Manager
 */

require('dotenv').config();

module.exports = {
  // Telegram Bot Token
  BOT_TOKEN: process.env.BOT_TOKEN,
  
  // ID della chat dell'amministratore
  ADMIN_CHAT_ID: process.env.ADMIN_CHAT_ID,
  
  // URI del database MongoDB
  MONGODB_URI: process.env.MONGODB_URI || 'mongodb://localhost:27017/nikola_kwh_manager',
  
  // Ambiente di esecuzione
  NODE_ENV: process.env.NODE_ENV || 'development',
  
  // Configurazione per il sistema di inviti
  INVITE_CODE_ENABLED: true,
  
  // Prefisso per comandi di amministratore
  ADMIN_COMMAND_PREFIX: '/admin_',
  
  // Tempo di scadenza del codice di invito (in giorni)
  INVITE_CODE_EXPIRY_DAYS: 7,
  
  // Flag per il debug
  DEBUG: process.env.NODE_ENV !== 'production'
};
