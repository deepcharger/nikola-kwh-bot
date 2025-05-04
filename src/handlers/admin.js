/**
 * Handler per le funzionalità di amministrazione
 */

const { Markup } = require('telegraf');
const User = require('../database/models/user');
const Transaction = require('../database/models/transaction');
const Invite = require('../database/models/invite');
const config = require('../config/config');

// Stato per la creazione delle ricariche
const rechargeState = {};

// Stato per la creazione dei codici di invito
const inviteCodeState = {};

/**
 * Ottiene la lista degli utenti
 */
const getUsers = async (ctx) => {
  try {
    // Ottieni tutti gli utenti dal database
    const users = await User.find().sort({ createdAt: -1 });
    
    if (users.length === 0) {
      return ctx.reply('Non ci sono utenti registrati.');
    }
    
    // Formatta la lista degli utenti
    let message = '👥 *Lista degli utenti registrati*\n\n';
    
    for (const user of users) {
      const status = user.status === 'active' 
        ? '✅ Attivo' 
        : (user.status === 'pending' ? '⏳ In attesa' : '❌ Bloccato');
      
      message += `👤 *${user.firstName} ${user.lastName}*\n`;
      message += `🆔 ID Telegram: \`${user.telegramId}\`\n`;
      if (user.username) {
        message += `👤 Username: @${user.username}\n`;
      }
      message += `💳 Tessera ID: ${user.cardId || 'Non impostata'}\n`;
      message += `💰 Saldo: ${user.balance.toFixed(2)} kWh\n`;
      message += `📊 Stato: ${status}\n`;
      message += `📅 Registrato il: ${new Date(user.createdAt).toLocaleDateString('it-IT')}\n\n`;
    }
    
    return ctx.reply(message, { 
      parse_mode: 'Markdown',
      disable_web_page_preview: true
    });
  } catch (error) {
    console.error('Errore durante la richiesta della lista utenti:', error);
    return ctx.reply('Si è verificato un errore. Per favore, riprova più tardi.');
  }
};

/**
 * Avvia il processo di creazione di una ricarica
 */
const startRecharge = async (ctx) => {
  try {
    const telegramId = ctx.from.id;
    
    // Ottieni tutti gli utenti attivi
    const users = await User.find({ status: 'active' }).sort({ firstName: 1 });
    
    if (users.length === 0) {
      return ctx.reply('Non ci sono utenti attivi a cui applicare una ricarica.');
    }
    
    // Crea la tastiera con gli utenti
    const keyboard = [];
    
    for (const user of users) {
      keyboard.push([`${user.firstName} ${user.lastName} - ${user.cardId}`]);
    }
    
    keyboard.push(['❌ Annulla']);
    
    // Inizializza lo stato di ricarica
    rechargeState[telegramId] = { step: 'waitingForUser' };
    
    return ctx.reply(
      '🔋 *Nuova ricarica*\n\n' +
      'Seleziona l\'utente a cui applicare la ricarica:',
      {
        parse_mode: 'Markdown',
        ...Markup.keyboard(keyboard).oneTime().resize()
      }
    );
  } catch (error) {
    console.error('Errore durante l\'avvio della ricarica:', error);
    return ctx.reply('Si è verificato un errore. Per favore, riprova più tardi.');
  }
};

/**
 * Gestisce l'input durante la creazione di una ricarica
 */
