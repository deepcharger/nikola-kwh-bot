/**
 * Gestione delle ricariche
 */

const { Markup } = require('telegraf');
const User = require('../../database/models/user');
const Transaction = require('../../database/models/transaction');
const { 
  sanitizeNumericId, 
  sanitizeString, 
  sanitizeAmount, 
  sanitizeCardId, 
  generateErrorCode 
} = require('../../utils/sanitize');
const { rechargeState } = require('./states');

/**
 * Avvia il processo di creazione di una ricarica
 */
const startRecharge = async (ctx) => {
  try {
    const telegramId = ctx.from.id;
    const args = ctx.message.text.split(' ');
    
    // Se non ci sono argomenti, mostra istruzioni su come usare il comando
    if (args.length === 1) {
        return ctx.reply(
          '🔋 RICARICA SALDO UTENTE\n\n' +
          'Per ricaricare il saldo di un utente, usa uno dei seguenti formati:\n\n' +
          '• `/admin_ricarica [ID_Telegram]` - Cerca per ID Telegram\n' +
          '• `/admin_ricarica @[username]` - Cerca per username Telegram\n' +
          '• `/admin_ricarica tessera:` - Cerca per numero tessera\n\n' +
          'Esempi copiabili:\n' +
          '`/admin_ricarica 12345678`\n' +
          '`/admin_ricarica @username`\n' +
          '`/admin_ricarica tessera:`',
          { parse_mode: 'Markdown' }
        );
    }
    
    // Estrai il parametro di ricerca
    const searchParam = sanitizeString(args.slice(1).join(' ').trim());
    let user;
    
    // Cerca l'utente in base al tipo di parametro
    if (searchParam.startsWith('@')) {
      // Cerca per username
      const username = searchParam.substring(1);
      user = await User.findOne({ username });
    } else if (searchParam.toLowerCase().startsWith('tessera:')) {
      // Cerca per numero tessera
      const cardId = sanitizeCardId(searchParam.substring(8).trim());
      if (!cardId) {
        return ctx.reply('⚠️ Formato tessera non valido. Per favore, inserisci un ID tessera valido.');
      }
      user = await User.findOne({ cardId });
    } else {
      // Cerca per ID Telegram
      const searchId = sanitizeNumericId(searchParam);
      if (!searchId) {
        return ctx.reply('⚠️ Parametro non valido. Usa un ID Telegram numerico, un @username o tessera:NUMERO.');
      }
      user = await User.findOne({ telegramId: searchId });
    }
    
    // Verifica se l'utente è stato trovato
    if (!user) {
      return ctx.reply('⚠️ Utente non trovato. Verifica il parametro di ricerca e riprova.');
    }
    
    // Verifica che l'utente sia attivo
    if (user.status !== 'active') {
      let statusText = '';
      if (user.status === 'pending') {
        statusText = 'in attesa di approvazione';
      } else if (user.status === 'blocked') {
        statusText = 'bloccato';
      } else if (user.status === 'disabled') {
        statusText = 'disabilitato';
      }
      
      return ctx.reply(`⚠️ Impossibile ricaricare questo utente perché è ${statusText}.`);
    }
    
    // Salva l'utente selezionato e passa alla fase successiva
    rechargeState[telegramId] = { 
      step: 'waitingForAmount',
      user: user,
      lastActivity: Date.now()
    };
    
    return ctx.reply(
      `✅ Utente selezionato: ${user.firstName} ${user.lastName}\n` +
      `💳 Tessera ID: ${user.cardId || 'Non impostata'}\n` +
      `💰 Saldo attuale: ${user.balance.toFixed(2)} kWh\n\n` +
      'Per favore, inserisci la quantità di kWh da ricaricare:',
      Markup.keyboard([['❌ Annulla']])
        .oneTime()
        .resize()
    );
  } catch (error) {
    const errorCode = generateErrorCode();
    console.error(`Errore [${errorCode}] durante l'avvio della ricarica:`, error);
    return ctx.reply(`Si è verificato un errore (codice: ${errorCode}). Per favore, riprova più tardi.`);
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
    // Aggiorna il timestamp di attività
    state.lastActivity = Date.now();
    
    // Gestione dell'annullamento
    if (input === '❌ Annulla') {
      delete rechargeState[telegramId];
      return ctx.reply(
        '❌ Operazione annullata.',
        Markup.removeKeyboard()
      );
    }
    
    // Gestione dell'input della quantità
    if (state.step === 'waitingForAmount') {
      // Verifica che l'input sia un numero valido
      const amount = sanitizeAmount(input, 10000); // Massimo 10000 kWh
      
      if (!amount) {
        return ctx.reply('⚠️ Inserisci un valore numerico positivo valido (massimo 10000 kWh):');
      }
      
      // Salva l'importo e passa alla fase successiva
      state.amount = amount;
      state.step = 'waitingForConfirmation';
      
      // Usa pulsanti inline invece della tastiera per la conferma
      return ctx.reply(
        '🔍 Riepilogo ricarica\n\n' +
        `👤 Utente: ${state.user.firstName} ${state.user.lastName}\n` +
        `💳 Tessera ID: ${state.user.cardId || 'Non impostata'}\n` +
        `⚡ Quantità: ${amount} kWh\n` +
        `💰 Saldo attuale: ${state.user.balance.toFixed(2)} kWh\n` +
        `💰 Nuovo saldo: ${(state.user.balance + amount).toFixed(2)} kWh\n\n` +
        'Confermi questa ricarica?',
        {
          parse_mode: '',  // Nessuna formattazione
          reply_markup: {
            inline_keyboard: [
              [
                { text: '✅ Conferma', callback_data: `confirm_recharge_${telegramId}` },
                { text: '❌ Annulla', callback_data: `cancel_recharge_${telegramId}` }
              ]
            ],
            remove_keyboard: true
          }
        }
      );
    }
  } catch (error) {
    const errorCode = generateErrorCode();
    console.error(`Errore [${errorCode}] durante la gestione dell'input di ricarica:`, error);
    return ctx.reply(
      `Si è verificato un errore (codice: ${errorCode}). Per favore, riprova più tardi.`,
      Markup.removeKeyboard()
    );
  }
};

