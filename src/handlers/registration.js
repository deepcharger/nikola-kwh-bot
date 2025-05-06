/**
 * Handler per la gestione della registrazione
 */

const { Markup } = require('telegraf');
const User = require('../database/models/user');
const Invite = require('../database/models/invite');
const config = require('../config/config');
const { 
  sanitizeString, 
  sanitizeCardId, 
  sanitizeInviteCode, 
  escapeMarkdown,
  generateErrorCode 
} = require('../utils/sanitize');

// Stato della registrazione degli utenti
const registrationState = {};

/**
 * Avvia il processo di registrazione
 */
const startRegistration = async (ctx) => {
  try {
    const telegramId = ctx.from.id;
    
    // Controlla se l'utente è già registrato
    const existingUser = await User.findOne({ telegramId });
    
    if (existingUser) {
      // Utente già registrato
      if (existingUser.status === 'active') {
        return ctx.reply(
          '✅ Sei già registrato e il tuo account è attivo.\n\n' +
          `Tessera ID: ${existingUser.cardId}\n` +
          `Saldo kWh: ${existingUser.balance}\n\n` +
          'Usa /help per visualizzare i comandi disponibili.'
        );
      } else if (existingUser.status === 'pending') {
        return ctx.reply(
          '⏳ La tua registrazione è in attesa di approvazione da parte dell\'amministratore.\n\n' +
          'Riceverai una notifica quando la tua richiesta sarà elaborata.'
        );
      } else if (existingUser.status === 'blocked') {
        return ctx.reply('⛔ Il tuo account è stato bloccato. Contatta l\'amministratore per maggiori informazioni.');
      }
    }
    
    // Inizia il processo di registrazione
    let welcomeMessage = '👋 Benvenuto nel bot di gestione kWh di Nikola!\n\n';
    
    // Se i codici di invito sono abilitati, richiedi un codice di invito
    if (config.INVITE_CODE_ENABLED) {
      welcomeMessage += 'Per registrarti, hai bisogno di un codice di invito.\n' +
                       'Per favore, inserisci il tuo codice di invito:';
      
      // Inizializza lo stato di registrazione dell'utente
      registrationState[telegramId] = { 
        step: 'waitingForInviteCode',
        lastActivity: Date.now()
      };
      
      return ctx.reply(welcomeMessage);
    } else {
      // Se i codici di invito non sono abilitati, chiedi direttamente l'ID della tessera
      welcomeMessage += 'Per registrarti, inserisci il numero della tua tessera RFID:';
      
      // Inizializza lo stato di registrazione dell'utente
      registrationState[telegramId] = { 
        step: 'waitingForCardId',
        lastActivity: Date.now()
      };
      
      return ctx.reply(welcomeMessage);
    }
  } catch (error) {
    const errorCode = generateErrorCode();
    console.error(`Errore [${errorCode}] durante l'avvio della registrazione:`, error);
    return ctx.reply(`Si è verificato un errore (codice: ${errorCode}). Per favore, riprova più tardi.`);
  }
};

/**
 * Gestisce l'input dell'utente durante la registrazione
 */
