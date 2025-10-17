// Reusable CRSqlite Tab Synchronization class
import { DB } from "@vlcn.io/crsqlite-wasm";
import { BroadcastMessage, WorkerMessage } from "./CRSqliteWorkerBase";
import { CRSqliteWorkerClientBase } from "./CRSqliteWorkerClientBase";
import { LeaderWebWorker, stableName } from "./LeaderWebWorker";

function supportsNativeSharedWorkerModule(): boolean {
  try {
    const blob = new Blob(["export {};"], { type: "text/javascript" });
    const url = URL.createObjectURL(blob);
    // @ts-ignore
    const w = new SharedWorker(url, { type: "module" });
    w.port.close();
    URL.revokeObjectURL(url);
    return true;
  } catch {
    return false;
  }
}

export class CRSqliteWorkerClientBrowser extends CRSqliteWorkerClientBase {
  private worker: LeaderWebWorker | null = null;
  private port: MessagePort | null = null;
  private broadcastChannel: BroadcastChannel | null = null;
  private sharedWorkerUrl?: string;
  private dedicatedWorkerUrl?: string;

  constructor({
    db,
    onTablesChanged,
    sharedWorkerUrl,
    dedicatedWorkerUrl,
  }: {
    db: DB;
    onTablesChanged?: (tables: string[]) => void;
    sharedWorkerUrl?: string;
    dedicatedWorkerUrl?: string;
  }) {
    super(db, onTablesChanged);
    this.sharedWorkerUrl = sharedWorkerUrl;
    this.dedicatedWorkerUrl = dedicatedWorkerUrl;
  }

  async start(): Promise<void> {
    super.start();

    if (this.isStarted) return;

    // reset to run the second part of the start routine
    this.isStarted = true;
    try {
      if (this.sharedWorkerUrl && supportsNativeSharedWorkerModule()) {
        // Initialize shared worker
        const worker = new SharedWorker(this.sharedWorkerUrl, {
          type: "module",
          name: stableName(String(this.sharedWorkerUrl)),
        });

        this.port = worker.port;

        // Set up worker message handling
        this.port.addEventListener("message", (e) =>
          this.handleWorkerMessage(e.data)
        );
        this.port.start();
      } else if (this.dedicatedWorkerUrl) {
        // Initialize shared worker
        this.worker = new LeaderWebWorker(this.dedicatedWorkerUrl, {
          type: "module",
        });

        // Set up worker message handling
        this.worker.addEventListener("message", (e: MessageEvent) =>
          this.handleWorkerMessage(e.data)
        );
        this.worker.addEventListener("error", ({reason, error}: { reason: string, error?: unknown }) => {
          console.error("[CRSqliteWorkerClientBrowser] Failed to start:", reason, error);
          if (this.onError) {
            this.onError(reason);
          }
        });

        // Starts the worker if tab is leader
        await this.worker.start();
      } else {
        throw new Error("Supported worker mode not available");
      }

      // Set up broadcast channel
      this.broadcastChannel = new BroadcastChannel("db-sync");
      this.broadcastChannel.addEventListener("message", (e) =>
        this.handleBroadcastMessage(e.data)
      );

      // Request initial sync immediately
      this.postMessage({ type: "sync" });

      this.isStarted = true;
      console.log("[CRSqliteWorkerClientBrowser] Started successfully");
    } catch (error) {
      console.error("[CRSqliteWorkerClientBrowser] Failed to start:", error);
      if (this.onError) {
        this.onError((error as Error).message);
      }
      throw error;
    }
  }

  stop(): void {
    if (!this.isStarted) return;

    console.log("[CRSqliteWorkerClientBrowser] Stopping...");

    if (this.broadcastChannel) {
      this.broadcastChannel.close();
      this.broadcastChannel = null;
    }

    if (this.port) {
      this.port.close();
      this.port = null;
    }

    this.worker = null;

    console.log("[CRSqliteWorkerClientBrowser] Stopped");
  }

  protected postMessage(message: WorkerMessage): void {
    if (this.port) this.port.postMessage(message);
    else this.worker!.postMessage(message);
  }

  protected broadcastMessage(message: BroadcastMessage): void {
    this.broadcastChannel!.postMessage(message);
  }
}
