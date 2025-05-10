/**
 * File principale del bot Telegram di Nikola kWh Manager
 */

const { Telegraf, Scenes, session, Markup } = require('telegraf');
const config = require('./config/config');
const connectDB = require('./database/connection');
const User = require('./database/models/user');

// Import handlers
const { 
  startRegistration, 
  handleRegistrationInput,
  approveRegistration,
  rejectRegistration,
  registrationState
} = require('./handlers/registration');

const { 
  startUsageRegistration,
  startPhotoUpload,
  handleTransactionInput,
  handlePhotoUpload,
  approveUsage,
  rejectUsage,
  getBalance,
  getTransactionHistory,
  transactionState
} = require('./handlers/transactions');

const {
  getUsers,
  startRecharge,
  handleRechargeInput,
  startInviteCodeCreation,
  handleInviteCodeInput,
  getInviteCodes,
  getStats,
  rechargeState,
  inviteCodeState,
  // Funzioni per i pulsanti di conferma ricarica
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
  // Nuove funzioni per cronologia utilizzi
  startUsageHistory,
  handleUsageHistoryInput,
  navigateUsageHistory,
  closeUsageHistory,
  exportUsageHistory,
  usageHistoryState
} = require('./handlers/admin');

const {
  showHelp,
  showProfile
} = require('./handlers/user');

// Import middlewares
const { isRegistered, isAdmin } = require('./middlewares/auth');

// Definizione dei comandi admin e utente
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

const userCommands = [
  { command: 'start', description: 'Avvia il bot / Registrazione' },
  { command: 'help', description: 'Mostra i comandi disponibili' },
  { command: 'saldo', description: 'Visualizza il tuo saldo kWh attuale' },
  { command: 'cronologia', description: 'Visualizza la cronologia delle transazioni' },
  { command: 'registra_utilizzo', description: 'Registra un nuovo utilizzo di kWh' },
  { command: 'profilo', description: 'Visualizza il tuo profilo' },
  { command: 'annulla', description: 'Annulla l\'operazione corrente' }
];

// Inizializza il bot
const bot = new Telegraf(config.BOT_TOKEN);

// Middleware di sessione
bot.use(session());

// Handler per il comando /start (avvia registrazione)
bot.command('start', startRegistration);

// Handler per comandi utente (richiedono autenticazione)
bot.command('help', isRegistered, showHelp);
bot.command('saldo', isRegistered, getBalance);
bot.command('cronologia', isRegistered, getTransactionHistory);
bot.command('registra_utilizzo', isRegistered, startUsageRegistration);
bot.command('profilo', isRegistered, showProfile);

// Handler per comandi admin (richiedono autenticazione come admin)
bot.command('admin_utenti', isAdmin, getUsersPaginated);
bot.command('admin_ricarica', isAdmin, startRecharge);
bot.command('admin_crea_invito', isAdmin, startInviteCodeCreation);
bot.command('admin_inviti', isAdmin, getInviteCodes);
bot.command('admin_stats', isAdmin, getStats);
bot.command('admin_ricariche', isAdmin, startRechargeHistory);
bot.command('admin_utilizzi', isAdmin, startUsageHistory);

// Nuovi handler per i comandi admin
bot.command('admin_trova_tessera', isAdmin, findUserByCard);
bot.command('admin_trova_utente', isAdmin, findUserByName);
bot.command('admin_dettaglio', isAdmin, getUserDetails);
bot.command('admin_esporta_utenti', isAdmin, exportUsers);
bot.command('admin_approva', isAdmin, approveUser);
bot.command('admin_blocca', isAdmin, blockUser);
bot.command('admin_sblocca', isAdmin, unblockUser);

// Handler per disabilitazione ed eliminazione
bot.command('admin_disabilita', isAdmin, disableUser);
bot.command('admin_elimina', isAdmin, deleteUser);
bot.command('admin_conferma_eliminazione', isAdmin, confirmUserDeletion);

