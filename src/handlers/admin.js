/**
 * Handler per le funzionalità di amministrazione
 */

const { Markup } = require('telegraf');
const User = require('../database/models/user');
const Transaction = require('../database/models/transaction');
const Invite = require('../database/models/invite');
const config = require('../config/config');
const { 
  sanitizeNumericId, 
  sanitizeString, 
  sanitizeAmount, 
  sanitizeCardId, 
  escapeMarkdown, 
  generateErrorCode,
  sanitizeDate 
} = require('../utils/sanitize');

// Stato per la creazione delle ricariche
const rechargeState = {};

// Stato per la creazione dei codici di invito
const inviteCodeState = {};

// Stato per la gestione del comando saldi bassi
const lowBalanceState = {};

// Stato per la gestione del comando ricariche
const rechargeHistoryState = {};

// Stato per la gestione del comando utilizzi
const usageHistoryState = {};

/**
 * Mostra una pagina dell'elenco degli utenti
 */
const showUsersPage = async (ctx, users, threshold, page) => {
  try {
    const pageSize = 10;
    const totalPages = Math.ceil(users.length / pageSize);
    const startIndex = page * pageSize;
    const endIndex = Math.min(startIndex + pageSize, users.length);
    const usersOnPage = users.slice(startIndex, endIndex);
    
    let message = `📊 *Utenti con saldo inferiore a ${threshold} kWh*\n`;
    message += `(${users.length} utenti trovati - Pagina ${page + 1}/${totalPages})\n\n`;
    
    for (let i = 0; i < usersOnPage.length; i++) {
      const user = usersOnPage[i];
      message += `${startIndex + i + 1}. *${escapeMarkdown(user.firstName)} ${escapeMarkdown(user.lastName)}*\n`;
      message += `   💰 Saldo: ${user.balance.toFixed(2)} kWh\n`;
      message += `   🆔 ID: \`${user.telegramId}\`\n`;
      message += `   💳 Tessera: ${user.cardId || 'Non impostata'}\n`;
      // Aggiunti comandi copiabili
      message += `   📋 \`/admin_dettaglio ${user.telegramId}\`\n`;
      // Comandi per ricarica
      message += `   💸 \`/admin_ricarica ${user.telegramId}\`\n`;
      // Aggiungi comando ricarica per tessera se disponibile
      if (user.cardId) {
        message += `   💳 \`/admin_ricarica tessera:${user.cardId}\`\n`;
      }
      message += `\n`;
    }
    
    // Crea bottoni per la navigazione
    const keyboard = [];
    let navigationRow = [];
    
    if (page > 0) {
      navigationRow.push(Markup.button.callback('⬅️ Precedente', `low_balance_page_${page-1}`));
    }
    
    if (page < totalPages - 1) {
      navigationRow.push(Markup.button.callback('➡️ Successiva', `low_balance_page_${page+1}`));
    }
    
    keyboard.push(navigationRow);
    
    // Aggiunge opzione per scaricare come CSV
    keyboard.push([
      Markup.button.callback('📥 Scarica CSV', 'low_balance_csv')
    ]);
    
    // Salva gli utenti nell'oggetto di stato
    const telegramId = ctx.from.id;
    if (lowBalanceState[telegramId]) {
      lowBalanceState[telegramId].currentPage = page;
      lowBalanceState[telegramId].lastActivity = Date.now();
    }
    
    return ctx.reply(message, { 
      parse_mode: 'Markdown',
      disable_web_page_preview: true,
      ...Markup.inlineKeyboard(keyboard),
      ...Markup.removeKeyboard()
    });
  } catch (error) {
    const errorCode = generateErrorCode();
    console.error(`Errore [${errorCode}] durante la visualizzazione della pagina utenti:`, error);
    return ctx.reply(`Si è verificato un errore (codice: ${errorCode}). Per favore, riprova più tardi.`, 
      Markup.removeKeyboard());
  }
};

/**
 * Genera e invia un file CSV con gli utenti
 */
