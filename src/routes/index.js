/**
 * Configurazione delle route del bot
 */

const { Markup } = require('telegraf');
const config = require('../config/config');

// Import handlers
const registration = require('../handlers/registration');
const transactions = require('../handlers/transactions');
const admin = require('../handlers/admin');
const user = require('../handlers/user');

// Import middlewares
const { isRegistered, isAdmin } = require('../middlewares/auth');
const { escapeMarkdown } = require('../utils/sanitize');

/**
 * Configura tutte le route del bot
 * @param {Object} bot - Istanza di Telegraf bot
 */
const setupRoutes = (bot) => {
  // Handler per il comando /start (avvia registrazione)
  bot.command('start', registration.startRegistration);

  // Handler per comandi utente (richiedono autenticazione)
  bot.command('help', isRegistered, user.showHelp);
  bot.command('saldo', isRegistered, transactions.getBalance);
  bot.command('cronologia', isRegistered, transactions.getTransactionHistory);
  bot.command('registra_utilizzo', isRegistered, transactions.startUsageRegistration);
  bot.command('profilo', isRegistered, user.showProfile);

  // Handler per comandi admin (richiedono autenticazione come admin)
  bot.command('admin_utenti', isAdmin, admin.getUsersPaginated);
  bot.command('admin_ricarica', isAdmin, admin.startRecharge);
  bot.command('admin_crea_invito', isAdmin, admin.startInviteCodeCreation);
  bot.command('admin_inviti', isAdmin, admin.getInviteCodes);
  bot.command('admin_stats', isAdmin, admin.getStats);
  bot.command('admin_ricariche', isAdmin, admin.startRechargeHistory);
  bot.command('admin_utilizzi', isAdmin, admin.startUsageHistory);

  // Nuovi handler per i comandi admin
  bot.command('admin_trova_tessera', isAdmin, admin.findUserByCard);
  bot.command('admin_trova_utente', isAdmin, admin.findUserByName);
  bot.command('admin_dettaglio', isAdmin, admin.getUserDetails);
  bot.command('admin_esporta_utenti', isAdmin, admin.exportUsers);
  bot.command('admin_approva', isAdmin, admin.approveUser);
  bot.command('admin_blocca', isAdmin, admin.blockUser);
  bot.command('admin_sblocca', isAdmin, admin.unblockUser);

  // Handler per disabilitazione ed eliminazione
  bot.command('admin_disabilita', isAdmin, admin.disableUser);
  bot.command('admin_elimina', isAdmin, admin.deleteUser);
  bot.command('admin_conferma_eliminazione', isAdmin, admin.confirmUserDeletion);

  // Nuovo comando per promuovere un utente ad amministratore
  bot.command('admin_make_admin', isAdmin, admin.makeAdmin);

  // Nuovo comando per aggiornare i comandi del bot
  bot.command('admin_aggiorna_comandi', isAdmin, setupUpdateCommandsHandler(bot));

  // Nuovo comando per la ricerca di utenti con saldo basso
  bot.command('admin_saldi_bassi', isAdmin, admin.startLowBalanceSearch);

  // Handler per il comando /annulla
  bot.command('annulla', setupCancelHandler());

  // Handler per le callback query
  bot.action(/approve_registration:(.+)/, isAdmin, registration.approveRegistration);
  bot.action(/reject_registration:(.+)/, isAdmin, registration.rejectRegistration);
  bot.action(/approve_usage:(.+)/, isAdmin, transactions.approveUsage);
  bot.action(/reject_usage:(.+)/, isAdmin, transactions.rejectUsage);

  // Handler per le callback della ricarica
  bot.action(/confirm_recharge_(\d+)/, isAdmin, admin.confirmRecharge);
  bot.action(/cancel_recharge_(\d+)/, isAdmin, admin.cancelRecharge);

  // Handler per le callback della navigazione ricariche
  bot.action(/recharge_history_page_(\d+)/, setupRechargeHistoryPageHandler());
  bot.action('recharge_history_close', admin.closeRechargeHistory);
  bot.action('recharge_history_export', admin.exportRechargeHistory);

  // Handler per le callback della navigazione utilizzi
  bot.action(/usage_history_page_(\d+)/, setupUsageHistoryPageHandler());
  bot.action('usage_history_close', admin.closeUsageHistory);
  bot.action('usage_history_export', admin.exportUsageHistory);

  // Handler per le callback della navigazione saldi bassi
  bot.action(/low_balance_page_(\d+)/, setupLowBalancePageHandler());
  bot.action('low_balance_csv', setupLowBalanceCsvHandler());
  bot.action('low_balance_show_list', setupLowBalanceShowListHandler());
  bot.action('low_balance_cancel', setupLowBalanceCancelHandler());

  // Handler per le callback della paginazione e filtri utenti
  bot.action(/users_page_(\d+)_(.*)/, setupUsersPageHandler());
  
  // Handler per i filtri utenti
  bot.action('users_filter_all', setupUsersFilterHandler('all'));
  bot.action('users_filter_active', setupUsersFilterHandler('active'));
  bot.action('users_filter_pending', setupUsersFilterHandler('pending'));
  bot.action('users_filter_blocked', setupUsersFilterHandler('blocked'));
  bot.action('users_filter_disabled', setupUsersFilterHandler('disabled'));
  bot.action('users_filter_really_all', setupUsersFilterHandler('really_all'));

  // Handler per messaggi di testo
  bot.on('text', setupTextHandler());

  // Handler per foto (per le transazioni)
  bot.on('photo', setupPhotoHandler());

  // Handler per messaggi non gestiti
  bot.on('message', (ctx) => {
    ctx.reply('Comando non riconosciuto. Usa /help per visualizzare i comandi disponibili.');
  });
};

