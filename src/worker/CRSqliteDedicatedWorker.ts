/// <reference lib="webworker" />
// Reusable CRSqlite Shared Worker class
import { DB } from "@vlcn.io/crsqlite-wasm";
import { CRSqliteWorkerBase, WorkerResponse } from "./CRSqliteWorkerBase";

export class CRSqliteDedicatedWorker extends CRSqliteWorkerBase {
  private pending: MessageEvent[] = [];

  constructor(db: DB | (() => DB)) {
    super(db);

    // Immediately
    globalThis.addEventListener("message", (m) => {
      if (!this.isStarted) this.pending.push(m);
      else this.handleClientMessage(m.data, globalThis);
    });
  }

  async start(): Promise<void> {
    await super.start();
    try {
      globalThis.postMessage({
        type: "ready",
        siteId: this.workerSiteId,
      } as WorkerResponse);

      for (const m of this.pending) this.handleClientMessage(m.data, globalThis);
      this.pending.length = 0;
    } catch (error) {
      console.error("[CRSqliteSharedWorker] Failed to start:", error);
      this.isStarted = false;
      throw error;
    }
  }
}
