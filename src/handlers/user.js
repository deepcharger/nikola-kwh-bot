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
    
    let message = '📚 Comandi disponibili\n\n';
    
    // Comandi per tutti gli utenti
    message += '👤 Comandi utente\n';
    message += '`/start` - Avvia il bot / Registrazione\n';
    message += '`/help` - Mostra questo messaggio di aiuto\n';
    message += '`/saldo` - Visualizza il tuo saldo kWh attuale\n';
    message += '`/cronologia` - Visualizza la cronologia delle tue transazioni\n';
    message += '`/registra_utilizzo` - Registra un nuovo utilizzo di kWh\n';
    message += '`/profilo` - Visualizza il tuo profilo\n\n';
    
    // Comandi per amministratori
    if (isAdmin) {
      message += '👑 Comandi amministratore\n';
      message += '`/admin_utenti` - Visualizza la lista degli utenti paginata\n';
      message += '`/admin_trova_tessera [numero]` - Cerca utente per tessera\n';
      message += '`/admin_trova_utente [nome o @username]` - Cerca utente\n';
      message += '`/admin_dettaglio [ID_Telegram]` - Mostra dettagli utente\n';
      message += '`/admin_approva [ID_Telegram]` - Approva un utente\n';
      message += '`/admin_blocca [ID_Telegram]` - Blocca un utente\n';
      message += '`/admin_sblocca [ID_Telegram]` - Sblocca un utente\n';
      message += '`/admin_disabilita [ID_Telegram]` - Disabilita un utente\n';
      message += '`/admin_elimina [ID_Telegram]` - Elimina definitivamente un utente\n';
      message += '`/admin_conferma_eliminazione [ID_Telegram]` - Conferma eliminazione\n';
      message += '`/admin_ricarica [ID_Telegram/@username/tessera:XX]` - Ricarica un utente\n';
      message += '`/admin_crea_invito` - Crea un nuovo codice di invito\n';
      message += '`/admin_inviti` - Visualizza la lista dei codici di invito\n';
      message += '`/admin_esporta_utenti` - Esporta lista utenti in CSV\n';
      message += '`/admin_stats` - Visualizza le statistiche del bot\n';
      message += '`/admin_make_admin [ID_Telegram]` - Promuovi un utente ad amministratore\n';
      message += '`/admin_aggiorna_comandi` - Aggiorna i comandi bot\n';
      message += '`/admin_saldi_bassi` - Trova utenti con saldo basso\n';
      message += '`/admin_ricariche` - Visualizza le ultime ricariche\n';
    }
    
    return ctx.reply(message, { parse_mode: 'Markdown' });
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
    let message = '👤 IL TUO PROFILO\n\n';
    
    message += `👤 Nome: ${user.firstName} ${user.lastName}\n`;
    message += `💳 Tessera ID: ${user.cardId}\n`;
    message += `💰 Saldo attuale: ${user.balance.toFixed(2)} kWh\n`;
    
    // Aggiunto lo stato "disabilitato"
    let statusText = '';
    if (user.status === 'active') {
      statusText = '✅ Attivo';
    } else if (user.status === 'pending') {
      statusText = '⏳ In attesa';
    } else if (user.status === 'blocked') {
      statusText = '❌ Bloccato';
    } else if (user.status === 'disabled') {
      statusText = '🚫 Disabilitato';
    }
    
    message += `📊 Stato: ${statusText}\n`;
    message += `📅 Registrato il: ${new Date(user.createdAt).toLocaleDateString('it-IT')}\n\n`;
    
    message += '📊 STATISTICHE\n';
    message += `🔋 Ricariche totali: ${totalCharges}\n`;
    message += `⚡ Utilizzi totali: ${totalUsages}\n`;
    message += `🔋 kWh totali caricati: ${totalKwhCharged.length > 0 ? totalKwhCharged[0].total.toFixed(2) : 0}\n`;
    message += `⚡ kWh totali utilizzati: ${totalKwhUsed.length > 0 ? totalKwhUsed[0].total.toFixed(2) : 0}\n`;
    
    return ctx.reply(message, { 
      parse_mode: '' // Nessuna formattazione
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
