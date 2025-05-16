/**
 * Definizioni dei comandi per il bot
 */

const adminCommands = [
  { command: 'start', description: 'Avvia il bot / Registrazione' },
  { command: 'help', description: 'Mostra i comandi disponibili' },
  { command: 'saldo', description: 'Visualizza il tuo saldo kWh attuale' },
  { command: 'cronologia', description: 'Visualizza la cronologia delle transazioni' },
  { command: 'registra_utilizzo', description: 'Registra un nuovo utilizzo di kWh' },
  { command: 'profilo', description: 'Visualizza il tuo profilo' },
  { command: 'annulla', description: 'Annulla l\'operazione corrente' },
  // Comandi amministratore
  { command: 'admin_utenti', description: 'Visualizza la lista degli utenti' },
  { command: 'admin_trova_tessera', description: 'Cerca utente per numero tessera' },
  { command: 'admin_trova_utente', description: 'Cerca utente per nome/username' },
  { command: 'admin_ricarica', description: 'Ricarica il saldo di un utente' },
  { command: 'admin_crea_invito', description: 'Crea un nuovo codice di invito' },
  { command: 'admin_inviti', description: 'Visualizza i codici di invito' },
  { command: 'admin_stats', description: 'Visualizza le statistiche del bot' },
  { command: 'admin_make_admin', description: 'Promuovi un utente ad amministratore' },
  { command: 'admin_aggiorna_comandi', description: 'Aggiorna i comandi bot' },
  { command: 'admin_saldi_bassi', description: 'Trova utenti con saldo basso' },
  { command: 'admin_ricariche', description: 'Visualizza le ultime ricariche' },
  { command: 'admin_utilizzi', description: 'Visualizza gli ultimi utilizzi kWh' }
];

const userCommands = [
  { command: 'start', description: 'Avvia il bot / Registrazione' },
  { command: 'help', description: 'Mostra i comandi disponibili' },
  { command: 'saldo', description: 'Visualizza il tuo saldo kWh attuale' },
  { command: 'cronologia', description: 'Visualizza la cronologia delle transazioni' },
  { command: 'registra_utilizzo', description: 'Registra un nuovo utilizzo di kWh' },
  { command: 'profilo', description: 'Visualizza il tuo profilo' },
  { command: 'annulla', description: 'Annulla l\'operazione corrente' }
];

module.exports = {
  adminCommands,
  userCommands
};
