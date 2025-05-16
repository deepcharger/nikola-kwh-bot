/**
 * Stati condivisi per i gestori di funzioni admin
 */

// Stato per la creazione delle ricariche
const rechargeState = {};

// Stato per la creazione dei codici di invito
const inviteCodeState = {};

// Stato per la gestione del comando saldi bassi
const lowBalanceState = {};

// Stato per la gestione del comando ricariche
const rechargeHistoryState = {};

// Stato per la gestione del comando utilizzi
const usageHistoryState = {};

module.exports = {
  rechargeState,
  inviteCodeState,
  lowBalanceState,
  rechargeHistoryState,
  usageHistoryState
};
