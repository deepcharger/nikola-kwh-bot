/**
 * Gestione della pulizia periodica degli stati
 */

// Import stati
const { registrationState } = require('../handlers/registration');
const { transactionState } = require('../handlers/transactions');
const admin = require('../handlers/admin');
const logger = require('./logger');

/**
 * Pulisce gli stati inattivi dopo un certo tempo
 */
const cleanupStates = () => {
  const now = Date.now();
  const TIMEOUT = 30 * 60 * 1000; // 30 minuti
  let totalCleaned = 0;
  
  // Pulisci registrationState
  Object.keys(registrationState).forEach(telegramId => {
    if (!registrationState[telegramId].lastActivity || 
        now - registrationState[telegramId].lastActivity > TIMEOUT) {
      logger.info(`Pulizia stato registrazione per utente ${telegramId}`);
      delete registrationState[telegramId];
      totalCleaned++;
    }
  });
  
  // Pulisci transactionState
  Object.keys(transactionState).forEach(telegramId => {
    if (!transactionState[telegramId].lastActivity || 
        now - transactionState[telegramId].lastActivity > TIMEOUT) {
      logger.info(`Pulizia stato transazioni per utente ${telegramId}`);
      delete transactionState[telegramId];
      totalCleaned++;
    }
  });
  
  // Pulisci gli stati admin
  const adminStates = [
    { obj: admin.rechargeState, name: 'ricarica' },
    { obj: admin.inviteCodeState, name: 'codice invito' },
    { obj: admin.lowBalanceState, name: 'saldi bassi' },
    { obj: admin.rechargeHistoryState, name: 'cronologia ricariche' },
    { obj: admin.usageHistoryState, name: 'cronologia utilizzi' }
  ];
  
  adminStates.forEach(({ obj, name }) => {
    Object.keys(obj).forEach(telegramId => {
      if (!obj[telegramId].lastActivity || 
          now - obj[telegramId].lastActivity > TIMEOUT) {
        logger.info(`Pulizia stato ${name} per utente ${telegramId}`);
        delete obj[telegramId];
        totalCleaned++;
      }
    });
  });
  
  if (totalCleaned > 0) {
    logger.info(`Pulizia stati inattivi completata: ${totalCleaned} stati rimossi`);
  } else {
    logger.debug('Pulizia stati inattivi completata: nessuno stato da rimuovere');
  }
};

module.exports = cleanupStates;
