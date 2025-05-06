/**
 * Schema codici di invito per il database
 */

const mongoose = require('mongoose');
const config = require('../../config/config');

const inviteSchema = new mongoose.Schema({
  // Codice di invito
  code: {
    type: String,
    required: true,
    unique: true
  },
  
  // Creato da (amministratore)
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  
  // Data di scadenza
  expiresAt: {
    type: Date,
    default: function() {
      // Di default scade dopo il numero di giorni configurato
      const expiryDays = config.INVITE_CODE_EXPIRY_DAYS || 7;
      const expiryDate = new Date();
      expiryDate.setDate(expiryDate.getDate() + expiryDays);
      return expiryDate;
    }
  },
  
  // Flag per il controllo se il codice è stato utilizzato
  isUsed: {
    type: Boolean,
    default: false
  },
  
  // Utente che ha utilizzato questo codice
  usedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  
  // Timestamp di utilizzo
  usedAt: {
    type: Date,
    default: null
  },
  
  // Note opzionali
  notes: {
    type: String,
    default: ''
  },
  
  // Flag per disabilitare manualmente il codice
  isActive: {
    type: Boolean,
    default: true
  }
}, {
  timestamps: true
});

// Metodo per controllare se il codice è valido
inviteSchema.methods.isValid = function() {
  // Non valido se già usato o disattivato
  if (this.isUsed || !this.isActive) {
    return false;
  }
  
  // Non valido se scaduto
  const now = new Date();
  if (now > this.expiresAt) {
    return false;
  }
  
  return true;
};

// Metodo per marcare il codice come utilizzato
inviteSchema.methods.markAsUsed = function(userId) {
  this.isUsed = true;
  this.usedBy = userId;
  this.usedAt = new Date();
  return this.save();
};

// Aggiungi indici per migliorare le prestazioni delle query
inviteSchema.index({ code: 1 }, { unique: true }); // Per cercare rapidamente per codice
inviteSchema.index({ createdBy: 1 }); // Per trovare i codici creati da un amministratore specifico
inviteSchema.index({ isUsed: 1 }); // Per filtrare i codici utilizzati/non utilizzati
inviteSchema.index({ isActive: 1 }); // Per filtrare i codici attivi/inattivi
inviteSchema.index({ expiresAt: 1 }); // Per verificare i codici scaduti
inviteSchema.index({ usedBy: 1 }, { sparse: true }); // Per trovare i codici utilizzati da un utente specifico
inviteSchema.index({ createdAt: -1 }); // Per ordinare per data di creazione (più recenti prima)

module.exports = mongoose.model('Invite', inviteSchema);