/**
 * Gestisce la conferma di una ricarica tramite bottone inline
 */
const confirmRecharge = async (ctx) => {
  try {
    // Estrai l'ID Telegram dal callback data
    const callbackData = ctx.callbackQuery.data;
    const telegramId = sanitizeNumericId(callbackData.split('_')[2]);
    
    if (!telegramId) {
      return await ctx.answerCbQuery('ID utente non valido.');
    }
    
    // Verifica che esista un processo di ricarica per questo utente
    if (!rechargeState[telegramId] || rechargeState[telegramId].step !== 'waitingForConfirmation') {
      return await ctx.answerCbQuery('Nessuna ricarica in attesa di conferma.');
    }
    
    const state = rechargeState[telegramId];
    
    // Aggiorna il saldo dell'utente
    const user = state.user;
    const oldBalance = user.balance;
    const newBalance = oldBalance + state.amount;
    
    user.balance = newBalance;
    await user.save();
    
    // Ottieni l'utente admin che sta effettuando la ricarica
    const adminUser = await User.findOne({ telegramId: ctx.from.id });
    
    // Crea la transazione
    const transaction = new Transaction({
      userId: user._id,
      cardId: user.cardId,
      type: 'charge',
      amount: state.amount,
      previousBalance: oldBalance,
      newBalance,
      status: 'approved',
      processedBy: adminUser ? adminUser._id : null,
      notes: 'Ricarica manuale da amministratore'
    });
    
    await transaction.save();
    
    // Notifica l'utente
    try {
      await ctx.telegram.sendMessage(
        user.telegramId,
        '🎉 Ricarica effettuata!\n\n' +
        `⚡ Quantità: ${state.amount} kWh\n` +
        `💰 Saldo precedente: ${oldBalance.toFixed(2)} kWh\n` +
        `💰 Nuovo saldo: ${newBalance.toFixed(2)} kWh\n\n` +
        'Grazie per aver utilizzato il nostro servizio!',
        { parse_mode: '' }
      );
    } catch (error) {
      console.error('Errore nell\'invio della notifica all\'utente:', error);
    }
    
    // Cancella lo stato di ricarica
    delete rechargeState[telegramId];
    
    // Modifica il messaggio di riepilogo con la conferma
    await ctx.editMessageText(
      '✅ Ricarica completata con successo!\n\n' +
      `👤 Utente: ${user.firstName} ${user.lastName}\n` +
      `💳 Tessera ID: ${user.cardId || 'Non impostata'}\n` +
      `⚡ Quantità: ${state.amount} kWh\n` +
      `💰 Saldo precedente: ${oldBalance.toFixed(2)} kWh\n` +
      `💰 Nuovo saldo: ${newBalance.toFixed(2)} kWh`,
      { parse_mode: '' }
    );
    
    return await ctx.answerCbQuery('Ricarica confermata!');
  } catch (error) {
    const errorCode = generateErrorCode();
    console.error(`Errore [${errorCode}] durante la conferma della ricarica:`, error);
    return await ctx.answerCbQuery(`Si è verificato un errore (${errorCode}). Riprova più tardi.`);
  }
};

/**
 * Gestisce l'annullamento di una ricarica tramite bottone inline
 */
const cancelRecharge = async (ctx) => {
  try {
    // Estrai l'ID Telegram dal callback data
    const callbackData = ctx.callbackQuery.data;
    const telegramId = sanitizeNumericId(callbackData.split('_')[2]);
    
    if (!telegramId) {
      return await ctx.answerCbQuery('ID utente non valido.');
    }
    
    // Verifica che esista un processo di ricarica per questo utente
    if (!rechargeState[telegramId]) {
      return await ctx.answerCbQuery('Nessuna ricarica in attesa di conferma.');
    }
    
    // Cancella lo stato di ricarica
    delete rechargeState[telegramId];
    
    // Modifica il messaggio di riepilogo con l'annullamento
    await ctx.editMessageText(
      '❌ Ricarica annullata.'
    );
    
    return await ctx.answerCbQuery('Ricarica annullata.');
  } catch (error) {
    const errorCode = generateErrorCode();
    console.error(`Errore [${errorCode}] durante l'annullamento della ricarica:`, error);
    return await ctx.answerCbQuery(`Si è verificato un errore (${errorCode}). Riprova più tardi.`);
  }
};

module.exports = {
  startRecharge,
  handleRechargeInput,
  confirmRecharge,
  cancelRecharge
};
