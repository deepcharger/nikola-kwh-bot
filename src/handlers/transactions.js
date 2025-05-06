/**
 * Handler per la gestione delle transazioni (ricariche e utilizzi)
 */

const { Markup } = require('telegraf');
const User = require('../database/models/user');
const Transaction = require('../database/models/transaction');
const config = require('../config/config');

// Soglia di avviso per saldo basso (in kWh)
const LOW_BALANCE_THRESHOLD = 40;

/**
 * Stato per la registrazione delle transazioni
 */
const transactionState = {};

/**
 * Avvia il processo di registrazione di un utilizzo
 */
const startUsageRegistration = async (ctx) => {
  try {
    const telegramId = ctx.from.id;
    
    // Inizializza lo stato di registrazione dell'utilizzo
    transactionState[telegramId] = { 
      step: 'waitingForUsageAmount',
      type: 'usage'
    };
    
    return ctx.reply(
      '📉 Registrazione di un nuovo utilizzo\n\n' +
      'Per favore, inserisci la quantità di kWh utilizzati:',
      Markup.keyboard([['❌ Annulla']])
        .oneTime()
        .resize()
    );
  } catch (error) {
    console.error('Errore durante l\'avvio della registrazione dell\'utilizzo:', error);
    return ctx.reply('Si è verificato un errore. Per favore, riprova più tardi.');
  }
};

/**
 * Avvia il processo di caricamento di una foto per documentare l'utilizzo
 */
const startPhotoUpload = async (ctx) => {
  try {
    const telegramId = ctx.from.id;
    
    // Controlla se esiste uno stato valido
    if (!transactionState[telegramId] || transactionState[telegramId].step !== 'waitingForPhoto') {
      return ctx.reply(
        '⚠️ Devi prima iniziare il processo di registrazione di un utilizzo.\n' +
        'Usa il comando /registra_utilizzo per iniziare.'
      );
    }
    
    return ctx.reply(
      '📷 Per favore, carica una foto che documenti il tuo utilizzo (ad esempio, una foto del display della colonnina).',
      Markup.keyboard([['❌ Annulla']])
        .oneTime()
        .resize()
    );
  } catch (error) {
    console.error('Errore durante l\'avvio del caricamento della foto:', error);
    return ctx.reply('Si è verificato un errore. Per favore, riprova più tardi.');
  }
};

/**
 * Gestisce l'input dell'utente durante la registrazione di una transazione
 */
const handleTransactionInput = async (ctx) => {
  try {
    const telegramId = ctx.from.id;
    const input = ctx.message.text;
    
    // Controlla se l'utente è in processo di registrazione di una transazione
    if (!transactionState[telegramId]) {
      return;
    }
    
    const state = transactionState[telegramId];
    
    // Gestione dell'annullamento
    if (input === '❌ Annulla') {
      delete transactionState[telegramId];
      return ctx.reply(
        '❌ Operazione annullata.',
        Markup.removeKeyboard()
      );
    }
    
    // Gestione dell'input della quantità
    if (state.step === 'waitingForUsageAmount') {
      // Verifica che l'input sia un numero valido
      const amount = parseFloat(input);
      
      if (isNaN(amount) || amount <= 0) {
        return ctx.reply('⚠️ Inserisci un valore numerico positivo valido:');
      }
      
      // Salva l'importo e passa alla fase successiva
      state.amount = amount;
      state.step = 'waitingForPhoto';
      
      return ctx.reply(
        `✅ Quantità: ${amount} kWh\n\n` +
        '📷 Per favore, carica una foto che documenti il tuo utilizzo (ad esempio, una foto del display della colonnina).'
      );
    }
    
    // Gestione delle note opzionali
    if (state.step === 'waitingForNotes') {
      // Salva le note e completa la transazione
      state.notes = input;
      
      // Completa la transazione
      return completeTransaction(ctx);
    }
  } catch (error) {
    console.error('Errore durante la gestione dell\'input della transazione:', error);
    return ctx.reply('Si è verificato un errore. Per favore, riprova più tardi.');
  }
};

/**
 * Gestisce il caricamento della foto per la transazione
 */
