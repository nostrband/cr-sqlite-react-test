// Reusable CRSqlite Tab Synchronization class
import { DB } from "@vlcn.io/crsqlite-wasm";
import {
  createSharedWorkerShim,
  MessagePortLike,
  SharedWorkerLike,
} from "./sharedworker-shim";

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
  type: "sync" | "exec";
  data?: any;
  sql?: string;
  args?: any[];
}

interface WorkerResponse {
  type: "sync-data" | "error" | "exec-reply";
  data?: Change[];
  error?: string;
  result?: any;
}

interface BroadcastMessage {
  type: "changes" | "changes-applied";
  data?: Change[];
  sourceTabId?: string;
}

export class CRSqliteTabSync {
  private db: DB;
  private sharedWorkerUrl: string;
  private worker: SharedWorkerLike | null = null;
  private port: MessagePortLike | null = null;
  private broadcastChannel: BroadcastChannel | null = null;
  private tabId: string;
  private lastBroadcastVersion = 0;
  private changeInterval: NodeJS.Timeout | null = null;
  private isStarted = false;
  private siteId: Uint8Array | null = null;
  private pendingExecRequests = new Map<
    string,
    { resolve: (result: any) => void; reject: (error: Error) => void }
  >();
  private execRequestCounter = 0;

  // Event handlers
  private onSyncDataReceived: ((data: Change[]) => void) | null = null;
  private onError: ((error: string) => void) | null = null;
  private onTablesChanged: ((tables: string[]) => void) | null = null;