// Nuovo comando per promuovere un utente ad amministratore
bot.command('admin_make_admin', isAdmin, makeAdmin);

// Nuovo comando per aggiornare i comandi del bot
bot.command('admin_aggiorna_comandi', isAdmin, async (ctx) => {
  try {
    // Imposta comandi globali (utenti normali)
    await bot.telegram.setMyCommands(userCommands);
    
    // Trova tutti gli utenti admin
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
});

// Nuovo comando per la ricerca di utenti con saldo basso
bot.command('admin_saldi_bassi', isAdmin, startLowBalanceSearch);

// Handler per il comando /annulla
bot.command('annulla', async (ctx) => {
  const telegramId = ctx.from.id;
  
  // Pulisci tutti gli stati per questo utente
  let stateFound = false;
  
  if (registrationState[telegramId]) {
    delete registrationState[telegramId];
    stateFound = true;
  }
  
  if (transactionState[telegramId]) {
    delete transactionState[telegramId];
    stateFound = true;
  }
  
  if (rechargeState[telegramId]) {
    delete rechargeState[telegramId];
    stateFound = true;
  }
  
  if (inviteCodeState[telegramId]) {
    delete inviteCodeState[telegramId];
    stateFound = true;
  }
  
  if (lowBalanceState[telegramId]) {
    delete lowBalanceState[telegramId];
    stateFound = true;
  }
  
  if (rechargeHistoryState[telegramId]) {
    delete rechargeHistoryState[telegramId];
    stateFound = true;
  }
  
  if (usageHistoryState[telegramId]) {
    delete usageHistoryState[telegramId];
    stateFound = true;
  }
  
  if (stateFound) {
    return ctx.reply('🚫 Operazione corrente annullata.', Markup.removeKeyboard());
  } else {
    return ctx.reply('ℹ️ Non ci sono operazioni in corso da annullare.');
  }
});

// Handler per le callback query
bot.action(/approve_registration:(.+)/, isAdmin, approveRegistration);
bot.action(/reject_registration:(.+)/, isAdmin, rejectRegistration);
bot.action(/approve_usage:(.+)/, isAdmin, approveUsage);
bot.action(/reject_usage:(.+)/, isAdmin, rejectUsage);

// Handler per le callback della ricarica
bot.action(/confirm_recharge_(\d+)/, isAdmin, confirmRecharge);
bot.action(/cancel_recharge_(\d+)/, isAdmin, cancelRecharge);

// Handler per le callback della navigazione ricariche
bot.action(/recharge_history_page_(\d+)/, async (ctx) => {
  try {
    const page = parseInt(ctx.match[1]);
    await navigateRechargeHistory(ctx, page);
  } catch (error) {
    console.error('Errore durante la navigazione delle pagine della cronologia ricariche:', error);
    return ctx.answerCbQuery('Si è verificato un errore');
  }
});

bot.action('recharge_history_close', closeRechargeHistory);
bot.action('recharge_history_export', exportRechargeHistory);

// Handler per le callback della navigazione utilizzi
bot.action(/usage_history_page_(\d+)/, async (ctx) => {
  try {
    const page = parseInt(ctx.match[1]);
    await navigateUsageHistory(ctx, page);
  } catch (error) {
    console.error('Errore durante la navigazione delle pagine della cronologia utilizzi:', error);
    return ctx.answerCbQuery('Si è verificato un errore');
  }
});

bot.action('usage_history_close', closeUsageHistory);
bot.action('usage_history_export', exportUsageHistory);

// Handler per le callback della navigazione saldi bassi
bot.action(/low_balance_page_(\d+)/, async (ctx) => {
  try {
    const page = parseInt(ctx.match[1]);
    const telegramId = ctx.from.id;
    
    // Controlla se esiste uno stato valido
    if (!lowBalanceState[telegramId] || !lowBalanceState[telegramId].users) {
      return ctx.answerCbQuery('Sessione scaduta. Per favore, avvia una nuova ricerca.');
    }
    
    const state = lowBalanceState[telegramId];
    // Aggiorna timestamp attività
    state.lastActivity = Date.now();
    
    await showUsersPage(ctx, state.users, state.threshold, page);
    return ctx.answerCbQuery();
  } catch (error) {
    console.error('Errore durante la navigazione delle pagine:', error);
    return ctx.answerCbQuery('Si è verificato un errore');
  }
});

bot.action('low_balance_csv', async (ctx) => {
  try {
    const telegramId = ctx.from.id;
    
    // Controlla se esiste uno stato valido
    if (!lowBalanceState[telegramId] || !lowBalanceState[telegramId].users) {
      return ctx.answerCbQuery('Sessione scaduta. Per favore, avvia una nuova ricerca.');
    }
    
    const state = lowBalanceState[telegramId];
    // Aggiorna timestamp attività
    state.lastActivity = Date.now();
    
    await sendUsersCsv(ctx, state.users, state.threshold);
    return ctx.answerCbQuery();
  } catch (error) {
    console.error('Errore durante la generazione del CSV:', error);
    return ctx.answerCbQuery('Si è verificato un errore');
  }
});

// Nuovi handler per le callback della visualizzazione saldi bassi
bot.action('low_balance_show_list', async (ctx) => {
  try {
    const telegramId = ctx.from.id;
    
    // Controlla se esiste uno stato valido
    if (!lowBalanceState[telegramId] || !lowBalanceState[telegramId].users) {
      return ctx.answerCbQuery('Sessione scaduta. Per favore, avvia una nuova ricerca.');
    }
    
    const state = lowBalanceState[telegramId];
    // Aggiorna timestamp attività
    state.lastActivity = Date.now();
    state.currentPage = 0;
    
    await showUsersPage(ctx, state.users, state.threshold, state.currentPage);
    return ctx.answerCbQuery();
  } catch (error) {
    console.error('Errore durante la visualizzazione degli utenti:', error);
    return ctx.answerCbQuery('Si è verificato un errore');
  }
});

bot.action('low_balance_cancel', async (ctx) => {
  try {
    const telegramId = ctx.from.id;
    
    // Controlla se esiste uno stato valido
    if (!lowBalanceState[telegramId]) {
      return ctx.answerCbQuery('Nessuna operazione in corso.');
    }
    
    // Cancella lo stato
    delete lowBalanceState[telegramId];
    
    // Modifica il messaggio
    await ctx.editMessageText('❌ Operazione annullata.');
    return ctx.answerCbQuery('Operazione annullata');
  } catch (error) {
    console.error('Errore durante l\'annullamento dell\'operazione:', error);
    return ctx.answerCbQuery('Si è verificato un errore');
  }
});

// Handler per le callback della paginazione e filtri utenti
bot.action(/users_page_(\d+)_(.*)/, async (ctx) => {
  try {
    const page = parseInt(ctx.match[1]);
    let query = {};
    
    try {
      query = JSON.parse(ctx.match[2]);
    } catch (e) {
      // Se non è un JSON valido, usa un oggetto vuoto
    }
    
    const pageSize = 5;
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
      message += `📊 Stato: ${status}\n\n`;
    }
    
    message += `\nPer vedere dettagli completi: /admin\_dettaglio [ID_Telegram]`;
    
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
});

// Handler per i filtri
bot.action('users_filter_all', async (ctx) => {
  try {
    await ctx.editMessageText('Caricamento utenti...', { 
      parse_mode: 'Markdown'
    });
    
    // Questa query esclude gli utenti disabilitati
    const query = { status: { $ne: 'disabled' } };
    const page = 1;
    const pageSize = 5;
    
    const totalUsers = await User.countDocuments(query);
    const totalPages = Math.ceil(totalUsers / pageSize);
    
    const users = await User.find(query)
      .sort({ createdAt: -1 })
      .skip((page - 1) * pageSize)
      .limit(pageSize);
    
    let message = `👥 *Lista di tutti gli utenti attivi*\n`;
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
      }
      
      message += `👤 *${escapeMarkdown(user.firstName)} ${escapeMarkdown(user.lastName)}*\n`;
      message += `🆔 ID: \`${user.telegramId}\`\n`;
      message += `💳 Tessera: ${user.cardId || 'Non impostata'}\n`;
      message += `💰 Saldo: ${user.balance.toFixed(2)} kWh\n`;
      message += `📊 Stato: ${status}\n\n`;
    }
    
    message += `\nPer vedere dettagli completi: /admin\_dettaglio [ID_Telegram]`;
    
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
    console.error('Errore durante il filtro degli utenti:', error);
    return ctx.answerCbQuery('Si è verificato un errore');
  }
});

