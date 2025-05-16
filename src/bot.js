/**
 * File principale del bot Telegram di Nikola kWh Manager
 */

const { Telegraf, session } = require('telegraf');
const config = require('./config/config');
const connectDB = require('./database/connection');
const User = require('./database/models/user');
const setupRoutes = require('./routes');
const cleanupStates = require('./utils/cleanupStates');
const { adminCommands, userCommands } = require('./config/commands');
const logger = require('./utils/logger');

// Inizializza il bot
const bot = new Telegraf(config.BOT_TOKEN);

// Middleware di sessione
bot.use(session());

// Configura tutte le route
setupRoutes(bot);

// Esegui la pulizia ogni ora
setInterval(cleanupStates, 60 * 60 * 1000);

// Funzione per l'avvio del bot
const startBot = async () => {
  try {
    // Connessione al database
    await connectDB();
    logger.info('Database connesso con successo');
    
    // Avvio del bot
    await bot.launch();
    logger.info('Bot avviato con successo');
    
    // Imposta i comandi predefiniti per tutti gli utenti
    try {
      await bot.telegram.setMyCommands(userCommands);
      logger.info('Comandi utente impostati con successo');
    } catch (error) {
      logger.error('Errore nell\'impostazione dei comandi utente:', error);
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
          logger.info(`Comandi admin impostati per l'utente ${admin.telegramId}`);
        } catch (adminError) {
          logger.error(`Errore nell'impostazione dei comandi admin per ${admin.telegramId}:`, adminError);
        }
      }
    } catch (error) {
      logger.error('Errore nel recupero degli admin:', error);
    }
    
    // Registrazione delle info di avvio
    const botInfo = await bot.telegram.getMe();
    logger.info(`Bot avviato come @${botInfo.username} (${botInfo.id})`);
    
    // Gestione della chiusura del bot
    process.once('SIGINT', () => {
      logger.info('Arresto del bot in corso (SIGINT)...');
      bot.stop('SIGINT');
    });
    
    process.once('SIGTERM', () => {
      logger.info('Arresto del bot in corso (SIGTERM)...');
      bot.stop('SIGTERM');
    });
  } catch (error) {
    logger.error('Errore durante l\'avvio del bot:', error);
    process.exit(1);
  }
};

// Avvia il bot
startBot();
