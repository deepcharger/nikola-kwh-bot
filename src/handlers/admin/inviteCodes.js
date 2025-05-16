/**
 * Gestione dei codici di invito
 */

const { Markup } = require('telegraf');
const User = require('../../database/models/user');
const Invite = require('../../database/models/invite');
const { 
  sanitizeString, 
  escapeMarkdown,
  generateErrorCode 
} = require('../../utils/sanitize');
const { inviteCodeState } = require('./states');

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

module.exports = {
  startInviteCodeCreation,
  handleInviteCodeInput,
  getInviteCodes
};