const handlePhotoUpload = async (ctx) => {
  try {
    const telegramId = ctx.from.id;
    
    // Controlla se l'utente è in processo di registrazione di una transazione
    if (!transactionState[telegramId] || transactionState[telegramId].step !== 'waitingForPhoto') {
      return;
    }
    
    const state = transactionState[telegramId];
    
    // Ottieni il file ID della foto
    const photoFileId = ctx.message.photo[ctx.message.photo.length - 1].file_id;
    const messageId = ctx.message.message_id;
    
    // Salva le informazioni sulla foto e passa alla fase successiva
    state.photoFileId = photoFileId;
    state.photoMessageId = messageId;
    state.step = 'waitingForNotes';
    
    return ctx.reply(
      '✅ Foto ricevuta!\n\n' +
      'Se lo desideri, puoi aggiungere una nota (opzionale). Altrimenti, invia "Nessuna nota".',
      Markup.keyboard([['Nessuna nota'], ['❌ Annulla']])
        .oneTime()
        .resize()
    );
  } catch (error) {
    console.error('Errore durante la gestione del caricamento della foto:', error);
    return ctx.reply('Si è verificato un errore. Per favore, riprova più tardi.');
  }
};

/**
 * Completa la registrazione della transazione
 */
const completeTransaction = async (ctx) => {
  try {
    const telegramId = ctx.from.id;
    const state = transactionState[telegramId];
    
    // Ottieni l'utente dal database
    const user = await User.findOne({ telegramId });
    
    if (!user) {
      delete transactionState[telegramId];
      return ctx.reply(
        '⚠️ Utente non trovato. Per favore, riprova più tardi.',
        Markup.removeKeyboard()
      );
    }
    
    // Prepara i dati della transazione
    const previousBalance = user.balance;
    const amount = state.amount * (state.type === 'usage' ? -1 : 1); // Negativo per utilizzi
    const newBalance = previousBalance + amount;
    
    // Controlla se il saldo è sufficiente per l'utilizzo
    if (state.type === 'usage' && newBalance < 0) {
      delete transactionState[telegramId];
      return ctx.reply(
        `⚠️ Saldo insufficiente. Il tuo saldo attuale è di ${previousBalance.toFixed(2)} kWh.`,
        Markup.removeKeyboard()
      );
    }
    
    // Crea la nuova transazione
    const transaction = new Transaction({
      userId: user._id,
      cardId: user.cardId,
      type: state.type,
      amount: Math.abs(amount), // Salva il valore assoluto
      previousBalance,
      newBalance,
      photoFileId: state.photoFileId || null,
      photoMessageId: state.photoMessageId || null,
      notes: state.notes === 'Nessuna nota' ? '' : (state.notes || ''),
      status: state.type === 'usage' ? 'pending' : 'approved' // Utilizzi richiedono approvazione
    });
    
    await transaction.save();
    
    // Se è una ricarica, aggiorna immediatamente il saldo dell'utente
    // Per gli utilizzi, il saldo viene aggiornato solo dopo l'approvazione
    if (state.type === 'charge') {
      user.balance = newBalance;
      await user.save();
    }
    
    // Notifica l'amministratore per approvazione (solo per utilizzi)
    if (state.type === 'usage' && config.ADMIN_CHAT_ID) {
      const adminMessage = 
        '🔔 *Nuova richiesta di registrazione utilizzo*\n\n' +
        `👤 Utente: ${user.firstName} ${user.lastName}\n` +
        `💳 Tessera ID: ${user.cardId}\n` +
        `⚡ Quantità: ${state.amount} kWh\n` +
        `💰 Saldo attuale: ${previousBalance.toFixed(2)} kWh\n` +
        `💰 Saldo dopo approvazione: ${newBalance.toFixed(2)} kWh\n` +
        `📝 Note: ${transaction.notes || 'Nessuna'}\n\n` +
        'Vuoi approvare questa transazione?';
      
      // Bottoni per l'approvazione o il rifiuto
      const keyboard = Markup.inlineKeyboard([
        [
          Markup.button.callback('✅ Approva', `approve_usage:${transaction._id}`),
          Markup.button.callback('❌ Rifiuta', `reject_usage:${transaction._id}`)
        ]
      ]);
      
      try {
        // Prima invia la foto se presente
        if (state.photoFileId) {
          await ctx.telegram.sendPhoto(config.ADMIN_CHAT_ID, state.photoFileId, {
            caption: 'Foto documentativa dell\'utilizzo'
          });
        }
        
        // Poi invia il messaggio con i bottoni
        await ctx.telegram.sendMessage(config.ADMIN_CHAT_ID, adminMessage, {
          parse_mode: 'Markdown',
          ...keyboard
        });
      } catch (error) {
        console.error('Errore nell\'invio della notifica all\'amministratore:', error);
      }
    }
    
    // Cancella lo stato di registrazione
    delete transactionState[telegramId];
    
    // Conferma all'utente
    let confirmationMessage = '';
    
    if (state.type === 'usage') {
      confirmationMessage = 
        '✅ Utilizzo registrato con successo!\n\n' +
        `⚡ Quantità: ${state.amount} kWh\n` +
        `💰 Saldo attuale: ${previousBalance.toFixed(2)} kWh\n` +
        `💰 Saldo dopo approvazione: ${newBalance.toFixed(2)} kWh\n\n` +
        'La tua richiesta è in attesa di approvazione da parte dell\'amministratore.\n' +
        'Riceverai una notifica quando la tua richiesta sarà elaborata.';
    } else {
      confirmationMessage = 
        '✅ Ricarica registrata con successo!\n\n' +
        `⚡ Quantità: ${state.amount} kWh\n` +
        `💰 Saldo precedente: ${previousBalance.toFixed(2)} kWh\n` +
        `💰 Nuovo saldo: ${newBalance.toFixed(2)} kWh`;
    }
    
    return ctx.reply(confirmationMessage, Markup.removeKeyboard());
  } catch (error) {
    console.error('Errore durante il completamento della transazione:', error);
    delete transactionState[telegramId];
    return ctx.reply(
      'Si è verificato un errore. Per favore, riprova più tardi.',
      Markup.removeKeyboard()
    );
  }
};

