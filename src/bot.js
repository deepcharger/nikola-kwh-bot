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
  confirmUserDeletion
} = require('./handlers/admin');

const {
  showHelp,
  showProfile
} = require('./handlers/user');

// Import middlewares
const { isRegistered, isAdmin } = require('./middlewares/auth');

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

// Handler per le callback query
bot.action(/approve_registration:(.+)/, isAdmin, approveRegistration);
bot.action(/reject_registration:(.+)/, isAdmin, rejectRegistration);
bot.action(/approve_usage:(.+)/, isAdmin, approveUsage);
bot.action(/reject_usage:(.+)/, isAdmin, rejectUsage);

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

// Funzione per l'avvio del bot
const startBot = async () => {
  try {
    // Connessione al database
    await connectDB();
    console.log('Database connesso con successo');
    
    // Avvio del bot
    await bot.launch();
    console.log('Bot avviato con successo');
    
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
