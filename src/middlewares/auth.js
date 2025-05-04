/**
 * Middleware per l'autenticazione degli utenti
 */

const User = require('../database/models/user');

/**
 * Middleware per controllare se l'utente è registrato
 */
const isRegistered = async (ctx, next) => {
  try {
    // Ottieni l'ID Telegram dell'utente
    const telegramId = ctx.from.id;
    
    // Cerca l'utente nel database
    const user = await User.findOne({ telegramId });
    
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
    
    // Aggiorna lastSeen dell'utente
    await User.findByIdAndUpdate(user._id, { lastSeen: new Date() });
    
    // Aggiungi l'utente al contesto
    ctx.user = user;
    
    // Passa al middleware successivo
    return next();
  } catch (error) {
    console.error('Errore nel middleware isRegistered:', error);
    return ctx.reply('Si è verificato un errore. Per favore, riprova più tardi.');
  }
};

/**
 * Middleware per controllare se l'utente è un amministratore
 */
const isAdmin = async (ctx, next) => {
  try {
    // Ottieni l'ID Telegram dell'utente
    const telegramId = ctx.from.id;
    
    // Cerca l'utente nel database
    const user = await User.findOne({ telegramId });
    
    // Se l'utente non esiste o non è un amministratore, invia un messaggio di errore
    if (!user || !user.isAdmin) {
      return ctx.reply('⛔ Accesso negato. Solo gli amministratori possono utilizzare questo comando.');
    }
    
    // Aggiorna lastSeen dell'utente
    await User.findByIdAndUpdate(user._id, { lastSeen: new Date() });
    
    // Aggiungi l'utente al contesto
    ctx.user = user;
    
    // Passa al middleware successivo
    return next();
  } catch (error) {
    console.error('Errore nel middleware isAdmin:', error);
    return ctx.reply('Si è verificato un errore. Per favore, riprova più tardi.');
  }
};

module.exports = {
  isRegistered,
  isAdmin
};
