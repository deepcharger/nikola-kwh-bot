/**
 * Schema utente per il database
 */

const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  // Dati Telegram
  telegramId: {
    type: Number,
    required: true,
    unique: true
  },
  firstName: {
    type: String,
    required: true
  },
  lastName: {
    type: String,
    default: ''
  },
  username: {
    type: String,
    default: ''
  },
  
  // Dati della tessera RFID
  cardId: {
    type: String,
    unique: true,
    sparse: true // Permette null/undefined
  },
  
  // Saldo kWh disponibile
  balance: {
    type: Number,
    default: 0,
    min: 0
  },
  
  // Stato dell'utente
  status: {
    type: String,
    enum: ['pending', 'active', 'blocked', 'disabled'], // Aggiunto 'disabled'
    default: 'pending'
  },
  
  // Codice di invito utilizzato per la registrazione
  inviteCodeUsed: {
    type: String,
    default: null
  },
  
  // Flag per utenti amministratori
  isAdmin: {
    type: Boolean,
    default: false
  },
  
  // Timestamp
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  },
  
  // Timestamp dell'ultimo utilizzo del bot
  lastSeen: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true
});

// Aggiornamento del campo lastSeen prima di salvare
userSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

// Aggiungi indici per migliorare le prestazioni delle query
userSchema.index({ telegramId: 1 }, { unique: true });
userSchema.index({ cardId: 1 }, { unique: true, sparse: true });
userSchema.index({ status: 1 });
userSchema.index({ balance: 1 }); // Per query di saldo basso
userSchema.index({ isAdmin: 1 }); // Per query di amministratori
userSchema.index({ username: 1 }, { sparse: true }); // Per ricerche per username
userSchema.index({ createdAt: -1 }); // Per ordinamento per data di creazione
userSchema.index({ lastSeen: -1 }); // Per ordinamento per ultima attività

module.exports = mongoose.model('User', userSchema);