const handleRechargeInput = async (ctx) => {
  try {
    const telegramId = ctx.from.id;
    const input = ctx.message.text;
    
    // Controlla se l'amministratore è in processo di creazione di una ricarica
    if (!rechargeState[telegramId]) {
      return;
    }
    
    const state = rechargeState[telegramId];
    
    // Gestione dell'annullamento
    if (input === '❌ Annulla') {
      delete rechargeState[telegramId];
      return ctx.reply(
        '❌ Operazione annullata.',
        Markup.removeKeyboard()
      );
    }
    
    // Gestione della selezione dell'utente
    if (state.step === 'waitingForUser') {
      // Estrae l'ID della tessera dalla selezione
      const cardId = input.split(' - ')[1];
      
      // Verifica che l'utente esista
      const user = await User.findOne({ cardId });
      
      if (!user) {
        return ctx.reply('⚠️ Utente non trovato. Per favore, seleziona un utente dalla lista:');
      }
      
      // Salva l'utente selezionato e passa alla fase successiva
      state.user = user;
      state.step = 'waitingForAmount';
      
      return ctx.reply(
        `✅ Utente selezionato: ${user.firstName} ${user.lastName}\n` +
        `💳 Tessera ID: ${user.cardId}\n` +
        `💰 Saldo attuale: ${user.balance.toFixed(2)} kWh\n\n` +
        'Per favore, inserisci la quantità di kWh da ricaricare:',
        Markup.keyboard([['❌ Annulla']])
          .oneTime()
          .resize()
      );
    }
    
    // Gestione dell'input della quantità
    if (state.step === 'waitingForAmount') {
      // Verifica che l'input sia un numero valido
      const amount = parseFloat(input);
      
      if (isNaN(amount) || amount <= 0) {
        return ctx.reply('⚠️ Inserisci un valore numerico positivo valido:');
      }
      
      // Salva l'importo e passa alla fase successiva
      state.amount = amount;
      state.step = 'waitingForConfirmation';
      
      return ctx.reply(
        '🔍 *Riepilogo ricarica*\n\n' +
        `👤 Utente: ${state.user.firstName} ${state.user.lastName}\n` +
        `💳 Tessera ID: ${state.user.cardId}\n` +
        `⚡ Quantità: ${amount} kWh\n` +
        `💰 Saldo attuale: ${state.user.balance.toFixed(2)} kWh\n` +
        `💰 Nuovo saldo: ${(state.user.balance + amount).toFixed(2)} kWh\n\n` +
        'Confermi questa ricarica?',
        {
          parse_mode: 'Markdown',
          ...Markup.keyboard([['✅ Conferma', '❌ Annulla']])
            .oneTime()
            .resize()
        }
      );
    }
    
    // Gestione della conferma
    if (state.step === 'waitingForConfirmation') {
      if (input !== '✅ Conferma') {
        return ctx.reply('Per favore, conferma o annulla la ricarica:');
      }
      
      // Aggiorna il saldo dell'utente
      const user = state.user;
      const oldBalance = user.balance;
      const newBalance = oldBalance + state.amount;
      
      user.balance = newBalance;
      await user.save();
      
      // Crea la transazione
      const transaction = new Transaction({
        userId: user._id,
        cardId: user.cardId,
        type: 'charge',
        amount: state.amount,
        previousBalance: oldBalance,
        newBalance,
        status: 'approved',
        processedBy: ctx.user._id,
        notes: 'Ricarica manuale da amministratore'
      });
      
      await transaction.save();
      
      // Notifica l'utente
      try {
        await ctx.telegram.sendMessage(
          user.telegramId,
          '🎉 *Ricarica effettuata!*\n\n' +
          `⚡ Quantità: ${state.amount} kWh\n` +
          `💰 Nuovo saldo: ${newBalance.toFixed(2)} kWh\n\n` +
          'Grazie per aver utilizzato il nostro servizio!',
          { parse_mode: 'Markdown' }
        );
      } catch (error) {
        console.error('Errore nell\'invio della notifica all\'utente:', error);
      }
      
      // Cancella lo stato di ricarica
      delete rechargeState[telegramId];
      
      // Conferma all'amministratore
      return ctx.reply(
        '✅ Ricarica completata con successo!\n\n' +
        `👤 Utente: ${user.firstName} ${user.lastName}\n` +
        `💳 Tessera ID: ${user.cardId}\n` +
        `⚡ Quantità: ${state.amount} kWh\n` +
        `💰 Nuovo saldo: ${newBalance.toFixed(2)} kWh`,
        Markup.removeKeyboard()
      );
    }
  } catch (error) {
    console.error('Errore durante la gestione dell\'input di ricarica:', error);
    return ctx.reply(
      'Si è verificato un errore. Per favore, riprova più tardi.',
      Markup.removeKeyboard()
    );
  }
};

/**
 * Avvia il processo di creazione di un codice di invito
 */