/**
 * Handler per gli input di testo
 */
const setupTextHandler = () => {
  return async (ctx, next) => {
    const telegramId = ctx.from.id;
    
    // Gestione della registrazione
    if (registration.registrationState[telegramId]) {
      return registration.handleRegistrationInput(ctx);
    }
    
    // Gestione delle transazioni
    if (transactions.transactionState[telegramId]) {
      return transactions.handleTransactionInput(ctx);
    }
    
    // Gestione delle ricariche da admin
    if (admin.rechargeState[telegramId]) {
      return admin.handleRechargeInput(ctx);
    }
    
    // Gestione dei codici di invito da admin
    if (admin.inviteCodeState[telegramId]) {
      return admin.handleInviteCodeInput(ctx);
    }
    
    // Gestione della ricerca saldi bassi
    if (admin.lowBalanceState[telegramId]) {
      return admin.handleLowBalanceInput(ctx);
    }
    
    // Gestione della ricerca cronologia ricariche
    if (admin.rechargeHistoryState[telegramId]) {
      return admin.handleRechargeHistoryInput(ctx);
    }
    
    // Gestione della ricerca cronologia utilizzi
    if (admin.usageHistoryState[telegramId]) {
      return admin.handleUsageHistoryInput(ctx);
    }
    
    // Se nessun handler specifico è stato attivato, passa al middleware successivo
    return next();
  };
};

/**
 * Handler per il caricamento di foto
 */
const setupPhotoHandler = () => {
  return async (ctx) => {
    const telegramId = ctx.from.id;
    
    // Gestione delle foto per le transazioni
    if (transactions.transactionState[telegramId] && transactions.transactionState[telegramId].step === 'waitingForPhoto') {
      return transactions.handlePhotoUpload(ctx);
    }
  };
};

/**
 * Handler per il comando /annulla
 */
