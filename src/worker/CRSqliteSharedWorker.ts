// Reusable CRSqlite Shared Worker class
import { DB } from "@vlcn.io/crsqlite-wasm";
import { CRSqliteWorkerBase, WorkerResponse } from "./CRSqliteWorkerBase";

export class CRSqliteSharedWorker extends CRSqliteWorkerBase {
  private pendingPorts: MessagePort[] = [];

  constructor(db: DB | (() => DB)) {
    super(db);
  }

  async start(): Promise<void> {
    await super.start();

    try {
      this.processPendingPorts();
    } catch (error) {
      console.error("[CRSqliteSharedWorker] Failed to start:", error);
      this.isStarted = false;
      throw error;
    }
  }

  onConnect(port: MessagePort): void {
    console.log(
      "[CRSqliteSharedWorker] New tab connected, isStarted:",
      this.isStarted
    );

    if (this.isStarted) {
      // Worker is ready, set up handlers immediately
      this.setupPortHandlers(port);
    } else {
      // Worker not ready yet, queue the connection
      console.log(
        "[CRSqliteSharedWorker] Worker not started, queueing connection"
      );
      this.pendingPorts.push(port);
    }
  }

  private processPendingPorts(): void {
    console.log(
      `[CRSqliteSharedWorker] Processing ${this.pendingPorts.length} pending connections`
    );

    while (this.pendingPorts.length > 0) {
      const port = this.pendingPorts.shift()!;
      this.setupPortHandlers(port);
    }
  }

  private setupPortHandlers(port: MessagePort): void {
    console.log(
      "[CRSqliteSharedWorker] Setting up port handlers for connected tab"
    );

    port.addEventListener("message", (m) => this.handleClientMessage(m.data, port));

    port.start();

    port.postMessage({
      type: "ready",
      siteId: this.workerSiteId,
    } as WorkerResponse);
  }

  stop(): void {
    super.stop();
    this.pendingPorts.length = 0;
  }
}