bot.action('users_filter_active', async (ctx) => {
  try {
    await ctx.editMessageText('Caricamento utenti attivi...', { 
      parse_mode: 'Markdown'
    });
    
    const query = { status: 'active' };
    const page = 1;
    const pageSize = 5;
    
    const totalUsers = await User.countDocuments(query);
    const totalPages = Math.ceil(totalUsers / pageSize);
    
    const users = await User.find(query)
      .sort({ createdAt: -1 })
      .skip((page - 1) * pageSize)
      .limit(pageSize);
    
    let message = `👥 *Lista degli utenti ATTIVI*\n`;
    message += `📊 Mostrati ${users.length} di ${totalUsers} utenti\n`;
    message += `📄 Pagina ${page} di ${totalPages}\n\n`;
    
    for (const user of users) {
      message += `👤 *${user.firstName} ${user.lastName}*\n`;
      message += `🆔 ID: \`${user.telegramId}\`\n`;
      message += `💳 Tessera: ${user.cardId || 'Non impostata'}\n`;
      message += `💰 Saldo: ${user.balance.toFixed(2)} kWh\n\n`;
    }
    
    message += `\nPer vedere dettagli completi: /admin\_dettaglio [ID_Telegram]`;
    
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
    console.error('Errore durante il filtro degli utenti attivi:', error);
    return ctx.answerCbQuery('Si è verificato un errore');
  }
});

