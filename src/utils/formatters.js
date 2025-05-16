/**
 * Formatta un messaggio per la lista utenti
 * @param {Array} users - Lista di utenti
 * @param {number} totalUsers - Numero totale di utenti
 * @param {number} page - Pagina corrente
 * @param {number} totalPages - Numero totale di pagine
 * @param {string} filterDescription - Descrizione del filtro applicato
 * @returns {string} - Messaggio formattato
 */
const formatUsersList = (users, totalUsers, page, totalPages, filterDescription = '') => {
  let message = `👥 *Lista degli utenti${filterDescription ? ' ' + filterDescription : ''}*\n`;
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
    // Comando per ricarica per ID se non disabilitato
    if (user.status !== 'disabled') {
      message += `💸 \`/admin_ricarica ${user.telegramId}\`\n`;
    }
    // Aggiungi comando ricarica per tessera se disponibile e utente non disabilitato
    if (user.cardId && user.status !== 'disabled') {
      message += `💳 \`/admin_ricarica tessera:${user.cardId}\`\n`;
    }
    message += `\n`;
  }
  
  return message;
};

/**
 * Formatta i dettagli completi di un utente
 * @param {Object} user - Utente
 * @param {Array} transactions - Transazioni dell'utente
 * @returns {string} - Messaggio formattato
 */
const formatUserDetails = (user, transactions = []) => {
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
  
  // Mostra le transazioni se sono state fornite
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
  
  if (user.status !== 'disabled') {
    message += `💸 \`/admin_ricarica ${user.telegramId}\` - Per ricaricare per ID\n`;
    // Aggiungi comando ricarica per tessera se disponibile
    if (user.cardId) {
      message += `💳 \`/admin_ricarica tessera:${user.cardId}\` - Per ricaricare per tessera\n`;
    }
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
 * Formatta un messaggio per le statistiche
 * @param {Object} stats - Oggetto con le statistiche
 * @returns {string} - Messaggio formattato
 */
const formatStats = (stats) => {
  let message = '📊 *Statistiche del bot*\n\n';
  
  message += '👥 *Utenti*\n';
  message += `📌 Totale: ${stats.totalUsers}\n`;
  message += `✅ Attivi: ${stats.activeUsers}\n`;
  message += `⏳ In attesa: ${stats.pendingUsers}\n`;
  message += `❌ Bloccati: ${stats.blockedUsers}\n`;
  message += `🚫 Disabilitati: ${stats.disabledUsers}\n\n`;
  
  message += '🔄 *Transazioni*\n';
  message += `📌 Totale: ${stats.totalTransactions}\n`;
  message += `🔋 Ricariche: ${stats.chargeTransactions}\n`;
  message += `⚡ Utilizzi: ${stats.usageTransactions}\n\n`;
  
  message += '⚡ *Energia*\n';
  message += `🔋 Totale caricato: ${stats.totalKwhCharged.toFixed(2)} kWh\n`;
  message += `⚡ Totale utilizzato: ${stats.totalKwhUsed.toFixed(2)} kWh\n`;
  message += `💰 Saldo totale: ${stats.totalKwhBalance.toFixed(2)} kWh\n`;
  
  return message;
};

/**
 * Formatta un messaggio per la cronologia transazioni
 * @param {Array} transactions - Lista di transazioni
 * @returns {string} - Messaggio formattato
 */
const formatTransactionHistory = (transactions) => {
  let message = '📜 *Ultime transazioni*\n\n';
  
  if (transactions.length === 0) {
    message += 'Non hai ancora effettuato alcuna transazione.';
    return message;
  }
  
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
    message += `💰 Saldo dopo: ${transaction.newBalance.toFixed(2)} kWh\n`;
    if (transaction.notes) {
      message += `📝 Note: ${escapeMarkdown(transaction.notes)}\n`;
    }
    message += '\n';
  }
  
  return message;
};

/**
 * Formatta un messaggio per la cronologia di ricariche o utilizzi
 * @param {Array} transactions - Lista di transazioni
 * @param {Object} usersMap - Mappa degli utenti per ID
 * @param {string} dateDescription - Descrizione della data
 * @param {number} page - Pagina corrente
 * @param {number} totalPages - Numero totale di pagine
 * @param {string} type - Tipo di transazione ('charge' o 'usage')
 * @returns {string} - Messaggio formattato
 */
const formatTransactionsPage = (transactions, usersMap, dateDescription, page, totalPages, type = 'charge') => {
  const title = type === 'charge' ? 'Ricariche' : 'Utilizzi kWh';
  const icon = type === 'charge' ? '🔋' : '⚡';
  
  let message = `📊 *${title} ${dateDescription}*\n`;
  message += `(${transactions.length} ${type === 'charge' ? 'ricariche' : 'utilizzi'} - Pagina ${page + 1}/${totalPages})\n\n`;
  
  for (const transaction of transactions) {
    const user = usersMap[transaction.userId.toString()];
    const userName = user ? `${user.firstName} ${user.lastName}` : 'Utente sconosciuto';
    const cardId = user ? (user.cardId || 'N/D') : 'N/D';
    const date = new Date(transaction.createdAt).toLocaleDateString('it-IT');
    const time = new Date(transaction.createdAt).toLocaleTimeString('it-IT');
    
    message += `${icon} *${escapeMarkdown(userName)}* - ${transaction.amount.toFixed(2)} kWh\n`;
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
  
  return message;
};

module.exports = {
  formatUsersList,
  formatUserDetails,
  formatStats,
  formatTransactionHistory,
  formatTransactionsPage
};
