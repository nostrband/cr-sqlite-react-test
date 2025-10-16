// Worker Manager for handling shared worker communication and synchronization
import { Change } from './database';

interface WorkerMessage {
  type: 'sync' | 'ready-check';
  data?: any;
}

interface WorkerResponse {
  type: 'sync-data' | 'ready' | 'error';
  data?: any;
  error?: string;
}

interface SyncData {
  todoLists: any[];
  todos: any[];
  changes: Change[];
  timestamp: number;
}

interface BroadcastMessage {
  type: 'changes' | 'changes-applied' | 'ready';
  data?: any;
  sourceTabId?: string;
}

class WorkerManager {
  private worker: SharedWorker | null = null;
  private port: MessagePort | null = null;
  private broadcastChannel: BroadcastChannel | null = null;
  private isReady = false;
  private tabId: string;
  private lastDbVersion = 0;
  private syncInterval: number | null = null;
  
  // Event handlers
  private onSyncDataReceived: ((data: SyncData) => void) | null = null;
  private onChangesReceived: ((changes: Change[]) => void) | null = null;
  private onWorkerReady: (() => void) | null = null;

  constructor() {
    this.tabId = `tab-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    console.log(`[WorkerManager] Initialized with tabId: ${this.tabId}`);
  }

  async initialize(): Promise<boolean> {
    try {
      console.log('[WorkerManager] Initializing shared worker connection...');
      
      // Create shared worker
      this.worker = new SharedWorker(new URL('./shared-worker.ts', import.meta.url), {
        type: 'module'
      });
      
      this.port = this.worker.port;
      
      // Set up message handling
      this.port.addEventListener('message', this.handleWorkerMessage.bind(this));
      this.port.start();
      
      // Set up broadcast channel
      this.broadcastChannel = new BroadcastChannel('db-sync');
      this.broadcastChannel.addEventListener('message', this.handleBroadcastMessage.bind(this));
      
      // Wait for worker to be ready
      await this.waitForWorkerReady();
      
      // Request initial sync
      await this.requestSync();
      
      // Start periodic change detection
      this.startPeriodicSync();
      
      console.log('[WorkerManager] Successfully initialized');
      return true;
      
    } catch (error) {
      console.error('[WorkerManager] Failed to initialize:', error);
      return false;
    }
  }

  private async waitForWorkerReady(): Promise<void> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Worker ready timeout'));
      }, 10000); // 10 second timeout
      
      const checkReady = () => {
        if (!this.port) {
          reject(new Error('Port not available'));
          return;
        }
        
        this.port.postMessage({ type: 'ready-check' } as WorkerMessage);
        
        const handleResponse = (event: MessageEvent) => {
          const response: WorkerResponse = event.data;
          if (response.type === 'ready' && response.data?.isReady) {
            clearTimeout(timeout);
            this.port!.removeEventListener('message', handleResponse);
            this.isReady = true;
            resolve();
          } else if (response.type === 'ready' && !response.data?.isReady) {
            // Worker not ready yet, try again
            setTimeout(checkReady, 100);
          }
        };
        
        this.port.addEventListener('message', handleResponse);
      };
      
      checkReady();
    });
  }

  private handleWorkerMessage(event: MessageEvent) {
    const response: WorkerResponse = event.data;
    console.log('[WorkerManager] Received worker message:', response);
    
    switch (response.type) {
      case 'sync-data':
        if (response.data && this.onSyncDataReceived) {
          this.lastDbVersion = Math.max(...(response.data.changes?.map((c: Change) => c.db_version) || [0]));
          this.onSyncDataReceived(response.data);
        }
        break;
        
      case 'error':
        console.error('[WorkerManager] Worker error:', response.error);
        break;
    }
  }

  private handleBroadcastMessage(event: MessageEvent) {
    const message: BroadcastMessage = event.data;
    console.log('[WorkerManager] Received broadcast message:', message);
    
    // Ignore messages from this tab
    if (message.sourceTabId === this.tabId) {
      return;
    }
    
    switch (message.type) {
      case 'ready':
        if (this.onWorkerReady) {
          this.onWorkerReady();
        }
        break;
        
      case 'changes-applied':
        if (message.data?.changes && this.onChangesReceived) {
          this.onChangesReceived(message.data.changes);
        }
        break;
    }
  }

  async requestSync(): Promise<void> {
    if (!this.port || !this.isReady) {
      console.warn('[WorkerManager] Cannot sync - worker not ready');
      return;
    }
    
    console.log('[WorkerManager] Requesting sync from worker');
    this.port.postMessage({ type: 'sync' } as WorkerMessage);
  }

  broadcastChanges(changes: Change[]): void {
    if (!this.broadcastChannel || !changes.length) {
      return;
    }
    
    console.log(`[WorkerManager] Broadcasting ${changes.length} changes`);
    this.broadcastChannel.postMessage({
      type: 'changes',
      data: { changes },
      sourceTabId: this.tabId
    } as BroadcastMessage);
  }

  private startPeriodicSync(): void {
    // Check for changes every 1 second
    this.syncInterval = window.setInterval(() => {
      // This will be implemented by the calling code to check for local changes
      // and broadcast them if found
    }, 1000);
  }

  // Event handler setters
  onSyncData(handler: (data: SyncData) => void): void {
    this.onSyncDataReceived = handler;
  }

  onChanges(handler: (changes: Change[]) => void): void {
    this.onChangesReceived = handler;
  }

  onReady(handler: () => void): void {
    this.onWorkerReady = handler;
  }

  getLastDbVersion(): number {
    return this.lastDbVersion;
  }

  updateLastDbVersion(version: number): void {
    this.lastDbVersion = Math.max(this.lastDbVersion, version);
  }

  destroy(): void {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
      this.syncInterval = null;
    }
    
    if (this.broadcastChannel) {
      this.broadcastChannel.close();
      this.broadcastChannel = null;
    }
    
    if (this.port) {
      this.port.close();
      this.port = null;
    }
    
    this.worker = null;
    this.isReady = false;
  }
}

export default WorkerManager;
export type { SyncData, BroadcastMessage };