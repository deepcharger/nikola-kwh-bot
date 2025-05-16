/**
 * Gestione dei saldi bassi
 */

const { Markup } = require('telegraf');
const User = require('../../database/models/user');
const Transaction = require('../../database/models/transaction');
const { 
  sanitizeAmount, 
  sanitizeString,
  escapeMarkdown,
  generateErrorCode 
} = require('../../utils/sanitize');
const { lowBalanceState } = require('./states');

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

module.exports = {
  showUsersPage,
  sendUsersCsv,
  startLowBalanceSearch,
  handleLowBalanceInput
};
