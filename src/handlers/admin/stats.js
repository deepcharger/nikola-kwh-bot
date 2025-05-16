/**
 * Gestione delle statistiche
 */

const User = require('../../database/models/user');
const Transaction = require('../../database/models/transaction');
const { generateErrorCode } = require('../../utils/sanitize');

/**
 * Ottiene le statistiche del bot
 */
const getStats = async (ctx) => {
  try {
    // Ottieni le statistiche dal database
    const totalUsers = await User.countDocuments({ status: { $ne: 'disabled' } });
    const activeUsers = await User.countDocuments({ status: 'active' });
    const pendingUsers = await User.countDocuments({ status: 'pending' });
    const blockedUsers = await User.countDocuments({ status: 'blocked' });
    const disabledUsers = await User.countDocuments({ status: 'disabled' });
    
    const totalTransactions = await Transaction.countDocuments();
    const chargeTransactions = await Transaction.countDocuments({ type: 'charge' });
    const usageTransactions = await Transaction.countDocuments({ type: 'usage' });
    
    const totalKwhCharged = await Transaction.aggregate([
      { $match: { type: 'charge', status: 'approved' } },
      { $group: { _id: null, total: { $sum: '$amount' } } }
    ]);
    
    const totalKwhUsed = await Transaction.aggregate([
      { $match: { type: 'usage', status: 'approved' } },
      { $group: { _id: null, total: { $sum: '$amount' } } }
    ]);
    
    const totalKwhBalance = await User.aggregate([
      { $group: { _id: null, total: { $sum: '$balance' } } }
    ]);
    
    // Formatta le statistiche
    let message = '📊 *Statistiche del bot*\n\n';
    
    message += '👥 *Utenti*\n';
    message += `📌 Totale: ${totalUsers}\n`;
    message += `✅ Attivi: ${activeUsers}\n`;
    message += `⏳ In attesa: ${pendingUsers}\n`;
    message += `❌ Bloccati: ${blockedUsers}\n`;
    message += `🚫 Disabilitati: ${disabledUsers}\n\n`;
    
    message += '🔄 *Transazioni*\n';
    message += `📌 Totale: ${totalTransactions}\n`;
    message += `🔋 Ricariche: ${chargeTransactions}\n`;
    message += `⚡ Utilizzi: ${usageTransactions}\n\n`;
    
    message += '⚡ *Energia*\n';
    message += `🔋 Totale caricato: ${totalKwhCharged.length > 0 ? totalKwhCharged[0].total.toFixed(2) : 0} kWh\n`;
    message += `⚡ Totale utilizzato: ${totalKwhUsed.length > 0 ? totalKwhUsed[0].total.toFixed(2) : 0} kWh\n`;
    message += `💰 Saldo totale: ${totalKwhBalance.length > 0 ? totalKwhBalance[0].total.toFixed(2) : 0} kWh\n`;
    
    return ctx.reply(message, { 
      parse_mode: 'Markdown'
    });
  } catch (error) {
    const errorCode = generateErrorCode();
    console.error(`Errore [${errorCode}] durante la richiesta delle statistiche:`, error);
    return ctx.reply(`Si è verificato un errore (codice: ${errorCode}). Per favore, riprova più tardi.`);
  }
};

module.exports = {
  getStats
};
