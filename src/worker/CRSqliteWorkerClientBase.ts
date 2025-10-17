// Reusable CRSqlite Tab Synchronization class
import { DB } from "@vlcn.io/crsqlite-wasm";
import {
  BroadcastMessage,
  Change,
  WorkerMessage,
  WorkerResponse,
} from "./CRSqliteWorkerBase";

export class CRSqliteWorkerClientBase {
  private db: DB;
  protected tabId: string;
  private lastBroadcastVersion = 0;
  private changeInterval: NodeJS.Timeout | null = null;
  protected isStarted = false;
  private siteId: Uint8Array | null = null;
  private workerSiteId: Uint8Array | null = null;
  private pendingExecRequests = new Map<
    string,
    { resolve: (result: any) => void; reject: (error: Error) => void }
  >();
  private execRequestCounter = 0;

  // Event handlers
  private onSyncDataReceived: ((data: Change[]) => void) | null = null;
  protected onError: ((error: string) => void) | null = null;
  private onTablesChanged: ((tables: string[]) => void) | null = null;

  constructor(db: DB, onTablesChanged?: (tables: string[]) => void) {
    this.db = db;
    this.tabId = `tab-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    this.onTablesChanged = onTablesChanged || null;
  }

  async start(): Promise<void> {
    if (this.isStarted) return;

    try {
      console.log("[CRSqliteWorkerClientBase] Starting...");

      // Get our site_id for filtering
      const siteIdResult = await this.db.execO<{ site_id: Uint8Array }>(
        "SELECT crsql_site_id() as site_id"
      );
      this.siteId = siteIdResult?.[0]?.site_id;
      if (!this.siteId) throw new Error("No local site_id");
      console.log("[CRSqliteWorkerClientBase] Local site_id: ", this.siteId);

      this.isStarted = true;
      console.log("[CRSqliteWorkerClientBase] Started successfully");
    } catch (error) {
      console.error("[CRSqliteWorkerClientBase] Failed to start:", error);
      if (this.onError) {
        this.onError((error as Error).message);
      }
      throw error;
    }
  }

  stop(): void {
    if (!this.isStarted) return;

    console.log("[CRSqliteWorkerClientBase] Stopping...");

    if (this.changeInterval) {
      clearInterval(this.changeInterval);
      this.changeInterval = null;
    }

    this.isStarted = false;
    this.lastBroadcastVersion = 0;
    this.workerSiteId = null;

    console.log("[CRSqliteWorkerClientBase] Stopped");
  }

  protected postMessage(message: WorkerMessage) {
    throw new Error("postMessage not implemented in worker client base");
  }

  protected broadcastMessage(message: BroadcastMessage) {
    throw new Error("broadcastMessage not implemented in worker client base");
  }

  protected handleWorkerMessage(response: WorkerResponse): void {
    console.log("[CRSqliteWorkerClientBase] Received worker message:", response);

    switch (response.type) {
      case "sync-data":
        if (response.changes && this.onSyncDataReceived) {
          this.applyChanges(response.changes)
            .then(() => {
              // Update last broadcast version after applying initial sync
              if (response.changes!.length > 0) {
                const maxVersion = Math.max(
                  ...response.changes!.map((c: Change) => c.db_version)
                );
                this.lastBroadcastVersion = maxVersion;
                console.log(
                  `[CRSqliteWorkerClientBase] Updated lastBroadcastVersion to ${maxVersion} after initial sync`
                );
              }

              if (this.onSyncDataReceived) {
                this.onSyncDataReceived(response.changes!);
              }
            })
            .catch((error) => {
              console.error(
                "[CRSqliteWorkerClientBase] Error applying sync data:",
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
        const requestId = response.requestId;
        if (requestId && this.pendingExecRequests.has(requestId)) {
          const { resolve } = this.pendingExecRequests.get(requestId)!;
          this.pendingExecRequests.delete(requestId);
          resolve(response.result);
        }
        break;

      case "ready":
        // Store worker site_id when worker is ready
        if (response.siteId) {
          this.workerSiteId = response.siteId;
          console.log(
            "[CRSqliteWorkerClientBase] Received worker site_id:",
            this.workerSiteId
          );
        }
        break;

      case "error":
        console.error("[CRSqliteWorkerClientBase] Worker error:", response.error);

        // Check if this error is for a pending exec request
        const errorRequestId = response.requestId;
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

  protected handleBroadcastMessage(message: BroadcastMessage): void {
    console.log("[CRSqliteWorkerClientBase] Received broadcast message:", message);

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
                "[CRSqliteWorkerClientBase] Error applying broadcast changes:",
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

    console.log(`[CRSqliteWorkerClientBase] Applying ${changes.length} changes`);

    try {
      const touched = new Set<string>();
      const filteredChanges: Change[] = [];

      // Filter out changes from our own site_id to avoid infinite loops
      for (const change of changes) {
        if (this.siteId && this.arraysEqual(change.site_id, this.siteId)) {
          console.log(`[CRSqliteWorkerClientBase] Skipping change from own site_id`);
          continue;
        }
        filteredChanges.push(change);
        touched.add(change.table);
      }

      if (filteredChanges.length === 0) {
        console.log(`[CRSqliteWorkerClientBase] No external changes to apply`);
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
        `[CRSqliteWorkerClientBase] Successfully applied ${filteredChanges.length} external changes`
      );
    } catch (error) {
      console.error(`[CRSqliteWorkerClientBase] Error applying changes:`, error);
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

  private async getChangesAfterVersion(dbVersion: number): Promise<Change[]> {
    try {
      const result = await this.db.execO<Change>(
        `SELECT * FROM crsql_changes WHERE db_version > ? AND site_id = crsql_site_id()`,
        [dbVersion]
      );
      return result || [];
    } catch (error) {
      console.error(
        "[CRSqliteWorkerClientBase] Error getting changes after version:",
        error
      );
      return [];
    }
  }

  async requestSync(): Promise<void> {
    if (!this.isStarted) {
      console.warn("[CRSqliteWorkerClientBase] Cannot sync - not started");
      return;
    }

    console.log("[CRSqliteWorkerClientBase] Requesting manual sync");
    this.postMessage({ type: "sync" });
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

  getWorkerSiteId(): Uint8Array | null {
    return this.workerSiteId;
  }

  // Method to trigger sync manually (called by local changes)
  triggerSync(): void {
    if (!this.isStarted) return;
    console.log("[CRSqliteWorkerClientBase] Triggering sync due to local changes");
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
          `[CRSqliteWorkerClientBase] Found ${changes.length} local changes after broadcast version ${this.lastBroadcastVersion}`
        );

        this.broadcastMessage({
          type: "changes",
          data: changes,
          sourceTabId: this.tabId,
        });

        // Update the last broadcast version to prevent re-broadcasting
        const maxVersion = Math.max(...changes.map((c) => c.db_version));
        this.lastBroadcastVersion = maxVersion;
        console.log(
          `[CRSqliteWorkerClientBase] Broadcasted ${changes.length} changes, updated broadcast version to ${maxVersion}`
        );
      }
    } catch (error) {
      console.error(
        "[CRSqliteWorkerClientBase] Error checking for local changes:",
        error
      );
      if (this.onError) {
        this.onError((error as Error).message);
      }
    }
  }

  // Remote database execution method
  async dbExec(sql: string, args: any[] = []): Promise<any> {
    if (!this.isStarted) {
      throw new Error("CRSqliteWorkerClientBase not started");
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
      this.postMessage({
        type: "exec",
        sql,
        args,
        requestId,
      });

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
