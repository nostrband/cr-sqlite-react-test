// Reusable CRSqlite Shared Worker class
import { DB } from "@vlcn.io/crsqlite-wasm";

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

export class CRSqliteSharedWorker {
  private _db: DB | (() => DB);
  private broadcastChannel: BroadcastChannel | null = null;
  private isStarted = false;
  private pendingPorts: MessagePort[] = [];

  constructor(db: DB | (() => DB)) {
    this._db = db;
  }

  get db() {
    return typeof this._db === "function" ? this._db() : this._db;
  }

  async start(): Promise<void> {
    if (this.isStarted) return;

    try {
      console.log('[CRSqliteSharedWorker] Starting...');
      
      // Initialize broadcast channel for tab communication
      this.broadcastChannel = new BroadcastChannel('db-sync');
      this.broadcastChannel.addEventListener('message', this.handleBroadcastMessage.bind(this));
      
      this.isStarted = true;
      console.log('[CRSqliteSharedWorker] Started successfully');
      
      // Process any pending port connections
      this.processPendingPorts();
      
    } catch (error) {
      console.error('[CRSqliteSharedWorker] Failed to start:', error);
      this.isStarted = false;
      throw error;
    }
  }

  onConnect(port: MessagePort): void {
    console.log('[CRSqliteSharedWorker] New tab connected, isStarted:', this.isStarted);
    
    if (this.isStarted) {
      // Worker is ready, set up handlers immediately
      this.setupPortHandlers(port);
    } else {
      // Worker not ready yet, queue the connection
      console.log('[CRSqliteSharedWorker] Worker not started, queueing connection');
      this.pendingPorts.push(port);
    }
  }

  private processPendingPorts(): void {
    console.log(`[CRSqliteSharedWorker] Processing ${this.pendingPorts.length} pending connections`);
    
    while (this.pendingPorts.length > 0) {
      const port = this.pendingPorts.shift()!;
      this.setupPortHandlers(port);
    }
  }

  private setupPortHandlers(port: MessagePort): void {
    console.log('[CRSqliteSharedWorker] Setting up port handlers for connected tab');
    
    port.addEventListener('message', async (messageEvent: MessageEvent) => {
      const message: WorkerMessage = messageEvent.data;
      console.log('[CRSqliteSharedWorker] Received message from tab:', message);
      
      try {
        switch (message.type) {
          case 'sync':
            if (!this.isStarted) {
              port.postMessage({
                type: 'error',
                error: 'Worker not started'
              } as WorkerResponse);
              return;
            }
            
            // Send all current changes to the requesting tab
            const changes = await this.getAllChanges();
            
            port.postMessage({
              type: 'sync-data',
              data: changes
            } as WorkerResponse);
            break;
            
          default:
            console.warn('[CRSqliteSharedWorker] Unknown message type:', message.type);
        }
      } catch (error) {
        console.error('[CRSqliteSharedWorker] Error handling message:', error);
        port.postMessage({
          type: 'error',
          error: (error as Error).message
        } as WorkerResponse);
      }
    });
    
    port.start();
  }

  private async handleBroadcastMessage(event: MessageEvent): Promise<void> {
    const message: BroadcastMessage = event.data;
    console.log('[CRSqliteSharedWorker] Received broadcast message:', message);
    
    if (message.type === 'changes' && message.data) {
      try {
        // Apply changes from tabs to persistent database
        await this.applyChanges(message.data);
        
        // Broadcast the changes to other tabs (excluding sender)
        if (this.broadcastChannel) {
          this.broadcastChannel.postMessage({
            type: 'changes-applied',
            data: message.data,
            sourceTabId: message.sourceTabId
          });
        }
      } catch (error) {
        console.error('[CRSqliteSharedWorker] Error applying changes:', error);
      }
    }
  }

  private async getAllChanges(): Promise<Change[]> {
    try {
      const result = await this.db.execO<Change>("SELECT * FROM crsql_changes");
      return result || [];
    } catch (error) {
      console.error('[CRSqliteSharedWorker] Error getting changes:', error);
      return [];
    }
  }

  private async applyChanges(changes: Change[]): Promise<void> {
    if (!changes || changes.length === 0) return;
    
    console.log(`[CRSqliteSharedWorker] Applying ${changes.length} changes to persistent database`);
    
    try {
      await this.db.tx(async (tx: any) => {
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
      console.log('[CRSqliteSharedWorker] Successfully applied changes to persistent database');
    } catch (error) {
      console.error('[CRSqliteSharedWorker] Error applying changes to database:', error);
      throw error;
    }
  }

  stop(): void {
    if (this.broadcastChannel) {
      this.broadcastChannel.close();
      this.broadcastChannel = null;
    }
    this.isStarted = false;
    this.pendingPorts.length = 0;
  }
}