  constructor(
    db: DB,
    sharedWorkerUrl: string,
    onTablesChanged?: (tables: string[]) => void
  ) {
    this.db = db;
    this.sharedWorkerUrl = sharedWorkerUrl;
    this.tabId = `tab-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    this.onTablesChanged = onTablesChanged || null;
  }

  async start(): Promise<void> {
    if (this.isStarted) return;

    try {
      console.log("[CRSqliteTabSync] Starting...");

      // Get our site_id for filtering
      const siteIdResult = await this.db.execO<{ site_id: Uint8Array }>(
        "SELECT crsql_site_id() as site_id"
      );
      this.siteId = siteIdResult?.[0]?.site_id;
      if (!this.siteId) throw new Error("No local site_id");
      console.log("[CRSqliteTabSync] Local site_id: ", this.siteId);

      // Initialize shared worker
      this.worker = await createSharedWorkerShim(this.sharedWorkerUrl, {
        type: "module",
        name: "crsqlite-sync-" + this.tabId,
      });

      this.port = this.worker.port;

      // Set up worker message handling
      this.port.addEventListener(
        "message",
        this.handleWorkerMessage.bind(this)
      );
      this.port.start();

      // Set up broadcast channel
      this.broadcastChannel = new BroadcastChannel("db-sync");
      this.broadcastChannel.addEventListener(
        "message",
        this.handleBroadcastMessage.bind(this)
      );

      // Request initial sync immediately
      this.port.postMessage({ type: "sync" } as WorkerMessage);

      // Start periodic change detection
      this.startChangeDetection();

      this.isStarted = true;
      console.log("[CRSqliteTabSync] Started successfully");
    } catch (error) {
      console.error("[CRSqliteTabSync] Failed to start:", error);
      if (this.onError) {
        this.onError((error as Error).message);
      }
      throw error;
    }
  }

  stop(): void {
    if (!this.isStarted) return;

    console.log("[CRSqliteTabSync] Stopping...");

    if (this.changeInterval) {
      clearInterval(this.changeInterval);
      this.changeInterval = null;
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
    this.isStarted = false;
    this.lastBroadcastVersion = 0;

    console.log("[CRSqliteTabSync] Stopped");
  }

  private handleWorkerMessage(event: MessageEvent): void {
    const response: WorkerResponse = event.data;
    console.log("[CRSqliteTabSync] Received worker message:", response);

    switch (response.type) {
      case "sync-data":
        if (response.data && this.onSyncDataReceived) {
          this.applyChanges(response.data)
            .then(() => {
              // Update last broadcast version after applying initial sync
              if (response.data!.length > 0) {
                const maxVersion = Math.max(
                  ...response.data!.map((c: Change) => c.db_version)
                );
                this.lastBroadcastVersion = maxVersion;
                console.log(
                  `[CRSqliteTabSync] Updated lastBroadcastVersion to ${maxVersion} after initial sync`
                );
              }

              if (this.onSyncDataReceived) {
                this.onSyncDataReceived(response.data!);
              }
            })
            .catch((error) => {
              console.error(
                "[CRSqliteTabSync] Error applying sync data:",
                error
              );
              if (this.onError) {
                this.onError(error.message);
              }
            });
        }
        break;

      case "exec-reply":
        // Handle exec reply by resolving the corresponding promise
        const requestId = (event.data as any).requestId;
        if (requestId && this.pendingExecRequests.has(requestId)) {
          const { resolve } = this.pendingExecRequests.get(requestId)!;
          this.pendingExecRequests.delete(requestId);
          resolve(response.result);
        }
        break;

      case "error":
        console.error("[CRSqliteTabSync] Worker error:", response.error);

        // Check if this error is for a pending exec request
        const errorRequestId = (event.data as any).requestId;
        if (errorRequestId && this.pendingExecRequests.has(errorRequestId)) {
          const { reject } = this.pendingExecRequests.get(errorRequestId)!;
          this.pendingExecRequests.delete(errorRequestId);
          reject(new Error(response.error || "Unknown worker error"));
        } else if (this.onError) {
          this.onError(response.error || "Unknown worker error");
        }
        break;
    }
  }

  private handleBroadcastMessage(event: MessageEvent): void {
    const message: BroadcastMessage = event.data;
    console.log("[CRSqliteTabSync] Received broadcast message:", message);

    // Ignore messages from this tab
    if (message.sourceTabId === this.tabId) {
      return;
    }

    switch (message.type) {
      case "changes-applied":
        if (message.data) {
          this.applyChanges(message.data)
            .then(() => {
              // Don't update broadcast version for external changes
              if (this.onSyncDataReceived) {
                this.onSyncDataReceived(message.data!);
              }
            })
            .catch((error) => {
              console.error(
                "[CRSqliteTabSync] Error applying broadcast changes:",
                error
              );
              if (this.onError) {
                this.onError(error.message);
              }
            });
        }
        break;
    }
  }

  private async applyChanges(changes: Change[]): Promise<void> {
    if (!changes || changes.length === 0) return;

    console.log(`[CRSqliteTabSync] Applying ${changes.length} changes`);

    try {
      const touched = new Set<string>();
      const filteredChanges: Change[] = [];

      // Filter out changes from our own site_id to avoid infinite loops
      for (const change of changes) {
        if (this.siteId && this.arraysEqual(change.site_id, this.siteId)) {
          console.log(`[CRSqliteTabSync] Skipping change from own site_id`);
          continue;
        }
        filteredChanges.push(change);
        touched.add(change.table);
      }

      if (filteredChanges.length === 0) {
        console.log(`[CRSqliteTabSync] No external changes to apply`);
        return;
      }

      await this.db.tx(async (tx: any) => {
        for (const change of filteredChanges) {
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
              change.seq,
            ]
          );
        }
      });

      // Now that changes are visible, notify TanStack Query to invalidate affected queries
      // This is NOT a local change, so don't trigger sync
      if (touched.size > 0 && this.onTablesChanged) {
        this.onTablesChanged([...touched]);
      }

      console.log(
        `[CRSqliteTabSync] Successfully applied ${filteredChanges.length} external changes`
      );
    } catch (error) {
      console.error(`[CRSqliteTabSync] Error applying changes:`, error);
      throw error;
    }
  }

  private arraysEqual(a: Uint8Array, b: Uint8Array): boolean {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) return false;
    }
    return true;
  }

  private startChangeDetection(): void {
    // We no longer need periodic change detection since local changes
    // are now triggered explicitly via triggerSync() when mutations occur
    console.log("[CRSqliteTabSync] Change detection now handled via callbacks");
  }

  private async getChangesAfterVersion(dbVersion: number): Promise<Change[]> {
    try {
      const result = await this.db.execO<Change>(
        `SELECT * FROM crsql_changes WHERE db_version > ? AND site_id = crsql_site_id()`,
        [dbVersion]
      );
      return result || [];
    } catch (error) {
      console.error(
        "[CRSqliteTabSync] Error getting changes after version:",
        error
      );
      return [];
    }
  }

  async requestSync(): Promise<void> {
    if (!this.port || !this.isStarted) {
      console.warn(
        "[CRSqliteTabSync] Cannot sync - not started or port not available"
      );
      return;
    }

    console.log("[CRSqliteTabSync] Requesting manual sync");
    this.port.postMessage({ type: "sync" } as WorkerMessage);
  }

  // Event handler setters
  onSyncData(handler: (data: Change[]) => void): void {
    this.onSyncDataReceived = handler;
  }

  onErrorOccurred(handler: (error: string) => void): void {
    this.onError = handler;
  }

  getTabId(): string {
    return this.tabId;
  }

  getLastBroadcastVersion(): number {
    return this.lastBroadcastVersion;
  }

  isRunning(): boolean {
    return this.isStarted;
  }

  // Method to trigger sync manually (called by local changes)
  triggerSync(): void {
    if (!this.isStarted) return;
    console.log("[CRSqliteTabSync] Triggering sync due to local changes");
    // Force immediate change detection
    this.checkForLocalChanges();
  }

  private async checkForLocalChanges(): Promise<void> {
    try {
      // Only check for changes that are newer than what we last broadcasted
      const changes = await this.getChangesAfterVersion(
        this.lastBroadcastVersion
      );

      if (changes.length > 0) {
        console.log(
          `[CRSqliteTabSync] Found ${changes.length} local changes after broadcast version ${this.lastBroadcastVersion}`
        );

        // Check if broadcast channel is still open
        if (this.broadcastChannel) {
          // Broadcast all new changes
          this.broadcastChannel.postMessage({
            type: "changes",
            data: changes,
            sourceTabId: this.tabId,
          } as BroadcastMessage);

          // Update the last broadcast version to prevent re-broadcasting
          const maxVersion = Math.max(...changes.map((c) => c.db_version));
          this.lastBroadcastVersion = maxVersion;
          console.log(
            `[CRSqliteTabSync] Broadcasted ${changes.length} changes, updated broadcast version to ${maxVersion}`
          );
        }
      }
    } catch (error) {
      console.error(
        "[CRSqliteTabSync] Error checking for local changes:",
        error
      );
      if (this.onError) {
        this.onError((error as Error).message);
      }
    }
  }

  // Remote database execution method
  async dbExec(sql: string, args: any[] = []): Promise<any> {
    if (!this.port || !this.isStarted) {
      throw new Error("TabSync not started or port not available");
    }

    return new Promise((resolve, reject) => {
      const requestId = `exec-${this.execRequestCounter++}`;

      // Store the promise handlers
      let timeout: ReturnType<typeof setTimeout> | null = null;

      this.pendingExecRequests.set(requestId, {
        resolve: (v) => {
          if (timeout) clearTimeout(timeout);
          resolve(v);
        },
        reject,
      });

      // Send exec message to worker with request ID
      this.port!.postMessage({
        type: "exec",
        sql,
        args,
        requestId,
      } as WorkerMessage & { requestId: string });

      // Set a timeout to avoid hanging forever
      timeout = setTimeout(() => {
        if (this.pendingExecRequests.has(requestId)) {
          this.pendingExecRequests.delete(requestId);
          reject(new Error("Database execution timeout"));
        }
      }, 10000); // 10 second timeout
    });
  }
}
