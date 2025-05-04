// File temporaneo per creare un codice di invito
const mongoose = require('mongoose');
const config = require('./config/config');

// Schema per l'invito (versione semplificata)
const inviteSchema = new mongoose.Schema({
  code: {
    type: String,
    required: true,
    unique: true
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  expiresAt: {
    type: Date,
    default: function() {
      const expiryDays = 7;
      const expiryDate = new Date();
      expiryDate.setDate(expiryDate.getDate() + expiryDays);
      return expiryDate;
    }
  },
  isUsed: {
    type: Boolean,
    default: false
  },
  isActive: {
    type: Boolean,
    default: true
  },
  notes: {
    type: String,
    default: 'Creato automaticamente'
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

const Invite = mongoose.model('Invite', inviteSchema);

// Schema per l'utente (versione semplificata)
const userSchema = new mongoose.Schema({
  telegramId: {
    type: Number,
    required: true,
    unique: true
  }
});

const User = mongoose.model('User', userSchema);

// Funzione per connettersi al database e creare un invito
async function createInvite() {
  try {
    // Connessione al database
    await mongoose.connect(config.MONGODB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true
    });
    console.log('Connesso al database');
    
    // Trova l'utente amministratore
    const user = await User.findOne({ isAdmin: true });
    
    if (!user) {
      console.error('Nessun utente amministratore trovato');
      process.exit(1);
    }
    
    // Genera un codice casuale
    const code = Math.random().toString(36).substring(2, 8).toUpperCase();
    
    // Crea l'invito
    const invite = new Invite({
      code,
      createdBy: user._id,
      notes: 'Creato tramite script di supporto'
    });
    
    await invite.save();
    
    console.log(`Codice di invito creato con successo: ${code}`);
    
    // Chiudi la connessione
    await mongoose.connection.close();
    console.log('Connessione chiusa');
    
    process.exit(0);
  } catch (error) {
    console.error('Errore:', error);
    process.exit(1);
  }
}

// Esegui la funzione
createInvite();
