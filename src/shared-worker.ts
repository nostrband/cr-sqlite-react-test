// Shared Worker for persistent database storage and synchronization
import sqliteWasm, { SQLite3, DB } from "@vlcn.io/crsqlite-wasm";

interface Change {
  table: string;
  pk: Uint8Array;
  cid: string;
  val: any;
  col_version: number;
  db_version: number;
  site_id: Uint8Array;
  cl: number;
  seq: number;
}

interface WorkerMessage {
  type: 'sync' | 'ready-check';
  data?: any;
}

interface WorkerResponse {
  type: 'sync-data' | 'ready' | 'error';
  data?: any;
  error?: string;
}

let sqlite: SQLite3 | null = null;
let db: DB | null = null;
let isReady = false;
let broadcastChannel: BroadcastChannel | null = null;

const createTables = async (database: DB) => {
  // Create tables
  await database.exec(`CREATE TABLE IF NOT EXISTS todo_list ("name" primary key not null, "creation_time");`);
  await database.exec(`CREATE TABLE IF NOT EXISTS todo ("id" primary key not null, "list", "text", "complete");`);

  // Make these tables 'tracked' by cr-sqlite
  await database.exec(`SELECT crsql_as_crr('todo_list');`);
  await database.exec(`SELECT crsql_as_crr('todo');`);
};

const initializeDatabase = async () => {
  try {
    console.log('[SharedWorker] Initializing database...');
    
    // Initialize sqlite with wasm file loader
    sqlite = await sqliteWasm(
      (_file: string) => "https://esm.sh/@vlcn.io/crsqlite-wasm@0.16.0/dist/crsqlite.wasm"
    );

    // Open persistent database
    db = await sqlite.open("test.db");
    
    // Create tables
    await createTables(db);
    
    // Initialize broadcast channel for tab communication
    broadcastChannel = new BroadcastChannel('db-sync');
    
    // Listen for changes from tabs
    broadcastChannel.addEventListener('message', handleBroadcastMessage);
    
    isReady = true;
    console.log('[SharedWorker] Database initialized successfully');
    
    // Broadcast ready message
    broadcastChannel.postMessage({
      type: 'ready',
      data: { timestamp: Date.now() }
    });
    
  } catch (error) {
    console.error('[SharedWorker] Failed to initialize database:', error);
    isReady = false;
  }
};

const handleBroadcastMessage = async (event: MessageEvent) => {
  const message = event.data;
  console.log('[SharedWorker] Received broadcast message:', message);
  
  if (message.type === 'changes' && db) {
    try {
      // Apply changes from tabs to persistent database
      await applyChangesToDatabase(message.data.changes);
      
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

const applyChangesToDatabase = async (changes: Change[]) => {
  if (!db || !changes || changes.length === 0) return;
  
  console.log(`[SharedWorker] Applying ${changes.length} changes to persistent database`);
  
  try {
    await db.tx(async (tx: any) => {
      for (const change of changes) {
        await tx.exec(
          `INSERT INTO crsql_changes VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            change.table,
            change.pk,
            change.cid,
            change.val,
            change.col_version,
            change.db_version,
            change.site_id,
            change.cl,
            change.seq
          ]
        );
      }
    });
    console.log('[SharedWorker] Successfully applied changes to persistent database');
  } catch (error) {
    console.error('[SharedWorker] Error applying changes to database:', error);
    throw error;
  }
};

const getAllChanges = async (): Promise<Change[]> => {
  if (!db) return [];
  
  try {
    const result = await db.execO<Change>("SELECT * FROM crsql_changes");
    return result || [];
  } catch (error) {
    console.error('[SharedWorker] Error getting changes:', error);
    return [];
  }
};

const getAllTodoLists = async () => {
  if (!db) return [];
  
  try {
    const result = await db.execO("SELECT * FROM todo_list ORDER BY creation_time DESC");
    return result || [];
  } catch (error) {
    console.error('[SharedWorker] Error getting todo lists:', error);
    return [];
  }
};

const getAllTodos = async () => {
  if (!db) return [];
  
  try {
    const result = await db.execO("SELECT * FROM todo ORDER BY id");
    return result || [];
  } catch (error) {
    console.error('[SharedWorker] Error getting todos:', error);
    return [];
  }
};

// Handle messages from tabs
self.addEventListener('connect', (event: any) => {
  const port = event.ports[0];
  console.log('[SharedWorker] New tab connected');
  
  port.addEventListener('message', async (messageEvent: MessageEvent) => {
    const message: WorkerMessage = messageEvent.data;
    console.log('[SharedWorker] Received message from tab:', message);
    
    try {
      switch (message.type) {
        case 'ready-check':
          port.postMessage({
            type: 'ready',
            data: { isReady }
          } as WorkerResponse);
          break;
          
        case 'sync':
          if (!isReady || !db) {
            port.postMessage({
              type: 'error',
              error: 'Database not ready'
            } as WorkerResponse);
            return;
          }
          
          // Send all current data to the requesting tab
          const [todoLists, todos, changes] = await Promise.all([
            getAllTodoLists(),
            getAllTodos(),
            getAllChanges()
          ]);
          
          port.postMessage({
            type: 'sync-data',
            data: {
              todoLists,
              todos,
              changes,
              timestamp: Date.now()
            }
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
});

// Initialize the database when the worker starts
initializeDatabase();

console.log('[SharedWorker] Shared worker started');