bot.action('users_filter_pending', async (ctx) => {
  try {
    await ctx.editMessageText('Caricamento utenti in attesa...', { 
      parse_mode: 'Markdown'
    });
    
    const query = { status: 'pending' };
    const page = 1;
    const pageSize = 5;
    
    const totalUsers = await User.countDocuments(query);
    const totalPages = Math.ceil(totalUsers / pageSize);
    
    const users = await User.find(query)
      .sort({ createdAt: -1 })
      .skip((page - 1) * pageSize)
      .limit(pageSize);
    
    let message = `👥 *Lista degli utenti IN ATTESA*\n`;
    message += `📊 Mostrati ${users.length} di ${totalUsers} utenti\n`;
    message += `📄 Pagina ${page} di ${totalPages}\n\n`;
    
    for (const user of users) {
      message += `👤 *${user.firstName} ${user.lastName}*\n`;
      message += `🆔 ID: \`${user.telegramId}\`\n`;
      message += `💳 Tessera: ${user.cardId || 'Non impostata'}\n\n`;
    }
    
    message += `\nPer vedere dettagli completi: /admin\_dettaglio [ID_Telegram]`;
    
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
    console.error('Errore durante il filtro degli utenti in attesa:', error);
    return ctx.answerCbQuery('Si è verificato un errore');
  }
});