const startInviteCodeCreation = async (ctx) => {
  try {
    const telegramId = ctx.from.id;
    
    // Inizializza lo stato di creazione del codice di invito
    inviteCodeState[telegramId] = { step: 'waitingForCode' };
    
    // Genera un codice casuale
    const randomCode = Math.random().toString(36).substring(2, 8).toUpperCase();
    
    return ctx.reply(
      '🔑 *Creazione di un nuovo codice di invito*\n\n' +
      'Inserisci il codice di invito che desideri creare, oppure usa il codice generato automaticamente:\n\n' +
      `Codice suggerito: \`${randomCode}\`\n\n` +
      'Per utilizzare il codice suggerito, scrivi "OK".',
      {
        parse_mode: 'Markdown',
        ...Markup.keyboard([['OK'], ['❌ Annulla']])
          .oneTime()
          .resize()
      }
    );
  } catch (error) {
    console.error('Errore durante l\'avvio della creazione del codice di invito:', error);
    return ctx.reply('Si è verificato un errore. Per favore, riprova più tardi.');
  }
};

/**
 * Gestisce l'input durante la creazione di un codice di invito
 */
const handleInviteCodeInput = async (ctx) => {
  try {
    const telegramId = ctx.from.id;
    const input = ctx.message.text;
    
    // Controlla se l'amministratore è in processo di creazione di un codice di invito
    if (!inviteCodeState[telegramId]) {
      return;
    }
    
    const state = inviteCodeState[telegramId];
    
    // Gestione dell'annullamento
    if (input === '❌ Annulla') {
      delete inviteCodeState[telegramId];
      return ctx.reply(
        '❌ Operazione annullata.',
        Markup.removeKeyboard()
      );
    }
    
    // Gestione della selezione del codice
    if (state.step === 'waitingForCode') {
      let code;
      
      if (input === 'OK') {
        // Genera un codice casuale
        code = Math.random().toString(36).substring(2, 8).toUpperCase();
      } else {
        // Usa il codice inserito dall'utente
        code = input.trim();
      }
      
      // Verifica che il codice non esista già
      const existingCode = await Invite.findOne({ code });
      
      if (existingCode) {
        return ctx.reply('⚠️ Questo codice esiste già. Per favore, inserisci un codice diverso:');
      }
      
      // Salva il codice e passa alla fase successiva
      state.code = code;
      state.step = 'waitingForNotes';
      
      return ctx.reply(
        `✅ Codice di invito: ${code}\n\n` +
        'Se lo desideri, puoi aggiungere una nota (opzionale). Altrimenti, invia "Nessuna nota".',
        Markup.keyboard([['Nessuna nota'], ['❌ Annulla']])
          .oneTime()
          .resize()
      );
    }
    
    // Gestione delle note opzionali
    if (state.step === 'waitingForNotes') {
      // Salva le note
      state.notes = input === 'Nessuna nota' ? '' : input;
      
      // Crea il codice di invito
      const invite = new Invite({
        code: state.code,
        createdBy: ctx.user._id,
        notes: state.notes
      });
      
      await invite.save();
      
      // Cancella lo stato di creazione del codice di invito
      delete inviteCodeState[telegramId];
      
      // Conferma all'amministratore
      return ctx.reply(
        '✅ Codice di invito creato con successo!\n\n' +
        `🔑 Codice: ${invite.code}\n` +
        `📅 Scadenza: ${new Date(invite.expiresAt).toLocaleDateString('it-IT')}\n` +
        (invite.notes ? `📝 Note: ${invite.notes}\n` : ''),
        Markup.removeKeyboard()
      );
    }
  } catch (error) {
    console.error('Errore durante la gestione dell\'input del codice di invito:', error);
    return ctx.reply(
      'Si è verificato un errore. Per favore, riprova più tardi.',
      Markup.removeKeyboard()
    );
  }
};

/**
 * Ottiene la lista dei codici di invito
 */