/**
 * Gestisce l'approvazione di un utilizzo
 */
const approveUsage = async (ctx) => {
  try {
    // Estrae l'ID della transazione dalla callback query
    const transactionId = ctx.callbackQuery.data.split(':')[1];
    
    // Cerca la transazione
    const transaction = await Transaction.findById(transactionId);
    
    if (!transaction || transaction.type !== 'usage' || transaction.status !== 'pending') {
      return ctx.answerCbQuery('Transazione non valida o già processata');
    }
    
    // Cerca l'utente
    const user = await User.findById(transaction.userId);
    
    if (!user) {
      return ctx.answerCbQuery('Utente non trovato');
    }
    
    // Aggiorna lo stato della transazione
    transaction.status = 'approved';
    transaction.processedBy = ctx.user ? ctx.user._id : null;
    await transaction.save();
    
    // Aggiorna il saldo dell'utente
    user.balance = transaction.newBalance;
    await user.save();
    
    // Invia messaggio all'amministratore
    await ctx.editMessageText(
      ctx.callbackQuery.message.text + '\n\n✅ Utilizzo approvato!'
    );
    
    // Invia messaggio all'utente
    try {
      await ctx.telegram.sendMessage(
        user.telegramId,
        '✅ Il tuo utilizzo è stato approvato!\n\n' +
        `⚡ Quantità: ${transaction.amount} kWh\n` +
        `💰 Saldo precedente: ${transaction.previousBalance.toFixed(2)} kWh\n` +
        `💰 Nuovo saldo: ${transaction.newBalance.toFixed(2)} kWh\n` +
        `📝 Note: ${transaction.notes || 'Nessuna'}`
      );
      
      // Controlla se il saldo è basso e invia un avviso
      if (transaction.newBalance < LOW_BALANCE_THRESHOLD) {
        await ctx.telegram.sendMessage(
          user.telegramId,
          `⚠️ AVVISO: Il tuo saldo è basso (${transaction.newBalance.toFixed(2)} kWh).\n` +
          'Ti consigliamo di contattare un amministratore per una ricarica.'
        );
      }
    } catch (error) {
      console.error('Errore nell\'invio della notifica all\'utente:', error);
    }
    
    return ctx.answerCbQuery('Utilizzo approvato con successo');
  } catch (error) {
    console.error('Errore durante l\'approvazione dell\'utilizzo:', error);
    return ctx.answerCbQuery('Si è verificato un errore');
  }
};

