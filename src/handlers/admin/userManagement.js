/**
 * Gestione degli utenti
 */

const { Markup } = require('telegraf');
const User = require('../../database/models/user');
const Transaction = require('../../database/models/transaction');
const { 
  sanitizeNumericId, 
  sanitizeString, 
  sanitizeCardId,
  escapeMarkdown,
  generateErrorCode 
} = require('../../utils/sanitize');

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

module.exports = {
  getUsers,
  getUsersPaginated,
  findUserByCard,
  findUserByName,
  getUserDetails,
  formatUserDetails,
  exportUsers,
  approveUser,
  blockUser,
  unblockUser,
  disableUser,
  deleteUser,
  confirmUserDeletion,
  makeAdmin,
  updateUserCommands
};
