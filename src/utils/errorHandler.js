/**
 * Gestione centralizzata degli errori
 */

const { generateErrorCode } = require('./sanitize');

/**
 * Gestisce gli errori in modo centralizzato
 * @param {Object} ctx - Contesto Telegraf
 * @param {Error} error - Errore da gestire
 * @param {string} operation - Descrizione dell'operazione in corso
 * @returns {Promise|null} - Risposta al contesto o null
 */
const handleError = (ctx, error, operation) => {
  const errorCode = generateErrorCode();
  console.error(`Errore [${errorCode}] durante ${operation}:`, error);
  
  // Se il contesto è disponibile, invia messaggio all'utente
  if (ctx) {
    return ctx.reply(`Si è verificato un errore (codice: ${errorCode}). Per favore, riprova più tardi.`);
  }
  
  return null;
};

/**
 * Gestisce gli errori durante le azioni di callback
 * @param {Object} ctx - Contesto Telegraf
 * @param {Error} error - Errore da gestire
 * @param {string} operation - Descrizione dell'operazione in corso
 */
const handleCallbackError = (ctx, error, operation) => {
  const errorCode = generateErrorCode();
  console.error(`Errore [${errorCode}] durante ${operation}:`, error);
  
  if (ctx && ctx.answerCbQuery) {
    return ctx.answerCbQuery(`Si è verificato un errore (${errorCode}). Riprova più tardi.`);
  }
  
  return null;
};

/**
 * Registra un errore senza inviare risposta all'utente
 * @param {Error} error - Errore da registrare
 * @param {string} operation - Descrizione dell'operazione in corso
 * @returns {string} - Codice errore generato
 */
const logError = (error, operation) => {
  const errorCode = generateErrorCode();
  console.error(`Errore [${errorCode}] durante ${operation}:`, error);
  return errorCode;
};

module.exports = {
  handleError,
  handleCallbackError,
  logError
};