const sendUsersCsv = async (ctx, users, threshold) => {
  try {
    // Crea l'intestazione del CSV
    let csvContent = 'ID Telegram,Nome,Cognome,Username,Tessera ID,Saldo,Ultima Ricarica,Data Registrazione\n';
    
    // Ottieni le ultime ricariche per ogni utente
    const lastCharges = {};
    
    for (const user of users) {
      const lastCharge = await Transaction.findOne({
        userId: user._id,
        type: 'charge',
        status: 'approved'
      }).sort({ createdAt: -1 });
      
      if (lastCharge) {
        lastCharges[user._id.toString()] = new Date(lastCharge.createdAt).toLocaleDateString('it-IT');
      } else {
        lastCharges[user._id.toString()] = 'Mai';
      }
    }
    
    // Aggiungi i dati di ogni utente
    for (const user of users) {
      // Sanitizza i valori per il CSV
      const firstName = sanitizeString(user.firstName).replace(/"/g, '""'); // Escape le virgolette doppie
      const lastName = sanitizeString(user.lastName).replace(/"/g, '""');
      const username = user.username ? sanitizeString(user.username).replace(/"/g, '""') : '';
      
      const row = [
        user.telegramId,
        `"${firstName}"`,
        `"${lastName}"`,
        username ? `"${username}"` : '',
        user.cardId || '',
        user.balance.toFixed(2),
        lastCharges[user._id.toString()],
        new Date(user.createdAt).toLocaleDateString('it-IT')
      ];
      
      csvContent += row.join(',') + '\n';
    }
    
    // Invia il file CSV
    const buffer = Buffer.from(csvContent, 'utf8');
    
    // Crea un nome di file con la data corrente
    const today = new Date().toISOString().slice(0, 10);
    const filename = `saldi_bassi_inferiori_${threshold}_kwh_${today}.csv`;
    
    // Pulisci lo stato
    delete lowBalanceState[ctx.from.id];
    
    return ctx.replyWithDocument({ 
      source: buffer, 
      filename: filename 
    }, {
      caption: `📊 Esportazione completata: ${users.length} utenti con saldo inferiore a ${threshold} kWh`
    });
  } catch (error) {
    const errorCode = generateErrorCode();
    console.error(`Errore [${errorCode}] durante la generazione del file CSV:`, error);
    delete lowBalanceState[ctx.from.id];
    return ctx.reply(`Si è verificato un errore (codice: ${errorCode}). Per favore, riprova più tardi.`, 
      Markup.removeKeyboard());
  }
};

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
      { command: 'annulla', description: 'Annulla l\'operazione corrente' },
      // Comandi amministratore
      { command: 'admin_utenti', description: 'Visualizza la lista degli utenti' },
      { command: 'admin_trova_tessera', description: 'Cerca utente per numero tessera' },
      { command: 'admin_trova_utente', description: 'Cerca utente per nome/username' },
      { command: 'admin_ricarica', description: 'Ricarica il saldo di un utente' },
      { command: 'admin_crea_invito', description: 'Crea un nuovo codice di invito' },
      { command: 'admin_inviti', description: 'Visualizza i codici di invito' },
      { command: 'admin_stats', description: 'Visualizza le statistiche del bot' },
      { command: 'admin_make_admin', description: 'Promuovi un utente ad amministratore' },
      { command: 'admin_aggiorna_comandi', description: 'Aggiorna i comandi bot' },
      { command: 'admin_saldi_bassi', description: 'Trova utenti con saldo basso' },
      { command: 'admin_ricariche', description: 'Visualizza le ultime ricariche' },
      { command: 'admin_utilizzi', description: 'Visualizza gli ultimi utilizzi kWh' }
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
    
    const telegramId = sanitizeNumericId(args[1].trim());
    
    if (!telegramId) {
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
    const errorCode = generateErrorCode();
    console.error(`Errore [${errorCode}] durante la promozione dell'utente ad amministratore:`, error);
    return ctx.reply(`Si è verificato un errore (codice: ${errorCode}). Per favore, riprova più tardi.`);
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
      
      message += `👤 *${escapeMarkdown(user.firstName)} ${escapeMarkdown(user.lastName)}*\n`;
      message += `🆔 ID Telegram: \`${user.telegramId}\`\n`;
      if (user.username) {
        message += `👤 Username: @${escapeMarkdown(user.username)}\n`;
      }
      message += `💳 Tessera ID: ${user.cardId || 'Non impostata'}\n`;
      message += `💰 Saldo: ${user.balance.toFixed(2)} kWh\n`;
      message += `📊 Stato: ${status}\n`;
      message += `📅 Registrato il: ${new Date(user.createdAt).toLocaleDateString('it-IT')}\n`;
      // Aggiunti comandi copiabili
      message += `📋 \`/admin_dettaglio ${user.telegramId}\`\n`;
      message += `💸 \`/admin_ricarica ${user.telegramId}\`\n`;
      if (user.cardId) {
        message += `💳 \`/admin_ricarica tessera:${user.cardId}\`\n`;
      }
      message += `\n`;
    }
    
    return ctx.reply(message, { 
      parse_mode: 'Markdown',
      disable_web_page_preview: true
    });
  } catch (error) {
    const errorCode = generateErrorCode();
    console.error(`Errore [${errorCode}] durante la richiesta della lista utenti:`, error);
    return ctx.reply(`Si è verificato un errore (codice: ${errorCode}). Per favore, riprova più tardi.`);
  }
};

/**
 * Avvia il processo di ricerca delle ricariche
 */
const startRechargeHistory = async (ctx) => {
  try {
    const telegramId = ctx.from.id;
    
    // Inizializza lo stato di ricerca delle ricariche
    rechargeHistoryState[telegramId] = { 
      step: 'waitingForDate',
      lastActivity: Date.now()
    };
    
    return ctx.reply(
      '📊 *Ricerca ricariche*\n\n' +
      'Scegli un\'opzione per visualizzare le ricariche:\n\n' +
      '1. "oggi" - Visualizza le ricariche di oggi\n' +
      '2. "ieri" - Visualizza le ricariche di ieri\n' +
      '3. "settimana" - Visualizza le ricariche dell\'ultima settimana\n' +
      '4. "mese" - Visualizza le ricariche dell\'ultimo mese\n' +
      '5. "GG/MM/AAAA" - Inserisci una data specifica (es. 15/05/2025)\n\n' +
      'Per visualizzare le ultime 10 ricariche indipendentemente dalla data, scrivi "ultime"',
      { 
        parse_mode: 'Markdown',
        ...Markup.keyboard([['oggi', 'ieri', 'settimana'], ['mese', 'ultime'], ['❌ Annulla']])
          .oneTime()
          .resize()
      }
    );
  } catch (error) {
    const errorCode = generateErrorCode();
    console.error(`Errore [${errorCode}] durante l'avvio della ricerca ricariche:`, error);
    return ctx.reply(`Si è verificato un errore (codice: ${errorCode}). Per favore, riprova più tardi.`);
  }
};
/**
 * Gestisce l'input durante la ricerca delle ricariche
 */
const handleRechargeHistoryInput = async (ctx) => {
  try {
    const telegramId = ctx.from.id;
    const input = ctx.message.text.toLowerCase();
    
    // Controlla se l'amministratore è in processo di ricerca ricariche
    if (!rechargeHistoryState[telegramId]) {
      return;
    }
    
    const state = rechargeHistoryState[telegramId];
    // Aggiorna il timestamp di attività
    state.lastActivity = Date.now();
    
    // Gestione dell'annullamento
    if (input === '❌ annulla') {
      delete rechargeHistoryState[telegramId];
      return ctx.reply(
        '❌ Operazione annullata.',
        Markup.removeKeyboard()
      );
    }
    
    // Gestione dell'input della data
    if (state.step === 'waitingForDate') {
      let startDate, endDate, dateDescription;
      const now = new Date();
      now.setHours(23, 59, 59, 999); // Fine della giornata corrente
      
      if (input === 'oggi') {
        startDate = new Date();
        startDate.setHours(0, 0, 0, 0); // Inizio della giornata corrente
        endDate = now;
        dateDescription = 'oggi';
      } else if (input === 'ieri') {
        startDate = new Date();
        startDate.setDate(startDate.getDate() - 1);
        startDate.setHours(0, 0, 0, 0); // Inizio di ieri
        endDate = new Date();
        endDate.setDate(endDate.getDate() - 1);
        endDate.setHours(23, 59, 59, 999); // Fine di ieri
        dateDescription = 'ieri';
      } else if (input === 'settimana') {
        startDate = new Date();
        startDate.setDate(startDate.getDate() - 7);
        startDate.setHours(0, 0, 0, 0); // Inizio di 7 giorni fa
        endDate = now;
        dateDescription = 'dell\'ultima settimana';
      } else if (input === 'mese') {
        startDate = new Date();
        startDate.setMonth(startDate.getMonth() - 1);
        startDate.setHours(0, 0, 0, 0); // Inizio di 30 giorni fa
        endDate = now;
        dateDescription = 'dell\'ultimo mese';
      } else if (input === 'ultime') {
        // Per le ultime 10 ricariche, non impostiamo date specifiche
        startDate = null;
        endDate = null;
        dateDescription = 'ultime 10 ricariche';
      } else {
        // Tentativo di interpretare una data specifica
        const dateResult = sanitizeDate(input);
        if (!dateResult.valid) {
          return ctx.reply('⚠️ Formato data non valido. Utilizza GG/MM/AAAA o scegli un\'opzione predefinita:');
        }
        
        startDate = dateResult.date;
        startDate.setHours(0, 0, 0, 0); // Inizio della giornata
        endDate = new Date(startDate);
        endDate.setHours(23, 59, 59, 999); // Fine della giornata
        dateDescription = `del ${startDate.toLocaleDateString('it-IT')}`;
      }
      
      // Costruisci la query per la ricerca
      let query = {
        type: 'charge',
        status: 'approved'
      };
      
      // Aggiungi il filtro di data solo se non stiamo cercando le "ultime"
      if (startDate && endDate) {
        query.createdAt = { $gte: startDate, $lte: endDate };
      }
      
      // Cerca le ricariche nel database
      const transactions = await Transaction.find(query)
        .sort({ createdAt: -1 })
        .limit(input === 'ultime' ? 10 : 100); // Limita a 10 solo per "ultime", altrimenti recupera fino a 100
      
      // Raccogliamo i dettagli degli utenti per evitare lookup multipli
      const userIds = [...new Set(transactions.map(t => t.userId.toString()))];
      const users = await User.find({ _id: { $in: userIds } });
      const usersMap = users.reduce((map, user) => {
        map[user._id.toString()] = user;
        return map;
      }, {});
      
      // Prepara il messaggio di risposta
      if (transactions.length === 0) {
        delete rechargeHistoryState[telegramId];
        return ctx.reply(
          `📊 Non ci sono ricariche ${dateDescription}.`,
          Markup.removeKeyboard()
        );
      }
      
      // Organizziamo le transazioni in blocchi di 10
      const transactionGroups = [];
      for (let i = 0; i < transactions.length; i += 10) {
        transactionGroups.push(transactions.slice(i, i + 10));
      }
      
      // Salviamo i dati nello stato per la paginazione
      state.transactions = transactions;
      state.transactionGroups = transactionGroups;
      state.dateDescription = dateDescription;
      state.currentPage = 0;
      state.totalTransactions = transactions.length;
      
      // Mostriamo la prima pagina
      await showRechargeHistoryPage(ctx, transactionGroups[0], dateDescription, state.currentPage, transactionGroups.length, usersMap);
      
      // Creiamo i pulsanti di navigazione se ci sono più pagine
      if (transactionGroups.length > 1) {
        return ctx.reply(
          'Usa i pulsanti sotto per navigare tra le pagine:',
          {
            reply_markup: {
              inline_keyboard: [
                generateRechargeHistoryNavigationButtons(state.currentPage, transactionGroups.length)
              ]
            }
          }
        );
      } else {
        // Se c'è solo una pagina, puliamo lo stato
        delete rechargeHistoryState[telegramId];
        return ctx.reply(
          '✅ Ricerca completata.',
          Markup.removeKeyboard()
        );
      }
    }
  } catch (error) {
    const errorCode = generateErrorCode();
    console.error(`Errore [${errorCode}] durante la gestione dell'input per la ricerca ricariche:`, error);
    delete rechargeHistoryState[telegramId];
    return ctx.reply(
      `Si è verificato un errore (codice: ${errorCode}). Per favore, riprova più tardi.`,
      Markup.removeKeyboard()
    );
  }
};

/**
 * Mostra una pagina di ricariche
 */
const showRechargeHistoryPage = async (ctx, transactions, dateDescription, page, totalPages, usersMap) => {
  try {
    let message = `📊 *Ricariche ${dateDescription}*\n`;
    message += `(${transactions.length} ricariche - Pagina ${page + 1}/${totalPages})\n\n`;
    
    for (const transaction of transactions) {
      const user = usersMap[transaction.userId.toString()];
      const userName = user ? `${user.firstName} ${user.lastName}` : 'Utente sconosciuto';
      const cardId = user ? (user.cardId || 'N/D') : 'N/D';
      const date = new Date(transaction.createdAt).toLocaleDateString('it-IT');
      const time = new Date(transaction.createdAt).toLocaleTimeString('it-IT');
      
      message += `🔋 *${escapeMarkdown(userName)}* - ${transaction.amount.toFixed(2)} kWh\n`;
      message += `   💳 Tessera: ${cardId}\n`;
      message += `   📅 Data: ${date} ${time}\n`;
      message += `   💰 Saldo finale: ${transaction.newBalance.toFixed(2)} kWh\n`;
      // Comando copiabile per dettagli utente
      if (user) {
        message += `   📋 \`/admin_dettaglio ${user.telegramId}\`\n`;
      }
      message += `\n`;
    }
    
    return ctx.reply(message, { 
      parse_mode: 'Markdown',
      disable_web_page_preview: true
    });
  } catch (error) {
    const errorCode = generateErrorCode();
    console.error(`Errore [${errorCode}] durante la visualizzazione della pagina di ricariche:`, error);
    return ctx.reply(`Si è verificato un errore (codice: ${errorCode}). Per favore, riprova più tardi.`);
  }
};

/**
 * Genera i pulsanti di navigazione per la cronologia delle ricariche
 */
const generateRechargeHistoryNavigationButtons = (currentPage, totalPages) => {
  const buttons = [];
  
  if (currentPage > 0) {
    buttons.push(Markup.button.callback('⬅️ Precedente', `recharge_history_page_${currentPage - 1}`));
  }
  
  if (currentPage < totalPages - 1) {
    buttons.push(Markup.button.callback('➡️ Successiva', `recharge_history_page_${currentPage + 1}`));
  }
  
  buttons.push(Markup.button.callback('🚫 Chiudi', 'recharge_history_close'));
  buttons.push(Markup.button.callback('📥 Esporta CSV', 'recharge_history_export'));
  
  return buttons;
};

/**
 * Naviga tra le pagine della cronologia delle ricariche
 */
const navigateRechargeHistory = async (ctx, page) => {
  try {
    const telegramId = ctx.from.id;
    
    // Controlla se esiste uno stato valido
    if (!rechargeHistoryState[telegramId] || !rechargeHistoryState[telegramId].transactionGroups) {
      return ctx.answerCbQuery('Sessione scaduta. Per favore, avvia una nuova ricerca.');
    }
    
    const state = rechargeHistoryState[telegramId];
    // Aggiorna timestamp attività
    state.lastActivity = Date.now();
    
    // Verifica che la pagina richiesta sia valida
    if (page < 0 || page >= state.transactionGroups.length) {
      return ctx.answerCbQuery('Pagina non valida');
    }
    
    // Aggiorna la pagina corrente
    state.currentPage = page;
    
    // Recupera gli utenti per questa pagina
    const transactions = state.transactionGroups[page];
    const userIds = [...new Set(transactions.map(t => t.userId.toString()))];
    const users = await User.find({ _id: { $in: userIds } });
    const usersMap = users.reduce((map, user) => {
      map[user._id.toString()] = user;
      return map;
    }, {});
    
    // Mostra la pagina richiesta
    await showRechargeHistoryPage(ctx, transactions, state.dateDescription, page, state.transactionGroups.length, usersMap);
    
    // Aggiorna i pulsanti di navigazione
    await ctx.editMessageReplyMarkup({
      inline_keyboard: [
        generateRechargeHistoryNavigationButtons(page, state.transactionGroups.length)
      ]
    });
    
    return ctx.answerCbQuery();
  } catch (error) {
    const errorCode = generateErrorCode();
    console.error(`Errore [${errorCode}] durante la navigazione della cronologia ricariche:`, error);
    return ctx.answerCbQuery(`Si è verificato un errore (${errorCode})`);
  }
};

/**
 * Chiude la visualizzazione della cronologia delle ricariche
 */
const closeRechargeHistory = async (ctx) => {
  try {
    const telegramId = ctx.from.id;
    
    // Controlla se esiste uno stato valido
    if (rechargeHistoryState[telegramId]) {
      delete rechargeHistoryState[telegramId];
    }
    
    // Modifica il messaggio per rimuovere i pulsanti
    await ctx.editMessageText('📊 Visualizzazione ricariche chiusa');
    return ctx.answerCbQuery('Visualizzazione chiusa');
  } catch (error) {
    const errorCode = generateErrorCode();
    console.error(`Errore [${errorCode}] durante la chiusura della cronologia ricariche:`, error);
    return ctx.answerCbQuery(`Si è verificato un errore (${errorCode})`);
  }
};

/**
 * Esporta le ricariche in formato CSV
 */
const exportRechargeHistory = async (ctx) => {
  try {
    const telegramId = ctx.from.id;
    
    // Controlla se esiste uno stato valido
    if (!rechargeHistoryState[telegramId] || !rechargeHistoryState[telegramId].transactions) {
      return ctx.answerCbQuery('Sessione scaduta. Per favore, avvia una nuova ricerca.');
    }
    
    const state = rechargeHistoryState[telegramId];
    // Aggiorna timestamp attività
    state.lastActivity = Date.now();
    
    const transactions = state.transactions;
    
    // Recupera tutti gli utenti coinvolti
    const userIds = [...new Set(transactions.map(t => t.userId.toString()))];
    const users = await User.find({ _id: { $in: userIds } });
    const usersMap = users.reduce((map, user) => {
      map[user._id.toString()] = user;
      return map;
    }, {});
    
    // Crea l'intestazione del CSV
    let csvContent = 'Data,Ora,Nome,Cognome,Tessera ID,Importo,Saldo Precedente,Saldo Finale,Note\n';
    
    // Aggiungi i dati di ogni transazione
    for (const transaction of transactions) {
      const user = usersMap[transaction.userId.toString()] || { firstName: 'Unknown', lastName: 'User', cardId: 'N/D' };
      const date = new Date(transaction.createdAt).toLocaleDateString('it-IT');
      const time = new Date(transaction.createdAt).toLocaleTimeString('it-IT');
      const firstName = sanitizeString(user.firstName).replace(/"/g, '""');
      const lastName = sanitizeString(user.lastName).replace(/"/g, '""');
      const notes = transaction.notes ? sanitizeString(transaction.notes).replace(/"/g, '""') : '';
      
      const row = [
        date,
        time,
        `"${firstName}"`,
        `"${lastName}"`,
        user.cardId || 'N/D',
        transaction.amount.toFixed(2),
        transaction.previousBalance.toFixed(2),
        transaction.newBalance.toFixed(2),
        `"${notes}"`
      ];
      
      csvContent += row.join(',') + '\n';
    }
    
    // Invia il file CSV
    const buffer = Buffer.from(csvContent, 'utf8');
    
    // Crea un nome di file descrittivo
    let filename;
    if (state.dateDescription.includes('oggi')) {
      filename = `ricariche_oggi_${new Date().toISOString().slice(0, 10)}.csv`;
    } else if (state.dateDescription.includes('ieri')) {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      filename = `ricariche_ieri_${yesterday.toISOString().slice(0, 10)}.csv`;
    } else if (state.dateDescription.includes('settimana')) {
      filename = `ricariche_ultima_settimana_${new Date().toISOString().slice(0, 10)}.csv`;
    } else if (state.dateDescription.includes('mese')) {
      filename = `ricariche_ultimo_mese_${new Date().toISOString().slice(0, 10)}.csv`;
    } else if (state.dateDescription.includes('ultime')) {
      filename = `ultime_ricariche_${new Date().toISOString().slice(0, 10)}.csv`;
    } else {
      // Per date specifiche
      filename = `ricariche_${state.dateDescription.replace(/del /g, '').replace(/\//g, '-')}.csv`;
    }
    
    // Pulisci lo stato
    delete rechargeHistoryState[telegramId];
    
    return ctx.replyWithDocument({ 
      source: buffer, 
      filename: filename 
    }, {
      caption: `📊 Esportazione completata: ${transactions.length} ricariche ${state.dateDescription}`
    });
  } catch (error) {
    const errorCode = generateErrorCode();
    console.error(`Errore [${errorCode}] durante l'esportazione delle ricariche:`, error);
    return ctx.answerCbQuery(`Si è verificato un errore (${errorCode})`);
  }
};

/**
 * Avvia il processo di ricerca degli utilizzi
 */
const startUsageHistory = async (ctx) => {
  try {
    const telegramId = ctx.from.id;
    
    // Inizializza lo stato di ricerca degli utilizzi
    usageHistoryState[telegramId] = { 
      step: 'waitingForDate',
      lastActivity: Date.now()
    };
    
    return ctx.reply(
      '📊 *Ricerca utilizzi kWh*\n\n' +
      'Scegli un\'opzione per visualizzare gli utilizzi:\n\n' +
      '1. "oggi" - Visualizza gli utilizzi di oggi\n' +
      '2. "ieri" - Visualizza gli utilizzi di ieri\n' +
      '3. "settimana" - Visualizza gli utilizzi dell\'ultima settimana\n' +
      '4. "mese" - Visualizza gli utilizzi dell\'ultimo mese\n' +
      '5. "GG/MM/AAAA" - Inserisci una data specifica (es. 15/05/2025)\n\n' +
      'Per visualizzare gli ultimi 10 utilizzi indipendentemente dalla data, scrivi "ultimi"',
      { 
        parse_mode: 'Markdown',
        ...Markup.keyboard([['oggi', 'ieri', 'settimana'], ['mese', 'ultimi'], ['❌ Annulla']])
          .oneTime()
          .resize()
      }
    );
  } catch (error) {
    const errorCode = generateErrorCode();
    console.error(`Errore [${errorCode}] durante l'avvio della ricerca utilizzi:`, error);
    return ctx.reply(`Si è verificato un errore (codice: ${errorCode}). Per favore, riprova più tardi.`);
  }
};

/**
 * Gestisce l'input durante la ricerca degli utilizzi
 */
const handleUsageHistoryInput = async (ctx) => {
  try {
    const telegramId = ctx.from.id;
    const input = ctx.message.text.toLowerCase();
    
    // Controlla se l'amministratore è in processo di ricerca utilizzi
    if (!usageHistoryState[telegramId]) {
      return;
    }
    
    const state = usageHistoryState[telegramId];
    // Aggiorna il timestamp di attività
    state.lastActivity = Date.now();
    
    // Gestione dell'annullamento
    if (input === '❌ annulla') {
      delete usageHistoryState[telegramId];
      return ctx.reply(
        '❌ Operazione annullata.',
        Markup.removeKeyboard()
      );
    }
    
    // Gestione dell'input della data
    if (state.step === 'waitingForDate') {
      let startDate, endDate, dateDescription;
      const now = new Date();
      now.setHours(23, 59, 59, 999); // Fine della giornata corrente
      
      if (input === 'oggi') {
        startDate = new Date();
        startDate.setHours(0, 0, 0, 0); // Inizio della giornata corrente
        endDate = now;
        dateDescription = 'oggi';
      } else if (input === 'ieri') {
        startDate = new Date();
        startDate.setDate(startDate.getDate() - 1);
        startDate.setHours(0, 0, 0, 0); // Inizio di ieri
        endDate = new Date();
        endDate.setDate(endDate.getDate() - 1);
        endDate.setHours(23, 59, 59, 999); // Fine di ieri
        dateDescription = 'ieri';
      } else if (input === 'settimana') {
        startDate = new Date();
        startDate.setDate(startDate.getDate() - 7);
        startDate.setHours(0, 0, 0, 0); // Inizio di 7 giorni fa
        endDate = now;
        dateDescription = 'dell\'ultima settimana';
      } else if (input === 'mese') {
        startDate = new Date();
        startDate.setMonth(startDate.getMonth() - 1);
        startDate.setHours(0, 0, 0, 0); // Inizio di 30 giorni fa
        endDate = now;
        dateDescription = 'dell\'ultimo mese';
      } else if (input === 'ultimi') {
        // Per gli ultimi 10 utilizzi, non impostiamo date specifiche
        startDate = null;
        endDate = null;
        dateDescription = 'ultimi 10 utilizzi';
      } else {
        // Tentativo di interpretare una data specifica
        const dateResult = sanitizeDate(input);
        if (!dateResult.valid) {
          return ctx.reply('⚠️ Formato data non valido. Utilizza GG/MM/AAAA o scegli un\'opzione predefinita:');
        }
        
        startDate = dateResult.date;
        startDate.setHours(0, 0, 0, 0); // Inizio della giornata
        endDate = new Date(startDate);
        endDate.setHours(23, 59, 59, 999); // Fine della giornata
        dateDescription = `del ${startDate.toLocaleDateString('it-IT')}`;
      }
      
      // Costruisci la query per la ricerca
      let query = {
        type: 'usage',
        status: 'approved'
      };
      
      // Aggiungi il filtro di data solo se non stiamo cercando gli "ultimi"
      if (startDate && endDate) {
        query.createdAt = { $gte: startDate, $lte: endDate };
      }
      
      // Cerca gli utilizzi nel database
      const transactions = await Transaction.find(query)
        .sort({ createdAt: -1 })
        .limit(input === 'ultimi' ? 10 : 100); // Limita a 10 solo per "ultimi", altrimenti recupera fino a 100
      
      // Raccogliamo i dettagli degli utenti per evitare lookup multipli
      const userIds = [...new Set(transactions.map(t => t.userId.toString()))];
      const users = await User.find({ _id: { $in: userIds } });
      const usersMap = users.reduce((map, user) => {
        map[user._id.toString()] = user;
        return map;
      }, {});
      
      // Prepara il messaggio di risposta
      if (transactions.length === 0) {
        delete usageHistoryState[telegramId];
        return ctx.reply(
          `📊 Non ci sono utilizzi ${dateDescription}.`,
          Markup.removeKeyboard()
        );
      }
      
      // Organizziamo le transazioni in blocchi di 10
      const transactionGroups = [];
      for (let i = 0; i < transactions.length; i += 10) {
        transactionGroups.push(transactions.slice(i, i + 10));
      }
      
      // Salviamo i dati nello stato per la paginazione
      state.transactions = transactions;
      state.transactionGroups = transactionGroups;
      state.dateDescription = dateDescription;
      state.currentPage = 0;
      state.totalTransactions = transactions.length;
      
      // Mostriamo la prima pagina
      await showUsageHistoryPage(ctx, transactionGroups[0], dateDescription, state.currentPage, transactionGroups.length, usersMap);
      
      // Creiamo i pulsanti di navigazione se ci sono più pagine
      if (transactionGroups.length > 1) {
        return ctx.reply(
          'Usa i pulsanti sotto per navigare tra le pagine:',
          {
            reply_markup: {
              inline_keyboard: [
                generateUsageHistoryNavigationButtons(state.currentPage, transactionGroups.length)
              ]
            }
          }
        );
      } else {
        // Se c'è solo una pagina, puliamo lo stato
        delete usageHistoryState[telegramId];
        return ctx.reply(
          '✅ Ricerca completata.',
          Markup.removeKeyboard()
        );
      }
    }
  } catch (error) {
    const errorCode = generateErrorCode();
    console.error(`Errore [${errorCode}] durante la gestione dell'input per la ricerca utilizzi:`, error);
    delete usageHistoryState[telegramId];
    return ctx.reply(
      `Si è verificato un errore (codice: ${errorCode}). Per favore, riprova più tardi.`,
      Markup.removeKeyboard()
    );
  }
};

/**
 * Mostra una pagina di utilizzi
 */
const showUsageHistoryPage = async (ctx, transactions, dateDescription, page, totalPages, usersMap) => {
  try {
    let message = `📊 *Utilizzi kWh ${dateDescription}*\n`;
    message += `(${transactions.length} utilizzi - Pagina ${page + 1}/${totalPages})\n\n`;
    
    for (const transaction of transactions) {
      const user = usersMap[transaction.userId.toString()];
      const userName = user ? `${user.firstName} ${user.lastName}` : 'Utente sconosciuto';
      const cardId = user ? (user.cardId || 'N/D') : 'N/D';
      const date = new Date(transaction.createdAt).toLocaleDateString('it-IT');
      const time = new Date(transaction.createdAt).toLocaleTimeString('it-IT');
      
      message += `⚡ *${escapeMarkdown(userName)}* - ${transaction.amount.toFixed(2)} kWh\n`;
      message += `   💳 Tessera: ${cardId}\n`;
      message += `   📅 Data: ${date} ${time}\n`;
      message += `   💰 Saldo finale: ${transaction.newBalance.toFixed(2)} kWh\n`;
      
      // Aggiungi note se presenti
      if (transaction.notes && transaction.notes.length > 0) {
        message += `   📝 Note: ${escapeMarkdown(transaction.notes)}\n`;
      }
      
      // Comando copiabile per dettagli utente
      if (user) {
        message += `   📋 \`/admin_dettaglio ${user.telegramId}\`\n`;
      }
      
      message += `\n`;
    }
    
    return ctx.reply(message, { 
      parse_mode: 'Markdown',
      disable_web_page_preview: true
    });
  } catch (error) {
    const errorCode = generateErrorCode();
    console.error(`Errore [${errorCode}] durante la visualizzazione della pagina di utilizzi:`, error);
    return ctx.reply(`Si è verificato un errore (codice: ${errorCode}). Per favore, riprova più tardi.`);
  }
};

/**
 * Genera i pulsanti di navigazione per la cronologia degli utilizzi
 */
const generateUsageHistoryNavigationButtons = (currentPage, totalPages) => {
  const buttons = [];
  
  if (currentPage > 0) {
    buttons.push(Markup.button.callback('⬅️ Precedente', `usage_history_page_${currentPage - 1}`));
  }
  
  if (currentPage < totalPages - 1) {
    buttons.push(Markup.button.callback('➡️ Successiva', `usage_history_page_${currentPage + 1}`));
  }
  
  buttons.push(Markup.button.callback('🚫 Chiudi', 'usage_history_close'));
  buttons.push(Markup.button.callback('📥 Esporta CSV', 'usage_history_export'));
  
  return buttons;
};

/**
 * Naviga tra le pagine della cronologia degli utilizzi
 */
const navigateUsageHistory = async (ctx, page) => {
  try {
    const telegramId = ctx.from.id;
    
    // Controlla se esiste uno stato valido
    if (!usageHistoryState[telegramId] || !usageHistoryState[telegramId].transactionGroups) {
      return ctx.answerCbQuery('Sessione scaduta. Per favore, avvia una nuova ricerca.');
    }
    
    const state = usageHistoryState[telegramId];
    // Aggiorna timestamp attività
    state.lastActivity = Date.now();
    
    // Verifica che la pagina richiesta sia valida
    if (page < 0 || page >= state.transactionGroups.length) {
      return ctx.answerCbQuery('Pagina non valida');
    }
    
    // Aggiorna la pagina corrente
    state.currentPage = page;
    
    // Recupera gli utenti per questa pagina
    const transactions = state.transactionGroups[page];
    const userIds = [...new Set(transactions.map(t => t.userId.toString()))];
    const users = await User.find({ _id: { $in: userIds } });
    const usersMap = users.reduce((map, user) => {
      map[user._id.toString()] = user;
      return map;
    }, {});
    
    // Mostra la pagina richiesta
    await showUsageHistoryPage(ctx, transactions, state.dateDescription, page, state.transactionGroups.length, usersMap);
    
    // Aggiorna i pulsanti di navigazione
    await ctx.editMessageReplyMarkup({
      inline_keyboard: [
        generateUsageHistoryNavigationButtons(page, state.transactionGroups.length)
      ]
    });
    
    return ctx.answerCbQuery();
  } catch (error) {
    const errorCode = generateErrorCode();
    console.error(`Errore [${errorCode}] durante la navigazione della cronologia utilizzi:`, error);
    return ctx.answerCbQuery(`Si è verificato un errore (${errorCode})`);
  }
};

/**
 * Chiude la visualizzazione della cronologia degli utilizzi
 */
const closeUsageHistory = async (ctx) => {
  try {
    const telegramId = ctx.from.id;
    
    // Controlla se esiste uno stato valido
    if (usageHistoryState[telegramId]) {
      delete usageHistoryState[telegramId];
    }
    
    // Modifica il messaggio per rimuovere i pulsanti
    await ctx.editMessageText('📊 Visualizzazione utilizzi chiusa');
    return ctx.answerCbQuery('Visualizzazione chiusa');
  } catch (error) {
    const errorCode = generateErrorCode();
    console.error(`Errore [${errorCode}] durante la chiusura della cronologia utilizzi:`, error);
    return ctx.answerCbQuery(`Si è verificato un errore (${errorCode})`);
  }
};

/**
 * Esporta gli utilizzi in formato CSV
 */
const exportUsageHistory = async (ctx) => {
  try {
    const telegramId = ctx.from.id;
    
    // Controlla se esiste uno stato valido
    if (!usageHistoryState[telegramId] || !usageHistoryState[telegramId].transactions) {
      return ctx.answerCbQuery('Sessione scaduta. Per favore, avvia una nuova ricerca.');
    }
    
    const state = usageHistoryState[telegramId];
    // Aggiorna timestamp attività
    state.lastActivity = Date.now();
    
    const transactions = state.transactions;
    
    // Recupera tutti gli utenti coinvolti
    const userIds = [...new Set(transactions.map(t => t.userId.toString()))];
    const users = await User.find({ _id: { $in: userIds } });
    const usersMap = users.reduce((map, user) => {
      map[user._id.toString()] = user;
      return map;
    }, {});
    
    // Crea l'intestazione del CSV
    let csvContent = 'Data,Ora,Nome,Cognome,Tessera ID,Utilizzo kWh,Saldo Precedente,Saldo Finale,Note\n';
    
    // Aggiungi i dati di ogni transazione
    for (const transaction of transactions) {
      const user = usersMap[transaction.userId.toString()] || { firstName: 'Unknown', lastName: 'User', cardId: 'N/D' };
      const date = new Date(transaction.createdAt).toLocaleDateString('it-IT');
      const time = new Date(transaction.createdAt).toLocaleTimeString('it-IT');
      const firstName = sanitizeString(user.firstName).replace(/"/g, '""');
      const lastName = sanitizeString(user.lastName).replace(/"/g, '""');
      const notes = transaction.notes ? sanitizeString(transaction.notes).replace(/"/g, '""') : '';
      
      const row = [
        date,
        time,
        `"${firstName}"`,
        `"${lastName}"`,
        user.cardId || 'N/D',
        transaction.amount.toFixed(2),
        transaction.previousBalance.toFixed(2),
        transaction.newBalance.toFixed(2),
        `"${notes}"`
      ];
      
      csvContent += row.join(',') + '\n';
    }
    
    // Invia il file CSV
    const buffer = Buffer.from(csvContent, 'utf8');
    
    // Crea un nome di file descrittivo
    let filename;
    if (state.dateDescription.includes('oggi')) {
      filename = `utilizzi_oggi_${new Date().toISOString().slice(0, 10)}.csv`;
    } else if (state.dateDescription.includes('ieri')) {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      filename = `utilizzi_ieri_${yesterday.toISOString().slice(0, 10)}.csv`;
    } else if (state.dateDescription.includes('settimana')) {
      filename = `utilizzi_ultima_settimana_${new Date().toISOString().slice(0, 10)}.csv`;
    } else if (state.dateDescription.includes('mese')) {
      filename = `utilizzi_ultimo_mese_${new Date().toISOString().slice(0, 10)}.csv`;
    } else if (state.dateDescription.includes('ultimi')) {
      filename = `ultimi_utilizzi_${new Date().toISOString().slice(0, 10)}.csv`;
    } else {
      // Per date specifiche
      filename = `utilizzi_${state.dateDescription.replace(/del /g, '').replace(/\//g, '-')}.csv`;
    }
    
    // Pulisci lo stato
    delete usageHistoryState[telegramId];
    
    return ctx.replyWithDocument({ 
      source: buffer, 
      filename: filename 
    }, {
      caption: `📊 Esportazione completata: ${transactions.length} utilizzi ${state.dateDescription}`
    });
  } catch (error) {
    const errorCode = generateErrorCode();
    console.error(`Errore [${errorCode}] durante l'esportazione degli utilizzi:`, error);
    return ctx.answerCbQuery(`Si è verificato un errore (${errorCode})`);
  }
};

/**
 * Avvia il processo di ricerca utenti con saldo basso
 */
const startLowBalanceSearch = async (ctx) => {
  try {
    const telegramId = ctx.from.id;
    
    // Inizializza lo stato della ricerca
    lowBalanceState[telegramId] = { 
      step: 'waitingForThreshold',
      lastActivity: Date.now()
    };
    
    return ctx.reply(
      '📊 *Ricerca utenti con saldo basso*\n\n' +
      'Inserisci il valore di soglia in kWh per cui vuoi visualizzare gli utenti con saldo inferiore:',
      { 
        parse_mode: 'Markdown',
        ...Markup.keyboard([['❌ Annulla']])
          .oneTime()
          .resize()
      }
    );
  } catch (error) {
    const errorCode = generateErrorCode();
    console.error(`Errore [${errorCode}] durante l'avvio della ricerca saldi bassi:`, error);
    return ctx.reply(`Si è verificato un errore (codice: ${errorCode}). Per favore, riprova più tardi.`);
  }
};

/**
 * Gestisce l'input durante la ricerca di saldi bassi
 */
const handleLowBalanceInput = async (ctx) => {
  try {
    const telegramId = ctx.from.id;
    const input = ctx.message.text;
    
    // Controlla se l'amministratore è in processo di ricerca saldi bassi
    if (!lowBalanceState[telegramId]) {
      return;
    }
    
    const state = lowBalanceState[telegramId];
    // Aggiorna il timestamp di attività
    state.lastActivity = Date.now();
    
    // Gestione dell'annullamento
    if (input === '❌ Annulla') {
      delete lowBalanceState[telegramId];
      return ctx.reply(
        '❌ Operazione annullata.',
        Markup.removeKeyboard()
      );
    }
    
    // Gestione della soglia
    if (state.step === 'waitingForThreshold') {
      // Verifica che l'input sia un numero valido
      const threshold = sanitizeAmount(input, 10000); // Usa un limite più alto per le soglie
      
      if (!threshold) {
        return ctx.reply('⚠️ Inserisci un valore numerico positivo valido (massimo 10000 kWh):');
      }
      
      // Salva la soglia
      state.threshold = threshold;
      
      // Cerca gli utenti con saldo inferiore alla soglia
      const users = await User.find({ 
        balance: { $lt: threshold },
        status: 'active' // Solo utenti attivi
      }).sort({ balance: 1 }); // Ordina per saldo crescente
      
      if (users.length === 0) {
        delete lowBalanceState[telegramId];
        return ctx.reply(
          `✅ Non ci sono utenti con saldo inferiore a ${threshold} kWh.`,
          Markup.removeKeyboard()
        );
      }
      
      // Salva gli utenti nell'oggetto di stato
      state.users = users;
      
      // Rimuovi la tastiera precedente e mostra i pulsanti inline per scegliere come visualizzare i risultati
      return ctx.reply(
        `📊 Trovati ${users.length} utenti con saldo inferiore a ${threshold} kWh.\n\n` +
        'Come preferisci visualizzare i risultati?',
        {
          reply_markup: {
            inline_keyboard: [
              [
                { text: '📋 Visualizza elenco', callback_data: 'low_balance_show_list' },
                { text: '📥 Scarica file CSV', callback_data: 'low_balance_csv' }
              ],
              [
                { text: '❌ Annulla', callback_data: 'low_balance_cancel' }
              ]
            ],
            remove_keyboard: true
          }
        }
      );
    }
  } catch (error) {
    const errorCode = generateErrorCode();
    console.error(`Errore [${errorCode}] durante la gestione dell'input per la ricerca saldi bassi:`, error);
    delete lowBalanceState[telegramId];
    return ctx.reply(
      `Si è verificato un errore (codice: ${errorCode}). Per favore, riprova più tardi.`,
      Markup.removeKeyboard()
    );
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

/**
 * Crea direttamente un nuovo codice di invito
 */
const startInviteCodeCreation = async (ctx) => {
  try {
    const telegramId = ctx.from.id;
    
    // Genera un codice casuale (solo lettere maiuscole e numeri)
    const code = Math.random().toString(36).substring(2, 8).toUpperCase();
    
    // Inizializza lo stato per le note opzionali
    inviteCodeState[telegramId] = { 
      step: 'waitingForNotes',
      code: code,
      lastActivity: Date.now()
    };
    
    return ctx.reply(
      '🔑 *Codice di invito generato*\n\n' +
      `Codice: \`${code}\`\n\n` +
      'Se lo desideri, puoi aggiungere una nota (opzionale). Altrimenti, invia "Nessuna nota".',
      {
        parse_mode: 'Markdown',
        ...Markup.keyboard([['Nessuna nota'], ['❌ Annulla']])
          .oneTime()
          .resize()
      }
    );
  } catch (error) {
    const errorCode = generateErrorCode();
    console.error(`Errore [${errorCode}] durante la creazione del codice di invito:`, error);
    return ctx.reply(`Si è verificato un errore (codice: ${errorCode}). Per favore, riprova più tardi.`);
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
    // Aggiorna il timestamp di attività
    state.lastActivity = Date.now();
    
    // Gestione dell'annullamento
    if (input === '❌ Annulla') {
      delete inviteCodeState[telegramId];
      return ctx.reply(
        '❌ Operazione annullata.',
        Markup.removeKeyboard()
      );
    }
    
    // Gestione delle note
    if (state.step === 'waitingForNotes') {
      // Sanitizza le note
      state.notes = sanitizeString(input === 'Nessuna nota' ? '' : input);
      
      // Crea il codice di invito
      // Prima trova l'utente dal telegramId
      const adminUser = await User.findOne({ telegramId });
      
      if (!adminUser) {
        return ctx.reply(
          '⚠️ Errore: impossibile identificare l\'utente amministratore.',
          Markup.removeKeyboard()
        );
      }
      
      const invite = new Invite({
        code: state.code,
        createdBy: adminUser._id,
        notes: state.notes
      });
      
      await invite.save();
      
      // Cancella lo stato di creazione del codice di invito
      delete inviteCodeState[telegramId];
      
      // Conferma all'amministratore
      return ctx.reply(
        '✅ Codice di invito creato con successo!\n\n' +
        `🔑 Codice: \`${invite.code}\`\n` +
        `📅 Scadenza: ${new Date(invite.expiresAt).toLocaleDateString('it-IT')}\n` +
        (invite.notes ? `📝 Note: ${invite.notes}\n` : ''),
        {
          parse_mode: 'Markdown',
          ...Markup.removeKeyboard()
        }
      );
    }
  } catch (error) {
    const errorCode = generateErrorCode();
    console.error(`Errore [${errorCode}] durante la gestione dell'input del codice di invito:`, error);
    return ctx.reply(
      `Si è verificato un errore (codice: ${errorCode}). Per favore, riprova più tardi.`,
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
      
      message += `🔑 *Codice: ${escapeMarkdown(invite.code)}*\n`;
      message += `📊 Stato: ${status}\n`;
      message += `📅 Validità: ${expiryStatus}\n`;
      message += `📅 Scadenza: ${new Date(invite.expiresAt).toLocaleDateString('it-IT')}\n`;
      
      if (invite.isUsed && invite.usedBy) {
        message += `👤 Utilizzato da: ${invite.usedBy}\n`;
        message += `📅 Data utilizzo: ${new Date(invite.usedAt).toLocaleDateString('it-IT')}\n`;
      }
      
      if (invite.notes) {
        message += `📝 Note: ${escapeMarkdown(invite.notes)}\n`;
      }
      
      message += '\n';
    }
    
    return ctx.reply(message, { 
      parse_mode: 'Markdown'
    });
  } catch (error) {
    const errorCode = generateErrorCode();
    console.error(`Errore [${errorCode}] durante la richiesta della lista dei codici di invito:`, error);
    return ctx.reply(`Si è verificato un errore (codice: ${errorCode}). Per favore, riprova più tardi.`);
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
    const errorCode = generateErrorCode();
    console.error(`Errore [${errorCode}] durante la richiesta delle statistiche:`, error);
    return ctx.reply(`Si è verificato un errore (codice: ${errorCode}). Per favore, riprova più tardi.`);
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
    
    const cardId = sanitizeCardId(args[1].trim());
    if (!cardId) {
      return ctx.reply('⚠️ Formato tessera non valido. Per favore, inserisci un ID tessera valido.');
    }
    
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
    const errorCode = generateErrorCode();
    console.error(`Errore [${errorCode}] durante la ricerca dell'utente per tessera:`, error);
    return ctx.reply(`Si è verificato un errore (codice: ${errorCode}). Per favore, riprova più tardi.`);
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
    
    const searchTerm = sanitizeString(args.slice(1).join(' ').trim());
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
        message += `👤 *${escapeMarkdown(user.firstName)} ${escapeMarkdown(user.lastName)}*\n`;
        message += `💳 Tessera ID: ${user.cardId || 'Non impostata'}\n`;
        message += `🆔 ID Telegram: \`${user.telegramId}\`\n`;
        // Aggiunti comandi copiabili
        message += `📋 Dettagli: \`/admin_dettaglio ${user.telegramId}\`\n`;
        // Comando per ricarica per ID
        message += `💸 Ricarica: \`/admin_ricarica ${user.telegramId}\`\n`;
        // Aggiungi comando ricarica per tessera se disponibile
        if (user.cardId) {
          message += `💳 Ricarica tessera: \`/admin_ricarica tessera:${user.cardId}\`\n`;
        }
        message += `\n`;
      }
      
      return ctx.reply(message, { 
        parse_mode: 'Markdown',
        disable_web_page_preview: true
      });
    }
  } catch (error) {
    const errorCode = generateErrorCode();
    console.error(`Errore [${errorCode}] durante la ricerca dell'utente per nome:`, error);
    return ctx.reply(`Si è verificato un errore (codice: ${errorCode}). Per favore, riprova più tardi.`);
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
    
    const telegramId = sanitizeNumericId(args[1].trim());
    
    if (!telegramId) {
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
    const errorCode = generateErrorCode();
    console.error(`Errore [${errorCode}] durante la visualizzazione dei dettagli dell'utente:`, error);
    return ctx.reply(`Si è verificato un errore (codice: ${errorCode}). Per favore, riprova più tardi.`);
  }
};

/**
 * Formatta i dettagli completi di un utente incluse le transazioni recenti
 */
const formatUserDetails = async (user) => {
  // Formatta i dettagli principali dell'utente
  let message = `👤 *DETTAGLI UTENTE*\n\n`;
  message += `*Nome*: ${escapeMarkdown(user.firstName)} ${escapeMarkdown(user.lastName)}\n`;
  message += `*Username*: ${user.username ? '@' + escapeMarkdown(user.username) : 'Non impostato'}\n`;
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
        message += `📝 Note: ${escapeMarkdown(transaction.notes)}\n`;
      }
      message += '\n';
    }
  } else {
    message += '📝 *Nessuna transazione registrata*\n\n';
  }
  
  // Aggiungi comandi rapidi (ora copiabili)
  message += `🔧 *Azioni rapide*:\n`;
  message += `💸 \`/admin_ricarica ${user.telegramId}\` - Per ricaricare per ID\n`;
  // Aggiungi comando ricarica per tessera se disponibile
  if (user.cardId) {
    message += `💳 \`/admin_ricarica tessera:${user.cardId}\` - Per ricaricare per tessera\n`;
  }
  
  if (user.status === 'pending') {
    message += `✅ \`/admin_approva ${user.telegramId}\` - Per approvare l'utente\n`;
  } else if (user.status === 'active') {
    message += `❌ \`/admin_blocca ${user.telegramId}\` - Per bloccare l'utente\n`;
    message += `🚫 \`/admin_disabilita ${user.telegramId}\` - Per disabilitare l'utente\n`;
  } else if (user.status === 'blocked') {
    message += `✅ \`/admin_sblocca ${user.telegramId}\` - Per sbloccare l'utente\n`;
    message += `🚫 \`/admin_disabilita ${user.telegramId}\` - Per disabilitare l'utente\n`;
  } else if (user.status === 'disabled') {
    message += `✅ \`/admin_sblocca ${user.telegramId}\` - Per riattivare l'utente\n`;
  }
  
  message += `🗑️ \`/admin_elimina ${user.telegramId}\` - Per eliminare l'utente\n`;
  
  if (!user.isAdmin) {
    message += `👑 \`/admin_make_admin ${user.telegramId}\` - Per promuovere l'utente ad amministratore\n`;
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
      // Sanitizza i valori per il CSV
      const firstName = sanitizeString(user.firstName).replace(/"/g, '""'); // Escape le virgolette doppie
      const lastName = sanitizeString(user.lastName).replace(/"/g, '""');
      const username = user.username ? sanitizeString(user.username).replace(/"/g, '""') : '';
      
      const row = [
        user.telegramId,
        `"${firstName}"`,
        `"${lastName}"`,
        username ? `"${username}"` : '',
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
    const errorCode = generateErrorCode();
    console.error(`Errore [${errorCode}] durante l'esportazione degli utenti:`, error);
    return ctx.reply(`Si è verificato un errore (codice: ${errorCode}). Per favore, riprova più tardi.`);
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
    
    const telegramId = sanitizeNumericId(args[1].trim());
    
    if (!telegramId) {
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
    const errorCode = generateErrorCode();
    console.error(`Errore [${errorCode}] durante il cambio di stato dell'utente:`, error);
    return ctx.reply(`Si è verificato un errore (codice: ${errorCode}). Per favore, riprova più tardi.`);
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
      const filter = sanitizeString(args[1].toLowerCase());
      
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
      
      message += `👤 *${escapeMarkdown(user.firstName)} ${escapeMarkdown(user.lastName)}*\n`;
      message += `🆔 ID: \`${user.telegramId}\`\n`;
      message += `💳 Tessera: ${user.cardId || 'Non impostata'}\n`;
      message += `💰 Saldo: ${user.balance.toFixed(2)} kWh\n`;
      message += `📊 Stato: ${status}\n`;
      // Aggiunti comandi copiabili
      message += `📋 \`/admin_dettaglio ${user.telegramId}\`\n`;
      // Comando per ricarica per ID
      message += `💸 \`/admin_ricarica ${user.telegramId}\`\n`;
      // Aggiungi comando ricarica per tessera se disponibile
      if (user.cardId) {
        message += `💳 \`/admin_ricarica tessera:${user.cardId}\`\n`;
      }
      message += `\n`;
    }
    
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
    const errorCode = generateErrorCode();
    console.error(`Errore [${errorCode}] durante la richiesta della lista utenti paginata:`, error);
    return ctx.reply(`Si è verificato un errore (codice: ${errorCode}). Per favore, riprova più tardi.`);
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
    
    const telegramId = sanitizeNumericId(args[1].trim());
    
    if (!telegramId) {
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
    const errorCode = generateErrorCode();
    console.error(`Errore [${errorCode}] durante la disabilitazione dell'utente:`, error);
    return ctx.reply(`Si è verificato un errore (codice: ${errorCode}). Per favore, riprova più tardi.`);
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
    
    const telegramId = sanitizeNumericId(args[1].trim());
    
    if (!telegramId) {
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
      `Per confermare, invia: \`/admin_conferma_eliminazione ${telegramId}\``,
      { parse_mode: 'Markdown' }
    );
  } catch (error) {
    const errorCode = generateErrorCode();
    console.error(`Errore [${errorCode}] durante la preparazione dell'eliminazione dell'utente:`, error);
    return ctx.reply(`Si è verificato un errore (codice: ${errorCode}). Per favore, riprova più tardi.`);
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
    
    const telegramId = sanitizeNumericId(args[1].trim());
    
    if (!telegramId) {
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
    const errorCode = generateErrorCode();
    console.error(`Errore [${errorCode}] durante l'eliminazione dell'utente:`, error);
    return ctx.reply(`Si è verificato un errore (codice: ${errorCode}). Per favore, riprova più tardi.`);
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
  
  // Funzioni nuove per i comandi
  makeAdmin,
  updateUserCommands,
  
  // Funzioni per saldi bassi
  startLowBalanceSearch,
  handleLowBalanceInput,
  showUsersPage,
  sendUsersCsv,
  lowBalanceState,
  
  // Funzioni per cronologia ricariche
  startRechargeHistory,
  handleRechargeHistoryInput,
  navigateRechargeHistory,
  closeRechargeHistory,
  exportRechargeHistory,
  rechargeHistoryState,
  
  // Nuove funzioni per admin_utilizzi
  startUsageHistory,
  handleUsageHistoryInput,
  navigateUsageHistory,
  closeUsageHistory,
  exportUsageHistory,
  usageHistoryState
};
