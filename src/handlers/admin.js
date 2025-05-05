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
 * Aggiorna i comandi di un utente quando diventa admin
 */
const updateUserCommands = async (ctx, telegramId) => {
  try {
    // Assicurati che adminCommands sia definito nella scope di questo modulo
    const adminCommands = [
      { command: 'start', description: 'Avvia il bot / Registrazione' },
      { command: 'help', description: 'Mostra i comandi disponibili' },
      { command: 'saldo', description: 'Visualizza il tuo saldo kWh attuale' },
      { command: 'cronologia', description: 'Visualizza la cronologia delle transazioni' },
      { command: 'registra_utilizzo', description: 'Registra un nuovo utilizzo di kWh' },
      { command: 'profilo', description: 'Visualizza il tuo profilo' },
      // Comandi amministratore
      { command: 'admin_utenti', description: 'Visualizza la lista degli utenti' },
      { command: 'admin_trova_tessera', description: 'Cerca utente per numero tessera' },
      { command: 'admin_trova_utente', description: 'Cerca utente per nome/username' },
      { command: 'admin_ricarica', description: 'Ricarica il saldo di un utente' },
      { command: 'admin_crea_invito', description: 'Crea un nuovo codice di invito' },
      { command: 'admin_inviti', description: 'Visualizza i codici di invito' },
      { command: 'admin_stats', description: 'Visualizza le statistiche del bot' },
      { command: 'admin_make_admin', description: 'Promuovi un utente ad amministratore' },
      { command: 'admin_aggiorna_comandi', description: 'Aggiorna i comandi bot' }
    ];

    // Imposta i comandi admin per il nuovo amministratore
    await ctx.telegram.setMyCommands(adminCommands, { 
      scope: { type: 'chat', chat_id: telegramId } 
    });
    console.log(`Comandi admin impostati per l'utente ${telegramId}`);
  } catch (error) {
    console.error(`Errore nell'impostazione dei comandi admin per ${telegramId}:`, error);
  }
};

/**
 * Rende un utente amministratore
 */
const makeAdmin = async (ctx) => {
  try {
    // Estrai l'ID Telegram dal comando
    const args = ctx.message.text.split(' ');
    if (args.length < 2) {
      return ctx.reply('⚠️ Utilizzo: /admin_make_admin [ID_Telegram]');
    }
    
    const telegramId = parseInt(args[1].trim());
    
    if (isNaN(telegramId)) {
      return ctx.reply('⚠️ ID Telegram non valido. Deve essere un numero.');
    }
    
    // Cerca e aggiorna l'utente
    const user = await User.findOneAndUpdate(
      { telegramId }, 
      { isAdmin: true },
      { new: true }
    );
    
    if (!user) {
      return ctx.reply(`❌ Nessun utente trovato con ID Telegram: ${telegramId}`);
    }
    
    // Aggiorna i comandi disponibili per il nuovo admin
    await updateUserCommands(ctx, telegramId);
    
    // Notifica l'utente
    try {
      await ctx.telegram.sendMessage(
        user.telegramId,
        '🎉 Sei stato promosso ad amministratore! Ora hai accesso a tutti i comandi amministrativi. Usa /help per vedere tutti i comandi disponibili.'
      );
    } catch (error) {
      console.error('Errore nell\'invio della notifica all\'utente:', error);
    }
    
    // Conferma all'amministratore
    return ctx.reply(
      `✅ Utente promosso ad amministratore con successo!\n\n` +
      `👤 ${user.firstName} ${user.lastName}\n` +
      `🆔 ID Telegram: ${user.telegramId}`
    );
  } catch (error) {
    console.error('Errore durante la promozione dell\'utente ad amministratore:', error);
    return ctx.reply('Si è verificato un errore. Per favore, riprova più tardi.');
  }
};

/**
 * Ottiene la lista degli utenti
 */