/**
 * Gestisce il rifiuto di un utilizzo
 */
const rejectUsage = async (ctx) => {
  try {
    // Estrae l'ID della transazione dalla callback query
    const transactionId = ctx.callbackQuery.data.split(':')[1];
    
    // Cerca la transazione
    const transaction = await Transaction.findById(transactionId);
    
    if (!transaction || transaction.type !== 'usage' || transaction.status !== 'pending') {
      return ctx.answerCbQuery('Transazione non valida o già processata');
    }
    
    // Cerca l'utente
    const user = await User.findById(transaction.userId);
    
    if (!user) {
      return ctx.answerCbQuery('Utente non trovato');
    }
    
    // Aggiorna lo stato della transazione
    transaction.status = 'rejected';
    transaction.processedBy = ctx.user ? ctx.user._id : null;
    await transaction.save();
    
    // Invia messaggio all'amministratore
    await ctx.editMessageText(
      ctx.callbackQuery.message.text + '\n\n❌ Utilizzo rifiutato!'
    );
    
    // Invia messaggio all'utente
    try {
      await ctx.telegram.sendMessage(
        user.telegramId,
        '❌ Il tuo utilizzo è stato rifiutato.\n\n' +
        `⚡ Quantità: ${transaction.amount} kWh\n` +
        `💰 Saldo attuale: ${transaction.previousBalance.toFixed(2)} kWh (invariato)\n` +
        `📝 Note: ${transaction.notes || 'Nessuna'}\n\n` +
        'Per maggiori informazioni, contatta l\'amministratore.'
      );
    } catch (error) {
      console.error('Errore nell\'invio della notifica all\'utente:', error);
    }
    
    return ctx.answerCbQuery('Utilizzo rifiutato');
  } catch (error) {
    console.error('Errore durante il rifiuto dell\'utilizzo:', error);
    return ctx.answerCbQuery('Si è verificato un errore');
  }
};

/**
 * Ottiene il saldo kWh dell'utente
 */