const getInviteCodes = async (ctx) => {
  try {
    // Ottieni tutti i codici di invito dal database
    const invites = await Invite.find().sort({ createdAt: -1 });
    
    if (invites.length === 0) {
      return ctx.reply('Non ci sono codici di invito.');
    }
    
    // Formatta la lista dei codici di invito
    let message = '🔑 *Lista dei codici di invito*\n\n';
    
    for (const invite of invites) {
      const status = invite.isUsed 
        ? '✅ Utilizzato' 
        : (invite.isActive ? '⏳ Attivo' : '❌ Disattivato');
      
      const isExpired = new Date() > invite.expiresAt;
      const expiryStatus = isExpired ? '⏰ Scaduto' : '⏱️ Valido';
      
      message += `🔑 *Codice: ${invite.code}*\n`;
      message += `📊 Stato: ${status}\n`;
      message += `📅 Validità: ${expiryStatus}\n`;
      message += `📅 Scadenza: ${new Date(invite.expiresAt).toLocaleDateString('it-IT')}\n`;
      
      if (invite.isUsed && invite.usedBy) {
        message += `👤 Utilizzato da: ${invite.usedBy}\n`;
        message += `📅 Data utilizzo: ${new Date(invite.usedAt).toLocaleDateString('it-IT')}\n`;
      }
      
      if (invite.notes) {
        message += `📝 Note: ${invite.notes}\n`;
      }
      
      message += '\n';
    }
    
    return ctx.reply(message, { 
      parse_mode: 'Markdown'
    });
  } catch (error) {
    console.error('Errore durante la richiesta della lista dei codici di invito:', error);
    return ctx.reply('Si è verificato un errore. Per favore, riprova più tardi.');
  }
};

/**
 * Ottiene le statistiche del bot
 */
const getStats = async (ctx) => {
  try {
    // Ottieni le statistiche dal database
    const totalUsers = await User.countDocuments();
    const activeUsers = await User.countDocuments({ status: 'active' });
    const pendingUsers = await User.countDocuments({ status: 'pending' });
    const blockedUsers = await User.countDocuments({ status: 'blocked' });
    
    const totalTransactions = await Transaction.countDocuments();
    const chargeTransactions = await Transaction.countDocuments({ type: 'charge' });
    const usageTransactions = await Transaction.countDocuments({ type: 'usage' });
    
    const totalKwhCharged = await Transaction.aggregate([
      { $match: { type: 'charge', status: 'approved' } },
      { $group: { _id: null, total: { $sum: '$amount' } } }
    ]);
    
    const totalKwhUsed = await Transaction.aggregate([
      { $match: { type: 'usage', status: 'approved' } },
      { $group: { _id: null, total: { $sum: '$amount' } } }
    ]);
    
    const totalKwhBalance = await User.aggregate([
      { $group: { _id: null, total: { $sum: '$balance' } } }
    ]);
    
    // Formatta le statistiche
    let message = '📊 *Statistiche del bot*\n\n';
    
    message += '👥 *Utenti*\n';
    message += `📌 Totale: ${totalUsers}\n`;
    message += `✅ Attivi: ${activeUsers}\n`;
    message += `⏳ In attesa: ${pendingUsers}\n`;
    message += `❌ Bloccati: ${blockedUsers}\n\n`;
    
    message += '🔄 *Transazioni*\n';
    message += `📌 Totale: ${totalTransactions}\n`;
    message += `🔋 Ricariche: ${chargeTransactions}\n`;
    message += `⚡ Utilizzi: ${usageTransactions}\n\n`;
    
    message += '⚡ *Energia*\n';
    message += `🔋 Totale caricato: ${totalKwhCharged.length > 0 ? totalKwhCharged[0].total.toFixed(2) : 0} kWh\n`;
    message += `⚡ Totale utilizzato: ${totalKwhUsed.length > 0 ? totalKwhUsed[0].total.toFixed(2) : 0} kWh\n`;
    message += `💰 Saldo totale: ${totalKwhBalance.length > 0 ? totalKwhBalance[0].total.toFixed(2) : 0} kWh\n`;
    
    return ctx.reply(message, { 
      parse_mode: 'Markdown'
    });
  } catch (error) {
    console.error('Errore durante la richiesta delle statistiche:', error);
    return ctx.reply('Si è verificato un errore. Per favore, riprova più tardi.');
  }
};

module.exports = {
  getUsers,
  startRecharge,
  handleRechargeInput,
  startInviteCodeCreation,
  handleInviteCodeInput,
  getInviteCodes,
  getStats,
  rechargeState,
  inviteCodeState
};