bot.action('users_filter_blocked', async (ctx) => {
  try {
    await ctx.editMessageText('Caricamento utenti bloccati...', { 
      parse_mode: 'Markdown'
    });
    
    const query = { status: 'blocked' };
    const page = 1;
    const pageSize = 5;
    
    const totalUsers = await User.countDocuments(query);
    const totalPages = Math.ceil(totalUsers / pageSize);
    
    const users = await User.find(query)
      .sort({ createdAt: -1 })
      .skip((page - 1) * pageSize)
      .limit(pageSize);
    
    let message = `👥 *Lista degli utenti BLOCCATI*\n`;
    message += `📊 Mostrati ${users.length} di ${totalUsers} utenti\n`;
    message += `📄 Pagina ${page} di ${totalPages}\n\n`;
    
    for (const user of users) {
      message += `👤 *${user.firstName} ${user.lastName}*\n`;
      message += `🆔 ID: \`${user.telegramId}\`\n`;
      message += `💳 Tessera: ${user.cardId || 'Non impostata'}\n\n`;
    }
    
    message += `\nPer vedere dettagli completi: /admin\_dettaglio [ID_Telegram]`;
    
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
    console.error('Errore durante il filtro degli utenti bloccati:', error);
    return ctx.answerCbQuery('Si è verificato un errore');
  }
});

// Nuovo filtro per utenti disabilitati
bot.action('users_filter_disabled', async (ctx) => {
  try {
    await ctx.editMessageText('Caricamento utenti disabilitati...', { 
      parse_mode: 'Markdown'
    });
    
    const query = { status: 'disabled' };
    const page = 1;
    const pageSize = 5;
    
    const totalUsers = await User.countDocuments(query);
    const totalPages = Math.ceil(totalUsers / pageSize);
    
    const users = await User.find(query)
      .sort({ createdAt: -1 })
      .skip((page - 1) * pageSize)
      .limit(pageSize);
    
    let message = `👥 *Lista degli utenti DISABILITATI*\n`;
    message += `📊 Mostrati ${users.length} di ${totalUsers} utenti\n`;
    message += `📄 Pagina ${page} di ${totalPages}\n\n`;
    
    for (const user of users) {
      message += `👤 *${user.firstName} ${user.lastName}*\n`;
      message += `🆔 ID: \`${user.telegramId}\`\n`;
      message += `💳 Tessera: ${user.cardId || 'Non impostata'}\n`;
      message += `💰 Saldo: ${user.balance.toFixed(2)} kWh\n\n`;
    }
    
    message += `\nPer vedere dettagli completi: /admin\_dettaglio [ID_Telegram]`;
    
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
    console.error('Errore durante il filtro degli utenti disabilitati:', error);
    return ctx.answerCbQuery('Si è verificato un errore');
  }
});

// Filtro per tutti gli utenti, inclusi i disabilitati
bot.action('users_filter_really_all', async (ctx) => {
  try {
    await ctx.editMessageText('Caricamento di tutti gli utenti...', { 
      parse_mode: 'Markdown'
    });
    
    const query = {}; // Nessun filtro, mostra veramente tutti
    const page = 1;
    const pageSize = 5;
    
    const totalUsers = await User.countDocuments(query);
    const totalPages = Math.ceil(totalUsers / pageSize);
    
    const users = await User.find(query)
      .sort({ createdAt: -1 })
      .skip((page - 1) * pageSize)
      .limit(pageSize);
    
    let message = `👥 *Lista di TUTTI gli utenti (inclusi disabilitati)*\n`;
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
    
    message += `\nPer vedere dettagli completi: /admin\_dettaglio [ID_Telegram]`;
    
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
    console.error('Errore durante il filtro di tutti gli utenti:', error);
    return ctx.answerCbQuery('Si è verificato un errore');
  }
});

