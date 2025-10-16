// Refactored Shared Worker using CRSqliteSharedWorker class
import { TestDB } from './TestDB';
import { CRSqliteSharedWorker } from './CRSqliteSharedWorker';

const initializeWorker = async () => {
  try {
    console.log('[SharedWorker] Initializing...');
    
    // Create and initialize TestDB
    const db = new TestDB("test.db");
    
    // Create CRSqliteSharedWorker with the DB instance
    const worker = new CRSqliteSharedWorker(() => db.db);
    
    // Set up connection handler immediately (no awaits above it)
    self.addEventListener('connect', (event: any) => {
      worker.onConnect(event.ports[0]);
    });

    // Init db
    await db.initialize();

    // Start the worker, now it will process the pending connects
    await worker.start();
    
    console.log('[SharedWorker] Initialized successfully');
    
  } catch (error) {
    console.error('[SharedWorker] Failed to initialize:', error);
  }
};

// Initialize the worker when it starts
initializeWorker();

console.log('[SharedWorker] Shared worker started');