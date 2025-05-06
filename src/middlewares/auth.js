/**
 * Middleware per l'autenticazione degli utenti
 */

const User = require('../database/models/user');
const { sanitizeNumericId, generateErrorCode } = require('../utils/sanitize');

/**
 * Middleware per controllare se l'utente è registrato
 */
const isRegistered = async (ctx, next) => {
  try {
    // Ottieni l'ID Telegram dell'utente
    const telegramId = sanitizeNumericId(ctx.from.id);
    
    if (!telegramId) {
      return ctx.reply('⚠️ Impossibile identificare l\'utente Telegram. Riprova più tardi.');
    }
    
    // Cerca l'utente nel database
    let user;
    try {
      user = await User.findOne({ telegramId });
    } catch (dbError) {
      const errorCode = generateErrorCode();
      console.error(`Errore [${errorCode}] database in isRegistered:`, dbError);
      return ctx.reply(`⚠️ Errore di connessione al database (codice: ${errorCode}). Riprova più tardi.`);
    }
    
    // Se l'utente non esiste, invia un messaggio di errore
    if (!user) {
      return ctx.reply(
        '⚠️ Non sei registrato. Per utilizzare questo bot, è necessario registrarsi.\n\n' +
        'Usa il comando /start per iniziare la registrazione.'
      );
    }
    
    // Se l'utente è bloccato, invia un messaggio di errore
    if (user.status === 'blocked') {
      return ctx.reply('⛔ Il tuo account è stato bloccato. Contatta l\'amministratore per maggiori informazioni.');
    }
    
    // Se l'utente è in attesa di approvazione, invia un messaggio di errore
    if (user.status === 'pending') {
      return ctx.reply('⏳ La tua registrazione è in attesa di approvazione da parte dell\'amministratore.');
    }
    
    // Se l'utente è disabilitato
    if (user.status === 'disabled') {
      return ctx.reply('🚫 Il tuo account è stato disabilitato. Contatta l\'amministratore per maggiori informazioni.');
    }
    
    // Aggiorna lastSeen dell'utente
    try {
      await User.findByIdAndUpdate(user._id, { lastSeen: new Date() });
    } catch (updateError) {
      // Log dell'errore ma continua comunque
      console.error('Errore nell\'aggiornamento di lastSeen:', updateError);
    }
    
    // Aggiungi l'utente al contesto
    ctx.user = user;
    
    // Passa al middleware successivo
    return next();
  } catch (error) {
    const errorCode = generateErrorCode();
    console.error(`Errore [${errorCode}] nel middleware isRegistered:`, error.stack || error.message || error);
    return ctx.reply(`Si è verificato un errore (codice: ${errorCode}). Per favore, riprova più tardi.`);
  }
};

/**
 * Middleware per controllare se l'utente è un amministratore
 */
const isAdmin = async (ctx, next) => {
  try {
    // Ottieni l'ID Telegram dell'utente
    const telegramId = sanitizeNumericId(ctx.from.id);
    
    if (!telegramId) {
      return ctx.reply('⚠️ Impossibile identificare l\'utente Telegram. Riprova più tardi.');
    }
    
    // Cerca l'utente nel database
    let user;
    try {
      user = await User.findOne({ telegramId });
    } catch (dbError) {
      const errorCode = generateErrorCode();
      console.error(`Errore [${errorCode}] database in isAdmin:`, dbError);
      return ctx.reply(`⚠️ Errore di connessione al database (codice: ${errorCode}). Riprova più tardi.`);
    }
    
    // Se l'utente non esiste o non è un amministratore, invia un messaggio di errore
    if (!user) {
      return ctx.reply('⚠️ Utente non trovato. Per favore, registrati prima con /start.');
    }
    
    if (!user.isAdmin) {
      return ctx.reply('⛔ Accesso negato. Solo gli amministratori possono utilizzare questo comando.');
    }
    
    // Aggiorna lastSeen dell'utente
    try {
      await User.findByIdAndUpdate(user._id, { lastSeen: new Date() });
    } catch (updateError) {
      // Log dell'errore ma continua comunque
      console.error('Errore nell\'aggiornamento di lastSeen:', updateError);
    }
    
    // Aggiungi l'utente al contesto
    ctx.user = user;
    
    // Passa al middleware successivo
    return next();
  } catch (error) {
    const errorCode = generateErrorCode();
    console.error(`Errore [${errorCode}] nel middleware isAdmin:`, error.stack || error.message || error);
    return ctx.reply(`Si è verificato un errore (codice: ${errorCode}). Per favore, riprova più tardi.`);
  }
};

module.exports = {
  isRegistered,
  isAdmin
};