const setupCancelHandler = () => {
  return async (ctx) => {
    const telegramId = ctx.from.id;
    
    // Pulisci tutti gli stati per questo utente
    let stateFound = false;
    
    if (registration.registrationState[telegramId]) {
      delete registration.registrationState[telegramId];
      stateFound = true;
    }
    
    if (transactions.transactionState[telegramId]) {
      delete transactions.transactionState[telegramId];
      stateFound = true;
    }
    
    if (admin.rechargeState[telegramId]) {
      delete admin.rechargeState[telegramId];
      stateFound = true;
    }
    
    if (admin.inviteCodeState[telegramId]) {
      delete admin.inviteCodeState[telegramId];
      stateFound = true;
    }
    
    if (admin.lowBalanceState[telegramId]) {
      delete admin.lowBalanceState[telegramId];
      stateFound = true;
    }
    
    if (admin.rechargeHistoryState[telegramId]) {
      delete admin.rechargeHistoryState[telegramId];
      stateFound = true;
    }
    
    if (admin.usageHistoryState[telegramId]) {
      delete admin.usageHistoryState[telegramId];
      stateFound = true;
    }
    
    if (stateFound) {
      return ctx.reply('🚫 Operazione corrente annullata.', Markup.removeKeyboard());
    } else {
      return ctx.reply('ℹ️ Non ci sono operazioni in corso da annullare.');
    }
  };
};

/**
 * Handler per l'aggiornamento dei comandi del bot
 */
const setupUpdateCommandsHandler = (bot) => {
  return async (ctx) => {
    try {
      // Importa i comandi da config
      const { adminCommands, userCommands } = require('../config/commands');
      
      // Imposta comandi globali (utenti normali)
      await bot.telegram.setMyCommands(userCommands);
      
      // Trova tutti gli utenti admin
      const User = require('../database/models/user');
      const adminUsers = await User.find({ isAdmin: true });
      
      // Per ogni admin, imposta i comandi admin
      for (const admin of adminUsers) {
        try {
          await bot.telegram.setMyCommands(adminCommands, { 
            scope: { type: 'chat', chat_id: admin.telegramId } 
          });
        } catch (error) {
          console.error(`Errore nell'impostazione dei comandi per l'admin ${admin.telegramId}:`, error);
        }
      }
      
      return ctx.reply('✅ Comandi bot aggiornati con successo!');
    } catch (error) {
      console.error('Errore durante l\'aggiornamento dei comandi:', error);
      return ctx.reply('Si è verificato un errore. Per favore, riprova più tardi.');
    }
  };
};

/**
 * Handler per la navigazione nella cronologia ricariche
 */
const setupRechargeHistoryPageHandler = () => {
  return async (ctx) => {
    try {
      const page = parseInt(ctx.match[1]);
      await admin.navigateRechargeHistory(ctx, page);
    } catch (error) {
      console.error('Errore durante la navigazione delle pagine della cronologia ricariche:', error);
      return ctx.answerCbQuery('Si è verificato un errore');
    }
  };
};

/**
 * Handler per la navigazione nella cronologia utilizzi
 */
const setupUsageHistoryPageHandler = () => {
  return async (ctx) => {
    try {
      const page = parseInt(ctx.match[1]);
      await admin.navigateUsageHistory(ctx, page);
    } catch (error) {
      console.error('Errore durante la navigazione delle pagine della cronologia utilizzi:', error);
      return ctx.answerCbQuery('Si è verificato un errore');
    }
  };
};

/**
 * Handler per la navigazione nei saldi bassi
 */
const setupLowBalancePageHandler = () => {
  return async (ctx) => {
    try {
      const page = parseInt(ctx.match[1]);
      const telegramId = ctx.from.id;
      
      // Controlla se esiste uno stato valido
      if (!admin.lowBalanceState[telegramId] || !admin.lowBalanceState[telegramId].users) {
        return ctx.answerCbQuery('Sessione scaduta. Per favore, avvia una nuova ricerca.');
      }
      
      const state = admin.lowBalanceState[telegramId];
      // Aggiorna timestamp attività
      state.lastActivity = Date.now();
      
      await admin.showUsersPage(ctx, state.users, state.threshold, page);
      return ctx.answerCbQuery();
    } catch (error) {
      console.error('Errore durante la navigazione delle pagine:', error);
      return ctx.answerCbQuery('Si è verificato un errore');
    }
  };
};

