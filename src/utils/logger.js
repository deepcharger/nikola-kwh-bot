/**
 * Logger centralizzato
 */

const winston = require('winston');

// Definisci il formato per i log
const { combine, timestamp, printf, colorize } = winston.format;

const logFormat = printf(({ level, message, timestamp, ...metadata }) => {
  let msg = `${timestamp} [${level}]: ${message}`;
  
  if (Object.keys(metadata).length > 0) {
    msg += ' ' + JSON.stringify(metadata);
  }
  
  return msg;
});

// Configurazione del livello di log in base all'ambiente
const getLogLevel = () => {
  const env = process.env.NODE_ENV || 'development';
  return env === 'production' ? 'info' : 'debug';
};

// Crea il logger
const logger = winston.createLogger({
  level: getLogLevel(),
  format: combine(
    timestamp(),
    logFormat
  ),
  transports: [
    new winston.transports.Console({
      format: combine(
        colorize(),
        timestamp(),
        logFormat
      )
    }),
    new winston.transports.File({ filename: 'logs/error.log', level: 'error' }),
    new winston.transports.File({ filename: 'logs/combined.log' })
  ]
});

// Assicurati che la directory logs esista prima di iniziare la scrittura dei log
const fs = require('fs');
const path = require('path');

try {
  const logsDir = path.join(process.cwd(), 'logs');
  if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir);
    console.log('Directory "logs" creata con successo');
  }
} catch (err) {
  console.error('Errore nella creazione della directory "logs":', err);
}

// Aggiungi un livello personalizzato per i log degli amministratori
logger.admin = function(message, metadata = {}) {
  this.warn(message, { ...metadata, isAdmin: true });
};

// Aggiungi un livello personalizzato per i log di sicurezza
logger.security = function(message, metadata = {}) {
  this.warn(message, { ...metadata, isSecurity: true });
};

module.exports = logger;
