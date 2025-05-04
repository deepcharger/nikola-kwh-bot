/**
 * Configurazione della connessione al database MongoDB
 */

const mongoose = require('mongoose');
const config = require('../config/config');

// Opzioni di connessione
const options = {
  useNewUrlParser: true,
  useUnifiedTopology: true,
};

/**
 * Connessione al database MongoDB
 */
const connectDB = async () => {
  try {
    await mongoose.connect(config.MONGODB_URI, options);
    console.log('MongoDB connesso con successo');
  } catch (error) {
    console.error('Errore di connessione a MongoDB:', error.message);
    process.exit(1);
  }
};

// Gestione eventi di connessione
mongoose.connection.on('disconnected', () => {
  console.log('MongoDB disconnesso');
});

mongoose.connection.on('error', (err) => {
  console.error('Errore MongoDB:', err);
});

process.on('SIGINT', async () => {
  await mongoose.connection.close();
  console.log('Connessione MongoDB chiusa');
  process.exit(0);
});

module.exports = connectDB;