/**
 * Handler per l'esportazione CSV dei saldi bassi
 */
const setupLowBalanceCsvHandler = () => {
  return async (ctx) => {
    try {
      const telegramId = ctx.from.id;
      
      // Controlla se esiste uno stato valido
      if (!admin.lowBalanceState[telegramId] || !admin.lowBalanceState[telegramId].users) {
        return ctx.answerCbQuery('Sessione scaduta. Per favore, avvia una nuova ricerca.');
      }
      
      const state = admin.lowBalanceState[telegramId];
      // Aggiorna timestamp attività
      state.lastActivity = Date.now();
      
      await admin.sendUsersCsv(ctx, state.users, state.threshold);
      return ctx.answerCbQuery();
    } catch (error) {
      console.error('Errore durante la generazione del CSV:', error);
      return ctx.answerCbQuery('Si è verificato un errore');
    }
  };
};

/**
 * Handler per visualizzare la lista dei saldi bassi
 */
const setupLowBalanceShowListHandler = () => {
  return async (ctx) => {
    try {
      const telegramId = ctx.from.id;
      
      // Controlla se esiste uno stato valido
      if (!admin.lowBalanceState[telegramId] || !admin.lowBalanceState[telegramId].users) {
        return ctx.answerCbQuery('Sessione scaduta. Per favore, avvia una nuova ricerca.');
      }
      
      const state = admin.lowBalanceState[telegramId];
      // Aggiorna timestamp attività
      state.lastActivity = Date.now();
      state.currentPage = 0;
      
      await admin.showUsersPage(ctx, state.users, state.threshold, state.currentPage);
      return ctx.answerCbQuery();
    } catch (error) {
      console.error('Errore durante la visualizzazione degli utenti:', error);
      return ctx.answerCbQuery('Si è verificato un errore');
    }
  };
};

/**
 * Handler per annullare la ricerca saldi bassi
 */
const setupLowBalanceCancelHandler = () => {
  return async (ctx) => {
    try {
      const telegramId = ctx.from.id;
      
      // Controlla se esiste uno stato valido
      if (!admin.lowBalanceState[telegramId]) {
        return ctx.answerCbQuery('Nessuna operazione in corso.');
      }
      
      // Cancella lo stato
      delete admin.lowBalanceState[telegramId];
      
      // Modifica il messaggio
      await ctx.editMessageText('❌ Operazione annullata.');
      return ctx.answerCbQuery('Operazione annullata');
    } catch (error) {
      console.error('Errore durante l\'annullamento dell\'operazione:', error);
      return ctx.answerCbQuery('Si è verificato un errore');
    }
  };
};

/**
 * Handler per la paginazione degli utenti
 */
const setupUsersPageHandler = () => {
  return async (ctx) => {
    try {
      const page = parseInt(ctx.match[1]);
      let query = {};
      
      try {
        query = JSON.parse(ctx.match[2]);
      } catch (e) {
        // Se non è un JSON valido, usa un oggetto vuoto
      }
      
      const pageSize = 5;
      const User = require('../database/models/user');
      const totalUsers = await User.countDocuments(query);
      const totalPages = Math.ceil(totalUsers / pageSize);
      
      if (page < 1 || page > totalPages) {
        return ctx.answerCbQuery('Pagina non valida');
      }
      
      const users = await User.find(query)
        .sort({ createdAt: -1 })
        .skip((page - 1) * pageSize)
        .limit(pageSize);
      
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
        // Aggiunto comando copiabile
        message += `📋 \`/admin_dettaglio ${user.telegramId}\`\n`;
        // Aggiunto comando copiabile per ricarica
        message += `💸 \`/admin_ricarica ${user.telegramId}\`\n\n`;
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
      
      await ctx.editMessageText(message, { 
        parse_mode: 'Markdown',
        disable_web_page_preview: true,
        ...Markup.inlineKeyboard(keyboard)
      });
      
      return ctx.answerCbQuery();
    } catch (error) {
      console.error('Errore durante la navigazione delle pagine:', error);
      return ctx.answerCbQuery('Si è verificato un errore');
    }
  };
};

