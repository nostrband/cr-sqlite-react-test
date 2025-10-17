// Refactored Shared Worker using CRSqliteSharedWorker class
import { CRSqliteSharedWorker } from './worker/CRSqliteSharedWorker';
import { createDB } from './databaseFactory';
import { DB } from '@vlcn.io/crsqlite-wasm';

const initializeWorker = async () => {
  try {
    console.log('[SharedWorker] Initializing...');
    
    // Create and initialize TestDB
    let db: DB | undefined;
    
    // Create CRSqliteSharedWorker with the DB instance
    const worker = new CRSqliteSharedWorker(() => db!);
    
    // Set up connection handler immediately (no awaits above it)
    self.addEventListener('connect', (event: any) => {
      console.log('[SharedWorker] got connect, ports:', event?.ports?.length);
      worker.onConnect(event.ports[0]);
    });

    // Init db
    db = await createDB("test.db");

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