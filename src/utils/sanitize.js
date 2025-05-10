/**
 * Utility per sanitizzare input utente
 */

/**
 * Sanitizza un ID numerico
 * @param {string|number} id - L'ID da sanitizzare
 * @returns {number|null} - ID numerico o null se invalido
 */
const sanitizeNumericId = (id) => {
  if (!id) return null;
  const numId = parseInt(id, 10);
  return !isNaN(numId) ? numId : null;
};

/**
 * Sanitizza una stringa
 * @param {string} str - La stringa da sanitizzare
 * @returns {string} - Stringa sanitizzata
 */
const sanitizeString = (str) => {
  if (!str) return '';
  // Rimuovi caratteri potenzialmente pericolosi
  return String(str).replace(/[<>]/g, '').trim();
};

/**
 * Sanitizza un importo numerico
 * @param {string|number} amount - L'importo da sanitizzare
 * @param {number} [max=1000] - Valore massimo consentito 
 * @returns {number|null} - Importo numerico o null se invalido
 */
const sanitizeAmount = (amount, max = 1000) => {
  if (!amount) return null;
  const numAmount = parseFloat(amount);
  if (isNaN(numAmount) || numAmount <= 0 || numAmount > max) {
    return null;
  }
  return numAmount;
};

/**
 * Sanitizza un ID tessera
 * @param {string} cardId - L'ID tessera da sanitizzare
 * @returns {string|null} - ID tessera sanitizzato o null se invalido
 */
const sanitizeCardId = (cardId) => {
  if (!cardId) return null;
  // Rimuovi spazi e caratteri non alfanumerici, tranne alcuni caratteri speciali consentiti
  const sanitized = String(cardId).replace(/[^\w\-:]/g, '').trim();
  // Verifica che l'ID sanitizzato abbia una lunghezza minima
  return sanitized.length >= 3 ? sanitized : null;
};

/**
 * Verifica se una stringa è un codice di invito valido
 * @param {string} code - Il codice di invito da verificare
 * @returns {string|null} - Codice sanitizzato o null se invalido
 */
const sanitizeInviteCode = (code) => {
  if (!code) return null;
  // Solo caratteri alfanumerici, maiuscoli
  const sanitized = String(code).replace(/[^A-Z0-9]/g, '').toUpperCase().trim();
  // Verifica che il codice sanitizzato abbia la lunghezza corretta
  return sanitized.length === 6 ? sanitized : null;
};

/**
 * Genera un codice errore univoco per il logging
 * @returns {string} - Codice errore univoco
 */
const generateErrorCode = () => {
  return `E${Date.now().toString(36).slice(-6).toUpperCase()}`;
};

/**
 * Sanitizza una stringa per l'uso in Markdown
 * @param {string} text - Testo da sanitizzare per Markdown
 * @returns {string} - Testo con escape dei caratteri speciali Markdown
 */
const escapeMarkdown = (text) => {
  if (!text) return '';
  return String(text).replace(/([_*[\]()~`>#+=|{}.!\\])/g, '\\$1');
};

/**
 * Sanitizza e valida una data in formato italiano (GG/MM/AAAA)
 * @param {string} dateStr - La data da sanitizzare e validare
 * @returns {object} - Oggetto con proprietà valid e date
 */
const sanitizeDate = (dateStr) => {
  if (!dateStr) return { valid: false, date: null };

  // Verifica se la stringa corrisponde al formato GG/MM/AAAA
  const dateRegex = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;
  const match = dateStr.match(dateRegex);

  if (!match) return { valid: false, date: null };

  // Estrai giorno, mese e anno
  const day = parseInt(match[1], 10);
  const month = parseInt(match[2], 10) - 1; // I mesi in JavaScript partono da 0
  const year = parseInt(match[3], 10);

  // Crea un oggetto Date
  const date = new Date(year, month, day);

  // Verifica che la data sia valida
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month ||
    date.getDate() !== day
  ) {
    return { valid: false, date: null };
  }

  return { valid: true, date };
};

module.exports = {
  sanitizeNumericId,
  sanitizeString,
  sanitizeAmount,
  sanitizeCardId,
  sanitizeInviteCode,
  generateErrorCode,
  escapeMarkdown,
  sanitizeDate
};