const getBalance = async (ctx) => {
  try {
    const user = ctx.user;
    
    // Formato il saldo con 2 decimali
    const formattedBalance = user.balance.toFixed(2);
    
    // Ottieni le ultime transazioni dell'utente per calcolare statistiche
    const lastUsages = await Transaction.find({ 
      userId: user._id, 
      type: 'usage',
      status: 'approved'
    }).sort({ createdAt: -1 }).limit(5);
    
    // Calcola il consumo medio settimanale (se ci sono abbastanza dati)
    let consumoMedio = "Non disponibile";
    if (lastUsages.length > 0) {
      const totalKwh = lastUsages.reduce((sum, t) => sum + t.amount, 0);
      consumoMedio = (totalKwh / lastUsages.length).toFixed(2) + " kWh/utilizzo";
    }
    
    // Trova l'ultima ricarica
    const lastCharge = await Transaction.findOne({ 
      userId: user._id, 
      type: 'charge',
      status: 'approved'
    }).sort({ createdAt: -1 });
    
    let ultimaRicarica = "Mai effettuata";
    if (lastCharge) {
      const daysPassed = Math.floor((new Date() - new Date(lastCharge.createdAt)) / (1000 * 60 * 60 * 24));
      ultimaRicarica = `${daysPassed} giorni fa (${lastCharge.amount.toFixed(2)} kWh)`;
    }
    
    // Calcola stima autonomia (molto semplificata)
    let stimaAutonomia = "Non disponibile";
    if (lastUsages.length > 0 && user.balance > 0) {
      const avgUsage = lastUsages.reduce((sum, t) => sum + t.amount, 0) / lastUsages.length;
      if (avgUsage > 0) {
        const days = Math.floor(user.balance / avgUsage);
        stimaAutonomia = `${days} giorni circa`;
      }
    }
    
    // Messaggio formattato senza Markdown
    let message = `📊 SALDO ENERGETICO 📊\n\n`;
    message += `➡️ ${formattedBalance} kWh ⬅️\n\n`;
    message += `👤 INFORMAZIONI UTENTE:\n`;
    message += `• Tessera: ${user.cardId}\n`;
    message += `• Stato: ${user.status === 'active' ? '✅ Attivo' : '⏳ In attesa'}\n\n`;
    
    // Aggiungi statistiche
    message += `⚡ STATISTICHE:\n`;
    message += `• Consumo medio: ${consumoMedio}\n`;
    message += `• Ultima ricarica: ${ultimaRicarica}\n`;
    message += `• Stima autonomia: ${stimaAutonomia}\n`;
    
    // Controlla se il saldo è basso e aggiunge un avviso
    if (user.balance < LOW_BALANCE_THRESHOLD) {
      message += `\n⚠️ AVVISO: Il tuo saldo è basso (inferiore a ${LOW_BALANCE_THRESHOLD} kWh).\n`;
      message += `Ti consigliamo di contattare un amministratore per una ricarica.`;
      
      // Invia anche un avviso all'amministratore
      try {
        if (config.ADMIN_CHAT_ID) {
          await ctx.telegram.sendMessage(
            config.ADMIN_CHAT_ID,
            `⚠️ AVVISO SALDO BASSO: L'utente ${user.firstName} ${user.lastName} (ID: ${user.telegramId}) ` +
            `ha un saldo di ${formattedBalance} kWh (inferiore a ${LOW_BALANCE_THRESHOLD} kWh).`
          );
        }
      } catch (error) {
        console.error('Errore nell\'invio dell\'avviso all\'amministratore:', error);
      }
    }
    
    return ctx.reply(message, { parse_mode: '' }); // Nessuna formattazione
  } catch (error) {
    console.error('Errore durante la richiesta del saldo:', error);
    return ctx.reply('Si è verificato un errore. Per favore, riprova più tardi.');
  }
};

/**
 * Ottiene la cronologia delle transazioni dell'utente
 */
const getTransactionHistory = async (ctx) => {
  try {
    const user = ctx.user;
    
    // Ottieni le ultime 10 transazioni dell'utente
    const transactions = await Transaction.find({ userId: user._id })
      .sort({ createdAt: -1 })
      .limit(10);
    
    if (transactions.length === 0) {
      return ctx.reply('Non hai ancora effettuato alcuna transazione.');
    }
    
    // Formatta la cronologia
    let message = '📜 *Ultime transazioni*\n\n';
    
    for (const transaction of transactions) {
      const date = new Date(transaction.createdAt).toLocaleDateString('it-IT');
      const time = new Date(transaction.createdAt).toLocaleTimeString('it-IT');
      const amount = transaction.amount.toFixed(2);
      const type = transaction.type === 'charge' ? '🔋 Ricarica' : '⚡ Utilizzo';
      const status = transaction.status === 'approved' 
        ? '✅' 
        : (transaction.status === 'pending' ? '⏳' : '❌');
      
      message += `${status} ${type}: ${amount} kWh\n`;
      message += `📅 ${date} - ⏱️ ${time}\n`;
      message += `💰 Saldo dopo: ${transaction.newBalance.toFixed(2)} kWh\n`;
      if (transaction.notes) {
        message += `📝 Note: ${transaction.notes}\n`;
      }
      message += '\n';
    }
    
    return ctx.reply(message, { parse_mode: '' });
  } catch (error) {
    console.error('Errore durante la richiesta della cronologia:', error);
    return ctx.reply('Si è verificato un errore. Per favore, riprova più tardi.');
  }
};

module.exports = {
  startUsageRegistration,
  startPhotoUpload,
  handleTransactionInput,
  handlePhotoUpload,
  approveUsage,
  rejectUsage,
  getBalance,
  getTransactionHistory,
  transactionState
};
