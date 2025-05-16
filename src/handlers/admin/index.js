/**
 * Punto di accesso principale per funzionalità admin
 */

// Importa tutti i moduli
const userManagement = require('./userManagement');
const recharges = require('./recharges');
const inviteCodes = require('./inviteCodes');
const stats = require('./stats');
const balances = require('./balances');
const history = require('./history');
const states = require('./states');

// Esporta tutto in un unico oggetto
module.exports = {
  // Esporta tutti gli stati
  ...states,
  
  // Esporta tutti i gestori
  ...userManagement,
  ...recharges,
  ...inviteCodes,
  ...stats,
  ...balances,
  ...history
};
