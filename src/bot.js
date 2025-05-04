/**
 * File principale del bot Telegram di Nikola kWh Manager
 */

const { Telegraf, Scenes, session } = require('telegraf');
const config = require('./config/config');
const connectDB = require('./database/connection');

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
  inviteCodeState
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
bot.command('admin_utenti', isAdmin, getUsers);
bot.command('admin_ricarica', isAdmin, startRecharge);
bot.command('admin_crea_invito', isAdmin, startInviteCodeCreation);
bot.command('admin_inviti', isAdmin, getInviteCodes);
bot.command('admin_stats', isAdmin, getStats);

// Handler per le callback query
bot.action(/approve_registration:(.+)/, isAdmin, approveRegistration);
bot.action(/reject_registration:(.+)/, isAdmin, rejectRegistration);
bot.action(/approve_usage:(.+)/, isAdmin, approveUsage);
bot.action(/reject_usage:(.+)/, isAdmin, rejectUsage);

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
