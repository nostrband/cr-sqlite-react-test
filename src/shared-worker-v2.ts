// Shared Worker using TestDB for persistent storage
import { TestDB, Change } from './TestDB';

interface WorkerMessage {
  type: 'sync';
  data?: any;
}

interface WorkerResponse {
  type: 'sync-data' | 'error';
  data?: Change[];
  error?: string;
}

interface BroadcastMessage {
  type: 'changes';
  data: Change[];
  sourceTabId?: string;
}

let testDB: TestDB | null = null;
let broadcastChannel: BroadcastChannel | null = null;
let isReady = false;

const initializeDatabase = async () => {
  try {
    console.log('[SharedWorker] Initializing TestDB with test.db...');
    
    testDB = new TestDB("test.db");
    await testDB.initialize();
    
    // Initialize broadcast channel for tab communication
    broadcastChannel = new BroadcastChannel('db-sync');
    broadcastChannel.addEventListener('message', handleBroadcastMessage);
    
    isReady = true;
    console.log('[SharedWorker] TestDB initialized successfully');
    
    // Process any pending connections
    handlePendingConnections();
    
  } catch (error) {
    console.error('[SharedWorker] Failed to initialize TestDB:', error);
    isReady = false;
  }
};

const handleBroadcastMessage = async (event: MessageEvent) => {
  const message: BroadcastMessage = event.data;
  console.log('[SharedWorker] Received broadcast message:', message);
  
  if (message.type === 'changes' && testDB && message.data) {
    try {
      // Apply changes from tabs to persistent database
      await testDB.applyChanges(message.data);
      
      // Broadcast the changes to other tabs (excluding sender)
      if (broadcastChannel) {
        broadcastChannel.postMessage({
          type: 'changes-applied',
          data: message.data,
          sourceTabId: message.sourceTabId
        });
      }
    } catch (error) {
      console.error('[SharedWorker] Error applying changes:', error);
    }
  }
};

// Queue for pending connections
const pendingConnections: MessagePort[] = [];

const handlePendingConnections = () => {
  console.log(`[SharedWorker] Processing ${pendingConnections.length} pending connections`);
  
  while (pendingConnections.length > 0) {
    const port = pendingConnections.shift()!;
    setupPortHandlers(port);
  }
};

const setupPortHandlers = (port: MessagePort) => {
  console.log('[SharedWorker] Setting up port handlers for connected tab');
  
  port.addEventListener('message', async (messageEvent: MessageEvent) => {
    const message: WorkerMessage = messageEvent.data;
    console.log('[SharedWorker] Received message from tab:', message);
    
    try {
      switch (message.type) {
        case 'sync':
          if (!isReady || !testDB) {
            port.postMessage({
              type: 'error',
              error: 'Database not ready'
            } as WorkerResponse);
            return;
          }
          
          // Send all current changes to the requesting tab
          const changes = await testDB.getChanges();
          
          port.postMessage({
            type: 'sync-data',
            data: changes
          } as WorkerResponse);
          break;
          
        default:
          console.warn('[SharedWorker] Unknown message type:', message.type);
      }
    } catch (error) {
      console.error('[SharedWorker] Error handling message:', error);
      port.postMessage({
        type: 'error',
        error: (error as Error).message
      } as WorkerResponse);
    }
  });
  
  port.start();
};

// Handle messages from tabs
self.addEventListener('connect', (event: any) => {
  const port = event.ports[0];
  console.log('[SharedWorker] New tab connected, isReady:', isReady);
  
  if (isReady) {
    // Database is ready, set up handlers immediately
    setupPortHandlers(port);
  } else {
    // Database not ready yet, queue the connection
    console.log('[SharedWorker] Database not ready, queueing connection');
    pendingConnections.push(port);
  }
});

// Initialize the database when the worker starts
initializeDatabase();

console.log('[SharedWorker] Shared worker started');