// Handler per messaggi di testo
bot.on('text', async (ctx, next) => {
  const telegramId = ctx.from.id;
  
  // Gestione della registrazione
  if (registrationState[telegramId]) {
    return handleRegistrationInput(ctx);
  }
  
  // Gestione delle transazioni
  if (transactionState[telegramId]) {
    return handleTransactionInput(ctx);
  }
  
  // Gestione delle ricariche da admin
  if (rechargeState[telegramId]) {
    return handleRechargeInput(ctx);
  }
  
  // Gestione dei codici di invito da admin
  if (inviteCodeState[telegramId]) {
    return handleInviteCodeInput(ctx);
  }
  
  // Gestione della ricerca saldi bassi
  if (lowBalanceState[telegramId]) {
    return handleLowBalanceInput(ctx);
  }
  
  // Gestione della ricerca cronologia ricariche
  if (rechargeHistoryState[telegramId]) {
    return handleRechargeHistoryInput(ctx);
  }
  
  // Gestione della ricerca cronologia utilizzi
  if (usageHistoryState[telegramId]) {
    return handleUsageHistoryInput(ctx);
  }
  
  // Se nessun handler specifico è stato attivato, passa al middleware successivo
  return next();
});

// Handler per foto (per le transazioni)
bot.on('photo', async (ctx) => {
  const telegramId = ctx.from.id;
  
  // Gestione delle foto per le transazioni
  if (transactionState[telegramId] && transactionState[telegramId].step === 'waitingForPhoto') {
    return handlePhotoUpload(ctx);
  }
});

// Handler per messaggi non gestiti
bot.on('message', (ctx) => {
  ctx.reply('Comando non riconosciuto. Usa /help per visualizzare i comandi disponibili.');
});

// NUOVA FUNZIONE: Pulizia periodica degli stati
const cleanupStates = () => {
  const now = Date.now();
  const TIMEOUT = 30 * 60 * 1000; // 30 minuti
  
  // Pulisci registrationState
  Object.keys(registrationState).forEach(telegramId => {
    if (!registrationState[telegramId].lastActivity || 
        now - registrationState[telegramId].lastActivity > TIMEOUT) {
      console.log(`Pulizia stato registrazione per utente ${telegramId}`);
      delete registrationState[telegramId];
    }
  });
  
  // Pulisci gli altri stati allo stesso modo
  [transactionState, rechargeState, inviteCodeState, lowBalanceState, rechargeHistoryState, usageHistoryState].forEach(stateObj => {
    Object.keys(stateObj).forEach(telegramId => {
      if (!stateObj[telegramId].lastActivity || 
          now - stateObj[telegramId].lastActivity > TIMEOUT) {
        console.log(`Pulizia stato per utente ${telegramId}`);
        delete stateObj[telegramId];
      }
    });
  });
  
  console.log('Pulizia stati inattivi completata');
};

// Esegui la pulizia ogni ora
setInterval(cleanupStates, 60 * 60 * 1000);

// Funzione per l'avvio del bot
const startBot = async () => {
  try {
    // Connessione al database
    await connectDB();
    console.log('Database connesso con successo');
    
    // Avvio del bot
    await bot.launch();
    console.log('Bot avviato con successo');
    
    // Imposta i comandi predefiniti per tutti gli utenti
    try {
      await bot.telegram.setMyCommands(userCommands);
      console.log('Comandi utente impostati con successo');
    } catch (error) {
      console.error('Errore nell\'impostazione dei comandi utente:', error);
    }
    
    // Imposta i comandi admin per tutti gli amministratori
    try {
      // Trova tutti gli admin
      const adminUsers = await User.find({ isAdmin: true });
      
      for (const admin of adminUsers) {
        try {
          await bot.telegram.setMyCommands(adminCommands, { 
            scope: { type: 'chat', chat_id: admin.telegramId } 
          });
          console.log(`Comandi admin impostati per l'utente ${admin.telegramId}`);
        } catch (adminError) {
          console.error(`Errore nell'impostazione dei comandi admin per ${admin.telegramId}:`, adminError);
        }
      }
    } catch (error) {
      console.error('Errore nel recupero degli admin:', error);
    }
    
    // Gestione della chiusura del bot
    process.once('SIGINT', () => bot.stop('SIGINT'));
    process.once('SIGTERM', () => bot.stop('SIGTERM'));
  } catch (error) {
    console.error('Errore durante l\'avvio del bot:', error);
    process.exit(1);
  }
};

// Avvia il bot
startBot();