const handleRegistrationInput = async (ctx) => {
  try {
    const telegramId = ctx.from.id;
    const input = ctx.message.text;
    
    // Controlla se l'utente è in processo di registrazione
    if (!registrationState[telegramId]) {
      return;
    }
    
    const state = registrationState[telegramId];
    // Aggiorna il timestamp di attività
    state.lastActivity = Date.now();
    
    // Gestione del codice di invito
    if (state.step === 'waitingForInviteCode') {
      // Sanitizza il codice di invito
      const inviteCode = sanitizeInviteCode(input.trim());
      
      if (!inviteCode) {
        return ctx.reply(
          '❌ Formato codice di invito non valido. Deve essere di 6 caratteri alfanumerici.\n' +
          'Per favore, inserisci un codice di invito valido:'
        );
      }
      
      // Verifica il codice di invito
      const invite = await Invite.findOne({ code: inviteCode });
      
      if (!invite || !invite.isValid()) {
        return ctx.reply(
          '❌ Codice di invito non valido o scaduto.\n' +
          'Per favore, inserisci un codice di invito valido:'
        );
      }
      
      // Salva il codice di invito e passa alla fase successiva
      state.inviteCode = inviteCode;
      state.step = 'waitingForCardId';
      
      return ctx.reply('✅ Codice di invito valido!\n\nOra, inserisci il numero della tua tessera RFID:');
    }
    
    // Gestione dell'ID della tessera
    if (state.step === 'waitingForCardId') {
      // Sanitizza l'ID tessera
      const cardId = sanitizeCardId(input.trim());
      
      if (!cardId) {
        return ctx.reply(
          '❌ Formato tessera non valido. Per favore, inserisci un ID tessera valido:'
        );
      }
      
      // Verifica che l'ID della tessera non sia già registrato
      const existingCard = await User.findOne({ cardId });
      
      if (existingCard) {
        return ctx.reply(
          '❌ Questa tessera è già registrata.\n' +
          'Per favore, inserisci un altro numero di tessera:'
        );
      }
      
      // Salva l'ID della tessera e completa la registrazione
      state.cardId = cardId;
      
      // Sanitizza i dati utente da Telegram
      const firstName = sanitizeString(ctx.from.first_name || '');
      const lastName = sanitizeString(ctx.from.last_name || '');
      const username = sanitizeString(ctx.from.username || '');
      
      // Crea il nuovo utente
      const newUser = new User({
        telegramId,
        firstName,
        lastName,
        username,
        cardId,
        inviteCodeUsed: state.inviteCode || null,
        status: 'pending', // In attesa di approvazione da parte dell'amministratore
        balance: 0
      });
      
      await newUser.save();
      
      // Se è stato utilizzato un codice di invito, marcalo come utilizzato
      if (state.inviteCode) {
        const invite = await Invite.findOne({ code: state.inviteCode });
        if (invite) {
          await invite.markAsUsed(newUser._id);
        }
      }
      
      // Invia notifica all'amministratore
      const adminMessage = 
        '🔔 *Nuova richiesta di registrazione*\n\n' +
        `👤 Nome: ${escapeMarkdown(newUser.firstName)} ${escapeMarkdown(newUser.lastName)}\n` +
        `🆔 Telegram ID: ${telegramId}\n` +
        `👤 Username: ${newUser.username ? '@' + escapeMarkdown(newUser.username) : 'Non impostato'}\n` +
        `💳 Tessera ID: ${escapeMarkdown(cardId)}\n` +
        `🔑 Codice invito: ${escapeMarkdown(state.inviteCode || 'Non utilizzato')}\n\n` +
        'Vuoi approvare questa registrazione?';
      
      // Bottoni per l'approvazione o il rifiuto
      const keyboard = Markup.inlineKeyboard([
        [
          Markup.button.callback('✅ Approva', `approve_registration:${newUser._id}`),
          Markup.button.callback('❌ Rifiuta', `reject_registration:${newUser._id}`)
        ]
      ]);
      
      // Invia messaggio all'amministratore
      if (config.ADMIN_CHAT_ID) {
        try {
          await ctx.telegram.sendMessage(config.ADMIN_CHAT_ID, adminMessage, {
            parse_mode: 'Markdown',
            ...keyboard
          });
        } catch (error) {
          console.error('Errore nell\'invio della notifica all\'amministratore:', error);
        }
      }
      
      // Cancella lo stato di registrazione
      delete registrationState[telegramId];
      
      // Informa l'utente che la registrazione è in attesa di approvazione
      return ctx.reply(
        '✅ Registrazione completata con successo!\n\n' +
        'La tua richiesta è ora in attesa di approvazione da parte dell\'amministratore.\n' +
        'Riceverai una notifica quando la tua richiesta sarà elaborata.'
      );
    }
  } catch (error) {
    const errorCode = generateErrorCode();
    console.error(`Errore [${errorCode}] durante la gestione dell'input di registrazione:`, error);
    return ctx.reply(`Si è verificato un errore (codice: ${errorCode}). Per favore, riprova più tardi.`);
  }
};

/**
 * Gestisce l'approvazione della registrazione
 */
const approveRegistration = async (ctx) => {
  try {
    // Estrae l'ID dell'utente dalla callback query
    const userId = ctx.callbackQuery.data.split(':')[1];
    
    // Cerca e aggiorna l'utente
    const user = await User.findById(userId);
    
    if (!user) {
      return ctx.answerCbQuery('Utente non trovato');
    }
    
    // Aggiorna lo stato dell'utente
    user.status = 'active';
    await user.save();
    
    // Invia messaggio all'amministratore
    await ctx.editMessageText(
      ctx.callbackQuery.message.text + '\n\n✅ Registrazione approvata!'
    );
    
    // Invia messaggio all'utente
    try {
      await ctx.telegram.sendMessage(
        user.telegramId,
        '🎉 La tua registrazione è stata approvata!\n\n' +
        'Ora puoi utilizzare il bot per gestire il tuo saldo kWh e registrare i tuoi utilizzi.\n\n' +
        'Usa /help per visualizzare i comandi disponibili.'
      );
    } catch (error) {
      console.error('Errore nell\'invio della notifica all\'utente:', error);
    }
    
    return ctx.answerCbQuery('Registrazione approvata con successo');
  } catch (error) {
    const errorCode = generateErrorCode();
    console.error(`Errore [${errorCode}] durante l'approvazione della registrazione:`, error);
    return ctx.answerCbQuery(`Si è verificato un errore (${errorCode})`);
  }
};

/**
 * Gestisce il rifiuto della registrazione
 */
const rejectRegistration = async (ctx) => {
  try {
    // Estrae l'ID dell'utente dalla callback query
    const userId = ctx.callbackQuery.data.split(':')[1];
    
    // Cerca e aggiorna l'utente
    const user = await User.findById(userId);
    
    if (!user) {
      return ctx.answerCbQuery('Utente non trovato');
    }
    
    // Aggiorna lo stato dell'utente
    user.status = 'blocked';
    await user.save();
    
    // Invia messaggio all'amministratore
    await ctx.editMessageText(
      ctx.callbackQuery.message.text + '\n\n❌ Registrazione rifiutata!'
    );
    
    // Invia messaggio all'utente
    try {
      await ctx.telegram.sendMessage(
        user.telegramId,
        '❌ La tua richiesta di registrazione è stata rifiutata.\n\n' +
        'Per maggiori informazioni, contatta l\'amministratore.'
      );
    } catch (error) {
      console.error('Errore nell\'invio della notifica all\'utente:', error);
    }
    
    return ctx.answerCbQuery('Registrazione rifiutata');
  } catch (error) {
    const errorCode = generateErrorCode();
    console.error(`Errore [${errorCode}] durante il rifiuto della registrazione:`, error);
    return ctx.answerCbQuery(`Si è verificato un errore (${errorCode})`);
  }
};

module.exports = {
  startRegistration,
  handleRegistrationInput,
  approveRegistration,
  rejectRegistration,
  registrationState
};
