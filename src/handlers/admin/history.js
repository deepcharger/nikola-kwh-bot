/**
 * Gestione della cronologia ricariche e utilizzi
 */

const { Markup } = require('telegraf');
const User = require('../../database/models/user');
const Transaction = require('../../database/models/transaction');
const { 
  sanitizeString,
  sanitizeDate,
  escapeMarkdown,
  generateErrorCode 
} = require('../../utils/sanitize');
const { rechargeHistoryState, usageHistoryState } = require('./states');

// CRONOLOGIA RICARICHE

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

// CRONOLOGIA UTILIZZI

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

module.exports = {
  startRechargeHistory,
  handleRechargeHistoryInput,
  navigateRechargeHistory,
  closeRechargeHistory,
  exportRechargeHistory,
  startUsageHistory,
  handleUsageHistoryInput,
  navigateUsageHistory,
  closeUsageHistory,
  exportUsageHistory
};