/**
 * Handler per i filtri utenti
 */
const setupUsersFilterHandler = (filterType) => {
  return async (ctx) => {
    try {
      const User = require('../database/models/user');
      
      let query = {};
      let title = '';
      
      switch (filterType) {
        case 'all':
          await ctx.editMessageText('Caricamento utenti...', { parse_mode: 'Markdown' });
          // Questa query esclude gli utenti disabilitati
          query = { status: { $ne: 'disabled' } };
          title = 'Lista di tutti gli utenti attivi';
          break;
        case 'active':
          await ctx.editMessageText('Caricamento utenti attivi...', { parse_mode: 'Markdown' });
          query = { status: 'active' };
          title = 'Lista degli utenti ATTIVI';
          break;
        case 'pending':
          await ctx.editMessageText('Caricamento utenti in attesa...', { parse_mode: 'Markdown' });
          query = { status: 'pending' };
          title = 'Lista degli utenti IN ATTESA';
          break;
        case 'blocked':
          await ctx.editMessageText('Caricamento utenti bloccati...', { parse_mode: 'Markdown' });
          query = { status: 'blocked' };
          title = 'Lista degli utenti BLOCCATI';
          break;
        case 'disabled':
          await ctx.editMessageText('Caricamento utenti disabilitati...', { parse_mode: 'Markdown' });
          query = { status: 'disabled' };
          title = 'Lista degli utenti DISABILITATI';
          break;
        case 'really_all':
          await ctx.editMessageText('Caricamento di tutti gli utenti...', { parse_mode: 'Markdown' });
          query = {}; // Nessun filtro, mostra veramente tutti
          title = 'Lista di TUTTI gli utenti (inclusi disabilitati)';
          break;
        default:
          query = { status: { $ne: 'disabled' } };
          title = 'Lista degli utenti';
      }
      
      const page = 1;
      const pageSize = 5;
      
      const totalUsers = await User.countDocuments(query);
      const totalPages = Math.ceil(totalUsers / pageSize);
      
      const users = await User.find(query)
        .sort({ createdAt: -1 })
        .skip((page - 1) * pageSize)
        .limit(pageSize);
      
      let message = `👥 *${title}*\n`;
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
        
        // Aggiungi stato se non è il filtro attivo
        if (filterType !== 'active' && filterType !== 'pending' && filterType !== 'blocked' && filterType !== 'disabled') {
          message += `📊 Stato: ${status}\n`;
        }
        
        // Aggiunto comando copiabile
        message += `📋 \`/admin_dettaglio ${user.telegramId}\`\n`;
        
        // Comandi specifici in base allo stato
        if (filterType === 'pending') {
          message += `✅ \`/admin_approva ${user.telegramId}\`\n`;
        } else if (filterType === 'blocked') {
          message += `✅ \`/admin_sblocca ${user.telegramId}\`\n`;
        } else if (filterType === 'disabled') {
          message += `✅ \`/admin_sblocca ${user.telegramId}\`\n`;
        } else if (user.status !== 'disabled') {
          // Aggiunto comando copiabile per ricarica se non disabilitato
          message += `💸 \`/admin_ricarica ${user.telegramId}\`\n`;
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
      
      await ctx.editMessageText(message, { 
        parse_mode: 'Markdown',
        disable_web_page_preview: true,
        ...Markup.inlineKeyboard(keyboard)
      });
      
      return ctx.answerCbQuery();
    } catch (error) {
      console.error(`Errore durante il filtro degli utenti (${filterType}):`, error);
      return ctx.answerCbQuery('Si è verificato un errore');
    }
  };
};

module.exports = setupRoutes;
