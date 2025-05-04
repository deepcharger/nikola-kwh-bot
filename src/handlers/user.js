/**
 * Handler per le funzionalità utente
 */

const { Markup } = require('telegraf');
const User = require('../database/models/user');
const Transaction = require('../database/models/transaction');

/**
 * Mostra il messaggio di aiuto con i comandi disponibili
 */
const showHelp = async (ctx) => {
  try {
    // Ottieni l'utente dal database
    const user = ctx.user;
    
    let message = '🔋 *Nikola kWh Manager - Aiuto*\n\n';
    
    // Comandi per tutti gli utenti
    message += '*Comandi disponibili:*\n\n';
    message += '💰 */saldo* - Visualizza il tuo saldo kWh attuale\n';
    message += '📊 */cronologia* - Visualizza lo storico delle transazioni\n';
    message += '⚡ */registra_utilizzo* - Registra un nuovo utilizzo di energia\n';
    message += '👤 */profilo* - Visualizza il tuo profilo\n';
    message += '❓ */help* - Mostra questo messaggio di aiuto\n\n';
    
    // Comandi per amministratori
    if (user.isAdmin) {
      message += '*Comandi amministratore:*\n\n';
      message += '👥 */admin_utenti* - Visualizza la lista degli utenti\n';
      message += '🔍 */admin_trova_tessera [numero_tessera]* - Cerca un utente per numero tessera\n';
      message += '🔍 */admin_trova_utente [nome o @username]* - Cerca un utente per nome o username\n';
      message += '👤 */admin_dettaglio [ID_Telegram]* - Visualizza i dettagli di un utente\n';
      message += '📊 */admin_stats* - Visualizza le statistiche del bot\n';
      message += '🔋 */admin_ricarica* - Ricarica il saldo di un utente\n';
      message += '🔑 */admin_crea_invito* - Crea un nuovo codice di invito\n';
      message += '🔑 */admin_inviti* - Visualizza i codici di invito\n';
      message += '📄 */admin_esporta_utenti* - Esporta tutti gli utenti in formato CSV\n';
      message += '✅ */admin_approva [ID_Telegram]* - Approva un utente in attesa\n';
      message += '❌ */admin_blocca [ID_Telegram]* - Blocca un utente\n';
      message += '✅ */admin_sblocca [ID_Telegram]* - Sblocca un utente bloccato\n';
      message += '🚫 */admin_disabilita [ID_Telegram]* - Disabilita un utente (non visibile nelle liste normali)\n';
      message += '🗑️ */admin_elimina [ID_Telegram]* - Elimina definitivamente un utente\n';
    }
    
    return ctx.reply(message, { parse_mode: 'Markdown' });
  } catch (error) {
    console.error('Errore durante la visualizzazione del comando di aiuto:', error);
    return ctx.reply('Si è verificato un errore. Per favore, riprova più tardi.');
  }
};

/**
 * Mostra il profilo dell'utente
 */
const showProfile = async (ctx) => {
  try {
    // Ottieni l'utente dal database
    const user = ctx.user;
    
    // Formatta lo stato
    let status = '';
    if (user.status === 'active') {
      status = '✅ Attivo';
    } else if (user.status === 'pending') {
      status = '⏳ In attesa';
    } else if (user.status === 'blocked') {
      status = '❌ Bloccato';
    } else if (user.status === 'disabled') {
      status = '🚫 Disabilitato';
    }
    
    // Formatta il messaggio del profilo
    let message = '👤 *Profilo Utente*\n\n';
    message += `*Nome*: ${user.firstName} ${user.lastName}\n`;
    message += `*Username*: ${user.username ? '@' + user.username : 'Non impostato'}\n`;
    message += `*ID Telegram*: \`${user.telegramId}\`\n`;
    message += `*Tessera ID*: ${user.cardId || 'Non impostata'}\n`;
    message += `*Saldo*: ${user.balance.toFixed(2)} kWh\n`;
    message += `*Stato*: ${status}\n`;
    message += `*Admin*: ${user.isAdmin ? '✅ Sì' : '❌ No'}\n`;
    message += `*Registrato il*: ${new Date(user.createdAt).toLocaleDateString('it-IT')}\n`;
    
    return ctx.reply(message, { parse_mode: 'Markdown' });
  } catch (error) {
    console.error('Errore durante la visualizzazione del profilo:', error);
    return ctx.reply('Si è verificato un errore. Per favore, riprova più tardi.');
  }
};

module.exports = {
  showHelp,
  showProfile
};
