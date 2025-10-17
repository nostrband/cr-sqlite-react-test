/**
 * SharedWorker shim for Android and others:
 * - one tab is elected as leader using broadcast-channel package
 * - leader tab creates a Worker and talks to it using it's postMessage interface
 * - Worker receives a bootstrap script that imitates SharedWorker as self and then imports target shared worker code
 * - shim returns SharedWorkerLike with MessagePortLike
 * - MessagePortLike is virtual port that uses broadcast channels so all tabs could talk to leader
 * - since leader can't receive on it's own broadcast channel, we use two: chanTxClient and chanRxClient
 */

import {
  BroadcastChannel,
  createLeaderElection,
  LeaderElector,
} from "broadcast-channel";

export type SharedWorkerLike = {
  port: MessagePortLike;
  terminate?: () => void; // shim-only
};

export type MessagePortLike = {
  postMessage(data: any): void;
  start(): void;
  close(): void;
  addEventListener(type: "message", listener: (ev: MessageEvent) => void): void;
  removeEventListener(
    type: "message",
    listener: (ev: MessageEvent) => void
  ): void;
  onmessage: ((ev: MessageEvent) => void) | null;
};

type ShimMsg =
  | { t: "__shim_ready" }
  | { t: "__shim_hello"; clientId: string }
  | { t: "__shim_toLeader"; clientId: string; payload: any }
  | { t: "__shim_toClient"; clientId: string; payload: any }
  | { t: "__shim_disconnect"; clientId: string };

// One leader (dedicated Worker host) per unique worker "name".
const leadersStarted = new Set<string>();