const getUsers = async (ctx) => {
  try {
    // Ottieni tutti gli utenti dal database (escludendo quelli disabilitati)
    const users = await User.find({ status: { $ne: 'disabled' } }).sort({ createdAt: -1 });
    
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
    const args = ctx.message.text.split(' ');
    
    // Se non ci sono argomenti, mostra istruzioni su come usare il comando
    if (args.length === 1) {
      return ctx.reply(
        '🔋 *Ricarica saldo utente*\n\n' +
        'Per ricaricare il saldo di un utente, usa uno dei seguenti formati:\n\n' +
        '• `/admin_ricarica [ID_Telegram]` - Cerca per ID Telegram\n' +
        '• `/admin_ricarica @[username]` - Cerca per username Telegram\n' +
        '• `/admin_ricarica tessera:[numero_tessera]` - Cerca per numero tessera\n\n' +
        'Esempio: `/admin_ricarica 12345678` oppure `/admin_ricarica @username` oppure `/admin_ricarica tessera:ABC123`',
        { parse_mode: 'Markdown' }
      );
    }
    
    // Estrai il parametro di ricerca
    const searchParam = args.slice(1).join(' ').trim();
    let user;
    
    // Cerca l'utente in base al tipo di parametro
    if (searchParam.startsWith('@')) {
      // Cerca per username
      const username = searchParam.substring(1);
      user = await User.findOne({ username });
    } else if (searchParam.toLowerCase().startsWith('tessera:')) {
      // Cerca per numero tessera
      const cardId = searchParam.substring(8).trim();
      user = await User.findOne({ cardId });
    } else {
      // Cerca per ID Telegram
      const searchId = parseInt(searchParam);
      if (isNaN(searchId)) {
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
      user: user
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
      
      // Usa pulsanti inline invece della tastiera per la conferma
      return ctx.reply(
        '🔍 *Riepilogo ricarica*\n\n' +
        `👤 Utente: ${state.user.firstName} ${state.user.lastName}\n` +
        `💳 Tessera ID: ${state.user.cardId || 'Non impostata'}\n` +
        `⚡ Quantità: ${amount} kWh\n` +
        `💰 Saldo attuale: ${state.user.balance.toFixed(2)} kWh\n` +
        `💰 Nuovo saldo: ${(state.user.balance + amount).toFixed(2)} kWh\n\n` +
        'Confermi questa ricarica?',
        {
          parse_mode: 'Markdown',
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
    console.error('Errore durante la gestione dell\'input di ricarica:', error);
    return ctx.reply(
      'Si è verificato un errore. Per favore, riprova più tardi.',
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
    const telegramId = parseInt(callbackData.split('_')[2]);
    
    // Verifica che esista un processo di ricarica per questo utente
    if (!rechargeState[telegramId] || rechargeState[telegramId].step !== 'waitingForConfirmation') {
      return ctx.answerCbQuery('Nessuna ricarica in attesa di conferma.');
    }
    
    const state = rechargeState[telegramId];
    
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
      processedBy: ctx.callbackQuery.from._id,
      notes: 'Ricarica manuale da amministratore'
    });
    
    await transaction.save();
    
    // Notifica l'utente
    try {
      await ctx.telegram.sendMessage(
        user.telegramId,
        '🎉 *Ricarica effettuata!*\n\n' +
        `⚡ Quantità: ${state.amount} kWh\n` +
        `💰 Saldo precedente: ${oldBalance.toFixed(2)} kWh\n` +
        `💰 Nuovo saldo: ${newBalance.toFixed(2)} kWh\n\n` +
        'Grazie per aver utilizzato il nostro servizio!',
        { parse_mode: 'Markdown' }
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
      { parse_mode: 'Markdown' }
    );
    
    return ctx.answerCbQuery('Ricarica confermata!');
  } catch (error) {
    console.error('Errore durante la conferma della ricarica:', error);
    return ctx.answerCbQuery('Si è verificato un errore. Per favore, riprova più tardi.');
  }
};

/**
 * Gestisce l'annullamento di una ricarica tramite bottone inline
 */
const cancelRecharge = async (ctx) => {
  try {
    // Estrai l'ID Telegram dal callback data
    const callbackData = ctx.callbackQuery.data;
    const telegramId = parseInt(callbackData.split('_')[2]);
    
    // Verifica che esista un processo di ricarica per questo utente
    if (!rechargeState[telegramId]) {
      return ctx.answerCbQuery('Nessuna ricarica in attesa di conferma.');
    }
    
    // Cancella lo stato di ricarica
    delete rechargeState[telegramId];
    
    // Modifica il messaggio di riepilogo con l'annullamento
    await ctx.editMessageText(
      '❌ Ricarica annullata.'
    );
    
    return ctx.answerCbQuery('Ricarica annullata.');
  } catch (error) {
    console.error('Errore durante l\'annullamento della ricarica:', error);
    return ctx.answerCbQuery('Si è verificato un errore. Per favore, riprova più tardi.');
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
      // Prima trova l'utente dal telegramId
      const telegramId = ctx.from.id;
      const adminUser = await User.findOne({ telegramId });
      
      if (!adminUser) {
        return ctx.reply(
          '⚠️ Errore: impossibile identificare l\'utente amministratore.',
          Markup.removeKeyboard()
        );
      }
      
      const invite = new Invite({
        code: state.code,
        createdBy: adminUser._id,  // Usa l'ID dell'utente recuperato dal database
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
    const totalUsers = await User.countDocuments({ status: { $ne: 'disabled' } });
    const activeUsers = await User.countDocuments({ status: 'active' });
    const pendingUsers = await User.countDocuments({ status: 'pending' });
    const blockedUsers = await User.countDocuments({ status: 'blocked' });
    const disabledUsers = await User.countDocuments({ status: 'disabled' });
    
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
    message += `❌ Bloccati: ${blockedUsers}\n`;
    message += `🚫 Disabilitati: ${disabledUsers}\n\n`;
    
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

/**
 * Trova un utente specifico per ID tessera
 */
const findUserByCard = async (ctx) => {
  try {
    // Estrai il numero di tessera dal comando
    const args = ctx.message.text.split(' ');
    if (args.length < 2) {
      return ctx.reply('⚠️ Utilizzo: /admin_trova_tessera [numero_tessera]');
    }
    
    const cardId = args[1].trim();
    
    // Cerca l'utente nel database
    const user = await User.findOne({ cardId });
    
    if (!user) {
      return ctx.reply(`❌ Nessun utente trovato con la tessera ID: ${cardId}`);
    }
    
    // Formatta i dettagli dell'utente
    const userDetails = await formatUserDetails(user);
    
    return ctx.reply(userDetails, { 
      parse_mode: 'Markdown',
      disable_web_page_preview: true
    });
  } catch (error) {
    console.error('Errore durante la ricerca dell\'utente per tessera:', error);
    return ctx.reply('Si è verificato un errore. Per favore, riprova più tardi.');
  }
};

/**
 * Trova un utente specifico per username o nome
 */
const findUserByName = async (ctx) => {
  try {
    // Estrai il nome/username dal comando
    const args = ctx.message.text.split(' ');
    if (args.length < 2) {
      return ctx.reply('⚠️ Utilizzo: /admin_trova_utente [username o nome]');
    }
    
    const searchTerm = args.slice(1).join(' ').trim();
    let searchQuery = {};
    
    // Se inizia con @ è uno username
    if (searchTerm.startsWith('@')) {
      searchQuery.username = searchTerm.substring(1);
    } else {
      // Altrimenti cerca nel nome o cognome con regex per ricerca parziale
      searchQuery = {
        $or: [
          { firstName: { $regex: searchTerm, $options: 'i' } },
          { lastName: { $regex: searchTerm, $options: 'i' } }
        ]
      };
    }
    
    // Cerca l'utente nel database
    const users = await User.find(searchQuery).limit(5);
    
    if (users.length === 0) {
      return ctx.reply(`❌ Nessun utente trovato con il termine: ${searchTerm}`);
    }
    
    if (users.length === 1) {
      // Se c'è un solo risultato, mostra i dettagli completi
      const userDetails = await formatUserDetails(users[0]);
      return ctx.reply(userDetails, { 
        parse_mode: 'Markdown',
        disable_web_page_preview: true
      });
    } else {
      // Se ci sono più risultati, mostra una lista breve
      let message = `🔍 *Trovati ${users.length} utenti*\n\n`;
      
      for (const user of users) {
        message += `👤 *${user.firstName} ${user.lastName}*\n`;
        message += `💳 Tessera ID: ${user.cardId || 'Non impostata'}\n`;
        message += `🆔 ID Telegram: \`${user.telegramId}\`\n\n`;
      }
      
      message += 'Per vedere i dettagli completi, usa: /admin_dettaglio [ID_Telegram]';
      
      return ctx.reply(message, { 
        parse_mode: 'Markdown',
        disable_web_page_preview: true
      });
    }
  } catch (error) {
    console.error('Errore durante la ricerca dell\'utente per nome:', error);
    return ctx.reply('Si è verificato un errore. Per favore, riprova più tardi.');
  }
};

/**
 * Mostra i dettagli completi di un utente specifico
 */
const getUserDetails = async (ctx) => {
  try {
    // Estrai l'ID Telegram dal comando
    const args = ctx.message.text.split(' ');
    if (args.length < 2) {
      return ctx.reply('⚠️ Utilizzo: /admin_dettaglio [ID_Telegram]');
    }
    
    const telegramId = parseInt(args[1].trim());
    
    if (isNaN(telegramId)) {
      return ctx.reply('⚠️ ID Telegram non valido. Deve essere un numero.');
    }
    
    // Cerca l'utente nel database
    const user = await User.findOne({ telegramId });
    
    if (!user) {
      return ctx.reply(`❌ Nessun utente trovato con ID Telegram: ${telegramId}`);
    }
    
    // Formatta i dettagli dell'utente
    const userDetails = await formatUserDetails(user);
    
    return ctx.reply(userDetails, { 
      parse_mode: 'Markdown',
      disable_web_page_preview: true
    });
  } catch (error) {
    console.error('Errore durante la visualizzazione dei dettagli dell\'utente:', error);
    return ctx.reply('Si è verificato un errore. Per favore, riprova più tardi.');
  }
};

/**
 * Formatta i dettagli completi di un utente incluse le transazioni recenti
 */
const formatUserDetails = async (user) => {
  // Formatta i dettagli principali dell'utente
  let message = `👤 *DETTAGLI UTENTE*\n\n`;
  message += `*Nome*: ${user.firstName} ${user.lastName}\n`;
  message += `*Username*: ${user.username ? '@' + user.username : 'Non impostato'}\n`;
  message += `*Telegram ID*: \`${user.telegramId}\`\n`;
  message += `*Tessera ID*: ${user.cardId || 'Non impostata'}\n`;
  message += `*Saldo*: ${user.balance.toFixed(2)} kWh\n`;
  
  // Stato con aggiunta di "disabilitato"
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
  
  message += `*Stato*: ${statusText}\n`;
  message += `*Admin*: ${user.isAdmin ? '✅ Sì' : '❌ No'}\n`;
  message += `*Codice Invito Usato*: ${user.inviteCodeUsed || 'Nessuno'}\n`;
  message += `*Registrato il*: ${new Date(user.createdAt).toLocaleDateString('it-IT')} ${new Date(user.createdAt).toLocaleTimeString('it-IT')}\n`;
  message += `*Ultimo accesso*: ${new Date(user.lastSeen).toLocaleDateString('it-IT')} ${new Date(user.lastSeen).toLocaleTimeString('it-IT')}\n\n`;
  
  // Ottieni le ultime 5 transazioni dell'utente
  const transactions = await Transaction.find({ userId: user._id })
    .sort({ createdAt: -1 })
    .limit(5);
  
  if (transactions.length > 0) {
    message += `📝 *Ultime transazioni*\n\n`;
    
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
      message += `💰 Saldo precedente: ${transaction.previousBalance.toFixed(2)} kWh\n`;
      message += `💰 Saldo dopo: ${transaction.newBalance.toFixed(2)} kWh\n`;
      if (transaction.notes) {
        message += `📝 Note: ${transaction.notes}\n`;
      }
      message += '\n';
    }
  } else {
    message += '📝 *Nessuna transazione registrata*\n\n';
  }
  
  // Aggiungi comandi rapidi
  message += `🔧 *Azioni rapide*:\n`;
  message += `/admin_ricarica ${user.telegramId} - Per ricaricare il saldo\n`;
  
  if (user.status === 'pending') {
    message += `/admin_approva ${user.telegramId} - Per approvare l'utente\n`;
  } else if (user.status === 'active') {
    message += `/admin_blocca ${user.telegramId} - Per bloccare l'utente\n`;
    message += `/admin_disabilita ${user.telegramId} - Per disabilitare l'utente\n`;
  } else if (user.status === 'blocked') {
    message += `/admin_sblocca ${user.telegramId} - Per sbloccare l'utente\n`;
    message += `/admin_disabilita ${user.telegramId} - Per disabilitare l'utente\n`;
  } else if (user.status === 'disabled') {
    message += `/admin_sblocca ${user.telegramId} - Per riattivare l'utente\n`;
  }
  
  message += `/admin_elimina ${user.telegramId} - Per eliminare l'utente\n`;
  
  if (!user.isAdmin) {
    message += `/admin_make_admin ${user.telegramId} - Per promuovere l'utente ad amministratore\n`;
  }
  
  return message;
};

/**
 * Esporta tutti gli utenti in formato CSV
 */
const exportUsers = async (ctx) => {
  try {
    // Ottieni tutti gli utenti dal database
    const users = await User.find().sort({ createdAt: -1 });
    
    if (users.length === 0) {
      return ctx.reply('Non ci sono utenti registrati.');
    }
    
    // Crea l'intestazione del CSV
    let csvContent = 'ID Telegram,Nome,Cognome,Username,Tessera ID,Saldo,Stato,Admin,Data Registrazione\n';
    
    // Aggiungi i dati di ogni utente
    for (const user of users) {
      const row = [
        user.telegramId,
        `"${user.firstName}"`,
        `"${user.lastName}"`,
        user.username ? `"${user.username}"` : '',
        user.cardId || '',
        user.balance.toFixed(2),
        user.status,
        user.isAdmin ? 'Sì' : 'No',
        new Date(user.createdAt).toLocaleDateString('it-IT')
      ];
      
      csvContent += row.join(',') + '\n';
    }
    
    // Invia il file CSV
    const buffer = Buffer.from(csvContent, 'utf8');
    
    // Crea un nome di file con la data corrente
    const today = new Date().toISOString().slice(0, 10);
    const filename = `utenti_nikola_${today}.csv`;
    
    return ctx.replyWithDocument({ 
      source: buffer, 
      filename: filename 
    }, {
      caption: `📊 Esportazione completata: ${users.length} utenti`
    });
  } catch (error) {
    console.error('Errore durante l\'esportazione degli utenti:', error);
    return ctx.reply('Si è verificato un errore. Per favore, riprova più tardi.');
  }
};

/**
 * Modifica lo stato di un utente (approva, blocca, sblocca)
 */
const changeUserStatus = async (ctx, newStatus) => {
  try {
    // Estrai l'ID Telegram dal comando
    const args = ctx.message.text.split(' ');
    if (args.length < 2) {
      return ctx.reply(`⚠️ Utilizzo: /admin_${newStatus === 'active' ? 'approva' : (newStatus === 'blocked' ? 'blocca' : 'sblocca')} [ID_Telegram]`);
    }
    
    const telegramId = parseInt(args[1].trim());
    
    if (isNaN(telegramId)) {
      return ctx.reply('⚠️ ID Telegram non valido. Deve essere un numero.');
    }
    
    // Cerca e aggiorna l'utente
    const user = await User.findOneAndUpdate(
      { telegramId }, 
      { status: newStatus },
      { new: true }
    );
    
    if (!user) {
      return ctx.reply(`❌ Nessun utente trovato con ID Telegram: ${telegramId}`);
    }
    
    // Notifica l'utente del cambio di stato
    try {
      let message = '';
      
      if (newStatus === 'active') {
        message = '🎉 Il tuo account è stato approvato! Ora puoi utilizzare tutte le funzionalità del bot.';
      } else if (newStatus === 'blocked') {
        message = '⛔ Il tuo account è stato bloccato. Contatta l\'amministratore per maggiori informazioni.';
      } else if (newStatus === 'pending') {
        message = '⏳ Il tuo account è stato messo in attesa. Contatta l\'amministratore per maggiori informazioni.';
      }
      
      await ctx.telegram.sendMessage(user.telegramId, message);
    } catch (error) {
      console.error('Errore nell\'invio della notifica all\'utente:', error);
    }
    
    // Conferma all'amministratore
    return ctx.reply(
      `✅ Stato dell'utente aggiornato con successo!\n\n` +
      `👤 ${user.firstName} ${user.lastName}\n` +
      `🆔 ID Telegram: ${user.telegramId}\n` +
      `📊 Nuovo stato: ${newStatus === 'active' ? '✅ Attivo' : (newStatus === 'blocked' ? '❌ Bloccato' : '⏳ In attesa')}`
    );
  } catch (error) {
    console.error(`Errore durante il cambio di stato dell'utente:`, error);
    return ctx.reply('Si è verificato un errore. Per favore, riprova più tardi.');
  }
};

/**
 * Approva un utente
 */
const approveUser = async (ctx) => {
  return changeUserStatus(ctx, 'active');
};

/**
 * Blocca un utente
 */
const blockUser = async (ctx) => {
  return changeUserStatus(ctx, 'blocked');
};

/**
 * Sblocca un utente
 */
const unblockUser = async (ctx) => {
  return changeUserStatus(ctx, 'active');
};

/**
 * Lista utenti con paginazione
 */
const getUsersPaginated = async (ctx) => {
  try {
    // Verifica se ci sono parametri aggiuntivi per il filtro
    const args = ctx.message.text.split(' ');
    
    // Questa query esclude gli utenti disabilitati per default
    let query = { status: { $ne: 'disabled' } };
    
    // Se viene richiesto un filtro specifico, sovrascrive la query
    if (args.length > 1) {
      const filter = args[1].toLowerCase();
      
      if (filter === 'attivi') {
        query = { status: 'active' };
      } else if (filter === 'in_attesa' || filter === 'pending') {
        query = { status: 'pending' };
      } else if (filter === 'bloccati') {
        query = { status: 'blocked' };
      } else if (filter === 'disabilitati') {
        query = { status: 'disabled' };
      } else if (filter === 'tutti') {
        query = {}; // Mostra veramente tutti, inclusi i disabilitati
      }
    }
    
    // Ottiene il numero totale di utenti che corrispondono al query
    const totalUsers = await User.countDocuments(query);
    
    if (totalUsers === 0) {
      return ctx.reply('Non ci sono utenti che corrispondono ai criteri di ricerca.');
    }
    
    // Imposta la paginazione
    const page = 1; // Prima pagina
    const pageSize = 5; // 5 utenti per pagina
    const totalPages = Math.ceil(totalUsers / pageSize);
    
    // Ottiene gli utenti per la pagina corrente
    const users = await User.find(query)
      .sort({ createdAt: -1 })
      .skip((page - 1) * pageSize)
      .limit(pageSize);
    
    // Formatta la lista degli utenti
    let message = `👥 *Lista degli utenti*\n`;
    message += `📊 Mostrati ${users.length} di ${totalUsers} utenti\n`;
    message += `📄 Pagina ${page} di ${totalPages}\n\n`;
    
    for (const user of users) {
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
      
      message += `👤 *${user.firstName} ${user.lastName}*\n`;
      message += `🆔 ID: \`${user.telegramId}\`\n`;
      message += `💳 Tessera: ${user.cardId || 'Non impostata'}\n`;
      message += `💰 Saldo: ${user.balance.toFixed(2)} kWh\n`;
      message += `📊 Stato: ${status}\n\n`;
    }
    
    message += `\nPer vedere dettagli completi: /admin_dettaglio [ID_Telegram]`;
    
    // Crea bottoni per la navigazione
    const keyboard = [];
    let navigationRow = [];
    
    if (page > 1) {
      navigationRow.push(Markup.button.callback('⬅️ Precedente', `users_page_${page-1}_${JSON.stringify(query)}`));
    }
    
    if (page < totalPages) {
      navigationRow.push(Markup.button.callback('➡️ Successiva', `users_page_${page+1}_${JSON.stringify(query)}`));
    }
    
    keyboard.push(navigationRow);
    
    // Aggiunge filtri rapidi
    keyboard.push([
      Markup.button.callback('Tutti', 'users_filter_all'),
      Markup.button.callback('Attivi', 'users_filter_active'),
      Markup.button.callback('In attesa', 'users_filter_pending'),
      Markup.button.callback('Bloccati', 'users_filter_blocked')
    ]);
    
    // Aggiunge filtro per utenti disabilitati
    keyboard.push([
      Markup.button.callback('Disabilitati', 'users_filter_disabled'),
      Markup.button.callback('Veramente tutti', 'users_filter_really_all')
    ]);
    
    return ctx.reply(message, { 
      parse_mode: 'Markdown',
      disable_web_page_preview: true,
      ...Markup.inlineKeyboard(keyboard)
    });
  } catch (error) {
    console.error('Errore durante la richiesta della lista utenti paginata:', error);
    return ctx.reply('Si è verificato un errore. Per favore, riprova più tardi.');
  }
};

/**
 * Disabilita un utente
 */
const disableUser = async (ctx) => {
  try {
    // Estrai l'ID Telegram dal comando
    const args = ctx.message.text.split(' ');
    if (args.length < 2) {
      return ctx.reply('⚠️ Utilizzo: /admin_disabilita [ID_Telegram]');
    }
    
    const telegramId = parseInt(args[1].trim());
    
    if (isNaN(telegramId)) {
      return ctx.reply('⚠️ ID Telegram non valido. Deve essere un numero.');
    }
    
    // Cerca e aggiorna l'utente
    const user = await User.findOneAndUpdate(
      { telegramId }, 
      { status: 'disabled' },  // Nuovo stato: disabilitato
      { new: true }
    );
    
    if (!user) {
      return ctx.reply(`❌ Nessun utente trovato con ID Telegram: ${telegramId}`);
    }
    
    // Notifica l'utente 
    try {
      await ctx.telegram.sendMessage(
        user.telegramId,
        '⚠️ Il tuo account è stato disabilitato da un amministratore. ' +
        'Per maggiori informazioni, contatta l\'amministratore.'
      );
    } catch (error) {
      console.error('Errore nell\'invio della notifica all\'utente:', error);
    }
    
    // Conferma all'amministratore
    return ctx.reply(
      `✅ Utente disabilitato con successo!\n\n` +
      `👤 ${user.firstName} ${user.lastName}\n` +
      `🆔 ID Telegram: ${user.telegramId}\n` +
      `💳 Tessera ID: ${user.cardId || 'Non impostata'}`
    );
  } catch (error) {
    console.error('Errore durante la disabilitazione dell\'utente:', error);
    return ctx.reply('Si è verificato un errore. Per favore, riprova più tardi.');
  }
};

/**
 * Elimina completamente un utente dal database
 */
const deleteUser = async (ctx) => {
  try {
    // Estrai l'ID Telegram dal comando
    const args = ctx.message.text.split(' ');
    if (args.length < 2) {
      return ctx.reply('⚠️ Utilizzo: /admin_elimina [ID_Telegram]');
    }
    
    const telegramId = parseInt(args[1].trim());
    
    if (isNaN(telegramId)) {
      return ctx.reply('⚠️ ID Telegram non valido. Deve essere un numero.');
    }
    
    // Prima ottieni l'utente per avere i dettagli
    const user = await User.findOne({ telegramId });
    
    if (!user) {
      return ctx.reply(`❌ Nessun utente trovato con ID Telegram: ${telegramId}`);
    }
    
    // Richiedi conferma
    const userDetails = `👤 ${user.firstName} ${user.lastName}\n` +
                        `🆔 ID Telegram: ${user.telegramId}\n` +
                        `💳 Tessera ID: ${user.cardId || 'Non impostata'}\n` +
                        `💰 Saldo: ${user.balance.toFixed(2)} kWh`;
    
    // Aggiungi le informazioni al context per la conferma successiva
    ctx.session = ctx.session || {};
    ctx.session.pendingDeletion = {
      telegramId: user.telegramId,
      userId: user._id,
      name: `${user.firstName} ${user.lastName}`,
      cardId: user.cardId
    };
    
    return ctx.reply(
      `⚠️ *ATTENZIONE*: Stai per eliminare definitivamente questo utente:\n\n` +
      `${userDetails}\n\n` +
      `Questa operazione è *IRREVERSIBILE* e rimuoverà anche tutte le transazioni associate.\n\n` +
      `Per confermare, invia: /admin_conferma_eliminazione ${telegramId}`,
      { parse_mode: 'Markdown' }
    );
  } catch (error) {
    console.error('Errore durante la preparazione dell\'eliminazione dell\'utente:', error);
    return ctx.reply('Si è verificato un errore. Per favore, riprova più tardi.');
  }
};

/**
 * Conferma l'eliminazione di un utente
 */
const confirmUserDeletion = async (ctx) => {
  try {
    // Estrai l'ID Telegram dal comando
    const args = ctx.message.text.split(' ');
    if (args.length < 2) {
      return ctx.reply('⚠️ Utilizzo: /admin_conferma_eliminazione [ID_Telegram]');
    }
    
    const telegramId = parseInt(args[1].trim());
    
    if (isNaN(telegramId)) {
      return ctx.reply('⚠️ ID Telegram non valido. Deve essere un numero.');
    }
    
    // Verifica che ci sia una eliminazione in attesa e che corrisponda
    if (!ctx.session || !ctx.session.pendingDeletion || ctx.session.pendingDeletion.telegramId !== telegramId) {
      return ctx.reply('⚠️ Nessuna richiesta di eliminazione in attesa per questo utente o la sessione è scaduta.');
    }
    
    const pendingDeletion = ctx.session.pendingDeletion;
    
    // Notifica l'utente prima dell'eliminazione
    try {
      await ctx.telegram.sendMessage(
        telegramId,
        '⚠️ Il tuo account è stato eliminato da un amministratore. ' +
        'Per maggiori informazioni, contatta l\'amministratore.'
      );
    } catch (error) {
      console.error('Errore nell\'invio della notifica all\'utente:', error);
    }
    
    // Elimina tutte le transazioni dell'utente
    await Transaction.deleteMany({ userId: pendingDeletion.userId });
    
    // Elimina l'utente
    await User.deleteOne({ telegramId });
    
    // Pulisci la sessione
    delete ctx.session.pendingDeletion;
    
    return ctx.reply(
      `✅ Utente eliminato definitivamente!\n\n` +
      `👤 ${pendingDeletion.name}\n` +
      `🆔 ID Telegram: ${pendingDeletion.telegramId}\n` +
      `💳 Tessera ID: ${pendingDeletion.cardId || 'Non impostata'}\n\n` +
      `Tutte le transazioni associate sono state eliminate.`
    );
  } catch (error) {
    console.error('Errore durante l\'eliminazione dell\'utente:', error);
    return ctx.reply('Si è verificato un errore. Per favore, riprova più tardi.');
  }
};

module.exports = {
  // Funzioni esistenti
  getUsers,
  startRecharge,
  handleRechargeInput,
  startInviteCodeCreation,
  handleInviteCodeInput,
  getInviteCodes,
  getStats,
  rechargeState,
  inviteCodeState,
  
  // Funzioni di ricarica con pulsanti
  confirmRecharge,
  cancelRecharge,
  
  // Funzioni di ricerca utenti
  findUserByCard,
  findUserByName,
  getUserDetails,
  exportUsers,
  approveUser,
  blockUser,
  unblockUser,
  getUsersPaginated,
  
  // Funzioni per disabilitazione ed eliminazione
  disableUser,
  deleteUser,
  confirmUserDeletion,
  
  // Nuove funzioni per i comandi
  makeAdmin,
  updateUserCommands
};
