/**
 * Handler per i comandi utente
 */

const { Markup } = require('telegraf');
const User = require('../database/models/user');
const Transaction = require('../database/models/transaction');

/**
 * Mostra i comandi disponibili
 */
const showHelp = async (ctx) => {
  try {
    // Ottieni lo stato dell'utente
    const user = ctx.user;
    const isAdmin = user && user.isAdmin;
    
    let message = '📚 *Comandi disponibili*\n\n';
    
    // Comandi per tutti gli utenti
    message += '👤 *Comandi utente*\n';
    message += '/start - Avvia il bot / Registrazione\n';
    message += '/help - Mostra questo messaggio di aiuto\n';
    message += '/saldo - Visualizza il tuo saldo kWh attuale\n';
    message += '/cronologia - Visualizza la cronologia delle tue transazioni\n';
    message += '/registra_utilizzo - Registra un nuovo utilizzo di kWh\n';
    message += '/profilo - Visualizza il tuo profilo\n\n';
    
    // Comandi per amministratori
    if (isAdmin) {
      message += '👑 *Comandi amministratore*\n';
      message += '/admin_utenti - Visualizza la lista degli utenti\n';
      message += '/admin_ricarica - Effettua una ricarica per un utente\n';
      message += '/admin_crea_invito - Crea un nuovo codice di invito\n';
      message += '/admin_inviti - Visualizza la lista dei codici di invito\n';
      message += '/admin_stats - Visualizza le statistiche del bot\n';
    }
    
    return ctx.reply(message, { 
      parse_mode: 'Markdown'
    });
  } catch (error) {
    console.error('Errore durante la visualizzazione dell\'aiuto:', error);
    return ctx.reply('Si è verificato un errore. Per favore, riprova più tardi.');
  }
};

/**
 * Mostra il profilo dell'utente
 */
const showProfile = async (ctx) => {
  try {
    const user = ctx.user;
    
    // Ottieni le statistiche dell'utente
    const totalCharges = await Transaction.countDocuments({ 
      userId: user._id, 
      type: 'charge',
      status: 'approved'
    });
    
    const totalUsages = await Transaction.countDocuments({ 
      userId: user._id, 
      type: 'usage',
      status: 'approved'
    });
    
    const totalKwhCharged = await Transaction.aggregate([
      { 
        $match: { 
          userId: user._id,
          type: 'charge',
          status: 'approved'
        } 
      },
      { $group: { _id: null, total: { $sum: '$amount' } } }
    ]);
    
    const totalKwhUsed = await Transaction.aggregate([
      { 
        $match: { 
          userId: user._id,
          type: 'usage',
          status: 'approved'
        } 
      },
      { $group: { _id: null, total: { $sum: '$amount' } } }
    ]);
    
    // Formatta il profilo
    let message = '👤 *Il tuo profilo*\n\n';
    
    message += `👤 Nome: ${user.firstName} ${user.lastName}\n`;
    message += `💳 Tessera ID: ${user.cardId}\n`;
    message += `💰 Saldo attuale: ${user.balance.toFixed(2)} kWh\n`;
    message += `📊 Stato: ${user.status === 'active' ? '✅ Attivo' : '⏳ In attesa'}\n`;
    message += `📅 Registrato il: ${new Date(user.createdAt).toLocaleDateString('it-IT')}\n\n`;
    
    message += '📊 *Statistiche*\n';
    message += `🔋 Ricariche totali: ${totalCharges}\n`;
    message += `⚡ Utilizzi totali: ${totalUsages}\n`;
    message += `🔋 kWh totali caricati: ${totalKwhCharged.length > 0 ? totalKwhCharged[0].total.toFixed(2) : 0}\n`;
    message += `⚡ kWh totali utilizzati: ${totalKwhUsed.length > 0 ? totalKwhUsed[0].total.toFixed(2) : 0}\n`;
    
    return ctx.reply(message, { 
      parse_mode: 'Markdown'
    });
  } catch (error) {
    console.error('Errore durante la visualizzazione del profilo:', error);
    return ctx.reply('Si è verificato un errore. Per favore, riprova più tardi.');
  }
};

module.exports = {
  showHelp,
  showProfile
};