function supportsNativeSharedWorkerModule(): boolean {
  try {
    const blob = new Blob(["export {};"], { type: "application/javascript" });
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

export async function createSharedWorkerShim(
  workerUrl: string | URL,
  options?: { name?: string; type?: "classic" | "module" }
): Promise<SharedWorkerLike> {
  const type = options?.type ?? "module";
  const name = options?.name ?? stableName(String(workerUrl));
  const topic = `sw:${name}`;

  // Optional native fast path:
  // if ("SharedWorker" in window && supportsNativeSharedWorkerModule()) {
  //   // @ts-ignore
  //   const sw = new SharedWorker(workerUrl as any, { name, type });
  //   return { port: sw.port };
  // }

  // ---- Shim path ----
  // Client TX/RX are separate so this tab can receive its own rebroadcasts.
  const chanTxClient = new BroadcastChannel<ShimMsg>(topic); // TX-only
  const chanRxClient = new BroadcastChannel<ShimMsg>(topic); // RX-only

  const elector: LeaderElector = createLeaderElection(chanTxClient);

  // Become leader lazily.
  void elector.awaitLeadership().then(async () => {
    if (!leadersStarted.has(name)) {
      leadersStarted.add(name);
      await startLeaderHost(chanTxClient, name, workerUrl, type);
    }
  });

  elector.onduplicate = async () => {
    try {
      await elector.die();
    } catch {}
  };

  const clientId = `${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2)}`;

  // Wait for leader-ready announcement.
  let leaderReady = false;
  let resolveReady!: () => void;
  const readyP = new Promise<void>((r) => (resolveReady = r));

  const readyHandler = (msg: ShimMsg) => {
    if (msg?.t === "__shim_ready" && !leaderReady) {
      leaderReady = true;
      resolveReady();
    }
  };
  // IMPORTANT: listen for ready on RX channel, not TX
  chanRxClient.addEventListener("message", readyHandler);

  // Trigger leader spin-up if none exists.
  if (!(await elector.hasLeader())) {
    chanTxClient.postMessage({ t: "__shim_hello", clientId });
  }

  if (!leaderReady) {
    await Promise.race([
      readyP,
      (async () => {
        if (elector.isLeader && !leadersStarted.has(name)) {
          leadersStarted.add(name);
          await startLeaderHost(chanTxClient, name, workerUrl, type);
        }
      })(),
    ]);
  }

  // Create virtual port and announce presence
  const port = createVirtualPort(chanTxClient, chanRxClient, clientId);
  chanTxClient.postMessage({ t: "__shim_hello", clientId });

  const unload = () =>
    chanTxClient.postMessage({ t: "__shim_disconnect", clientId });
  window.addEventListener("beforeunload", unload, { once: true });

  // Cleanup helper for terminate()
  const cleanup = async () => {
    try {
      window.removeEventListener("beforeunload", unload);
      port.close();
      chanRxClient.removeEventListener("message", readyHandler as any);
      await elector.die().catch(() => void 0);
      await chanRxClient.close();
      await chanTxClient.close();
    } catch {}
  };

  return { port, terminate: cleanup };
}

function stableName(s: string) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return `sw-${h.toString(36)}`;
}

function createVirtualPort(
  chanTxClient: BroadcastChannel<ShimMsg>,
  chanRxClient: BroadcastChannel<ShimMsg>,
  clientId: string
): MessagePortLike {
  let onmessage: ((ev: MessageEvent) => void) | null = null;
  const listeners = new Set<(ev: MessageEvent) => void>();
  let closed = false;

  const toClientHandler = (msg: ShimMsg) => {
    if (closed) return;
    if (msg && msg.t === "__shim_toClient" && msg.clientId === clientId) {
      const ev = new MessageEvent("message", { data: msg.payload });
      onmessage?.(ev);
      for (const fn of listeners) fn(ev);
    }
  };
  chanRxClient.addEventListener("message", toClientHandler);

  return {
    postMessage: (data: any) => {
      if (!closed)
        chanTxClient.postMessage({
          t: "__shim_toLeader",
          clientId,
          payload: data,
        });
    },
    start: () => {},
    close: () => {
      if (closed) return;
      closed = true;
      chanTxClient.postMessage({ t: "__shim_disconnect", clientId });
      chanRxClient.removeEventListener("message", toClientHandler as any);
    },
    addEventListener: (_type, fn) => {
      listeners.add(fn);
    },
    removeEventListener: (_type, fn) => {
      listeners.delete(fn);
    },
    get onmessage() {
      return onmessage;
    },
    set onmessage(fn) {
      if (onmessage && listeners.has(onmessage)) listeners.delete(onmessage);
      onmessage = fn;
      if (fn) listeners.add(fn);
    },
  };
}

async function startLeaderHost(
  chanTxLeader: BroadcastChannel<ShimMsg>, // TX-only rebroadcast
  name: string,
  workerUrl: string | URL,
  type: "classic" | "module"
) {
  const topic = `sw:${name}`;
  const absUrl = String(new URL(String(workerUrl), globalThis.location?.href));

  // Bootstrap that runs *inside* the dedicated Worker.
  const bootstrap = `
    // === Leader host bootstrap (executes inside dedicated Worker) ===
    const clients = new Map(); // clientId -> VirtualPort

    class VirtualPort extends EventTarget {
      constructor(id){
        super();
        this.id = id;
        this._closed = false;
        this._on = null;
        // Port-level buffering: messages delivered before any handler/start()
        this._queue = [];
        this._started = false;
        this._hasExplicitHandler = false;
      }
      postMessage(d){ self.postMessage({ __toClient: this.id, payload: d }); }
      start(){ this._started = true; this._flush(); }
      close(){ this._closed = true; }
      addEventListener(t, l){ 
        super.addEventListener(t,l); 
        if (t === 'message') { this._hasExplicitHandler = true; this._flush(); }
      }
      removeEventListener(t, l){ super.removeEventListener(t,l); }
      get onmessage(){ return this._on || null; }
      set onmessage(fn){ 
        if (this._on) this.removeEventListener('message', this._on); 
        this._on = fn; 
        if(fn) { this.addEventListener('message', fn); this._hasExplicitHandler = true; this._flush(); }
      }
      _deliver(d){ 
        if (!this._canReceive()) { this._queue.push(d); return; }
        const ev = new MessageEvent('message', { data: d }); 
        this.dispatchEvent(ev); 
      }
      _canReceive(){ return this._started || this._hasExplicitHandler; }
      _flush(){
        if (!this._canReceive() || !this._queue.length) return;
        const q = this._queue.splice(0);
        for (const d of q) {
          const ev = new MessageEvent('message', { data: d });
          this.dispatchEvent(ev);
        }
      }
    }

    // Custom ConnectEvent that carries a plain 'ports' array
    class ConnectEvent extends Event {
      constructor(ports){ super('connect'); this.ports = ports; }
    }

    let hasConnect = false;
    const pend = [];                 // clientIds pending connect
    const pendMsgs = new Map();      // clientId -> any[] (buffer messages before connect)

    const origAdd = self.addEventListener.bind(self);
    // Support self.onconnect = ...
    let _onconnect = null;
    Object.defineProperty(self, 'onconnect', {
      get(){ return _onconnect; },
      set(fn){ _onconnect = fn; if (fn) { hasConnect = true; origAdd('connect', fn); } }
    });

    self.addEventListener = (t, l, o) => { if (t==='connect') hasConnect = true; return origAdd(t,l,o); };

    function doConnect(id){
      const p = new VirtualPort(id);
      clients.set(id, p);
      const ev = new ConnectEvent([p]);
      dispatchEvent(ev);

      // Flush any messages buffered before connect
      const q = pendMsgs.get(id);
      if (q && q.length) {
        for (const d of q) p._deliver(d);
        pendMsgs.delete(id);
      }
    }

    self.onmessage = (e) => {
      const m = e.data;
      if (!m) return;
      if (m.__cmd === '__connect') {
        if (hasConnect) doConnect(m.clientId);
        else pend.push(m.clientId);
      } else if (m.__cmd === '__fromClient') {
        const p = clients.get(m.clientId);
        if (p) p._deliver(m.payload);
        else {
          let q = pendMsgs.get(m.clientId);
          if (!q) { q = []; pendMsgs.set(m.clientId, q); }
          q.push(m.payload);
        }
      } else if (m.__cmd === '__disconnect') {
        clients.delete(m.clientId);
        pendMsgs.delete(m.clientId);
      }
    };

    async function __afterLoad(){
      if (pend.length) { for (const id of pend) doConnect(id); pend.length = 0; }
    }

    ${
      type === "module"
        ? `import(${JSON.stringify(absUrl)}).then(__afterLoad, (err)=>self.postMessage({__shim_error:String(err)}));`
        : `try { importScripts(${JSON.stringify(absUrl)}); __afterLoad(); } catch(err) { self.postMessage({__shim_error:String(err)}); }`
    }
  `;

  const blob = new Blob([bootstrap], { type: "application/javascript" });
  const url = URL.createObjectURL(blob);
  const dedicated = new Worker(url, { type });

  const revoke = () => { try { URL.revokeObjectURL(url); } catch {} };
  dedicated.addEventListener("message", function onceLoaded() {
    revoke();
    dedicated.removeEventListener("message", onceLoaded);
  });
  dedicated.addEventListener("error", () => revoke());

  // Dedicated Worker → followers (rebroadcast on TX channel)
  const fromWorker = (e: MessageEvent) => {
    const m = e.data;
    if (m && m.__toClient) {
      chanTxLeader.postMessage({
        t: "__shim_toClient",
        clientId: m.__toClient,
        payload: m.payload,
      });
    } else if (m && m.__shim_error) {
      console.error("[SW shim] worker error:", m.__shim_error);
      chanTxLeader.postMessage({ t: "__shim_ready" }); // unblock clients anyway
    }
  };
  dedicated.onmessage = fromWorker;

  dedicated.onerror = (ev) => {
    console.error("[SW shim] worker onerror", ev);
    chanTxLeader.postMessage({ t: "__shim_ready" }); // unblock clients
  };

  // Followers → Dedicated Worker
  const toWorker = (msg: ShimMsg) => {
    if (!msg) return;
    if (msg.t === "__shim_hello") {
      dedicated.postMessage({ __cmd: "__connect", clientId: msg.clientId });
      chanTxLeader.postMessage({ t: "__shim_ready" });
    } else if (msg.t === "__shim_toLeader") {
      dedicated.postMessage({
        __cmd: "__fromClient",
        clientId: msg.clientId,
        payload: msg.payload,
      });
    } else if (msg.t === "__shim_disconnect") {
      dedicated.postMessage({ __cmd: "__disconnect", clientId: msg.clientId });
    }
  };

  // Leader RX-only so same-tab posts are received
  const chanRxLeader = new BroadcastChannel<ShimMsg>(topic);
  chanRxLeader.addEventListener("message", toWorker);

  // Initial readiness broadcast
  chanTxLeader.postMessage({ t: "__shim_ready" });

  // (Note) This simple shim keeps leader alive for page lifetime.
}
