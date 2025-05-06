/**
 * Schema transazioni per il database
 */

const mongoose = require('mongoose');

const transactionSchema = new mongoose.Schema({
  // Riferimento all'utente
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  
  // Numero della tessera RFID
  cardId: {
    type: String,
    required: true
  },
  
  // Tipo di transazione
  type: {
    type: String,
    enum: ['charge', 'usage'], // ricarica o utilizzo
    required: true
  },
  
  // Quantità di kWh (positiva per ricariche, negativa per utilizzi)
  amount: {
    type: Number,
    required: true
  },
  
  // Saldo precedente
  previousBalance: {
    type: Number,
    required: true
  },
  
  // Nuovo saldo dopo la transazione
  newBalance: {
    type: Number,
    required: true
  },
  
  // ID del messaggio Telegram che contiene la foto (se applicabile)
  photoMessageId: {
    type: String,
    default: null
  },
  
  // URL o file_id della foto (se applicabile)
  photoFileId: {
    type: String,
    default: null
  },
  
  // Note opzionali
  notes: {
    type: String,
    default: ''
  },
  
  // Stato di approvazione (rilevante per gli utilizzi)
  status: {
    type: String,
    enum: ['pending', 'approved', 'rejected'],
    default: 'pending'
  },
  
  // ID dell'amministratore che ha processato la transazione
  processedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  
  // Timestamp
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true
});

// Aggiungi indici per migliorare le prestazioni delle query
transactionSchema.index({ userId: 1 }); // Per trovare rapidamente tutte le transazioni di un utente
transactionSchema.index({ cardId: 1 }); // Per trovare transazioni per tessera
transactionSchema.index({ type: 1 }); // Per filtrare per tipo (charge/usage)
transactionSchema.index({ status: 1 }); // Per filtrare per stato (pending/approved/rejected)
transactionSchema.index({ createdAt: -1 }); // Per ordinamento per data (più recenti prima)
transactionSchema.index({ userId: 1, type: 1, createdAt: -1 }); // Query combinate comuni
transactionSchema.index({ userId: 1, status: 1 }); // Per trovare transazioni in attesa per un utente

module.exports = mongoose.model('Transaction', transactionSchema);
