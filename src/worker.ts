/// <reference lib="webworker" />
import { createDB } from "./databaseFactory";
import type { DB } from "@vlcn.io/crsqlite-wasm";
import { CRSqliteDedicatedWorker } from "./worker/CRSqliteDedicatedWorker";

async function main() {
  console.log('[Worker] Initializing...');
  let db: DB | undefined;
  const getDB = () => db!;

  // Create ASAP to make sure 'message' handler is attached early
  const worker = new CRSqliteDedicatedWorker(getDB);

  // Init DB AFTER wiring connect handler so early messages are delivered
  db = await createDB("test.db");
  await worker.start();

  console.log('[Worker] Initialized successfully');
}

main().then(() => {
  console.log('[Worker] Started');
}).catch((e) => {
  // make sure errors surface to devtools
  console.error('[Worker] Failed to initialize:', e);
});

