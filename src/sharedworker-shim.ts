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

  // Native fast path
  if ("SharedWorker" in window && supportsNativeSharedWorkerModule()) {
    // @ts-ignore
    const sw = new SharedWorker(workerUrl as any, { name, type });
    return { port: sw.port };
  }

  // ---- Shim path ----
  const chan = new BroadcastChannel<ShimMsg>(`sw:${name}`);
  const elector: LeaderElector = createLeaderElection(chan);

  // Kick off lazy election by awaiting leadership in the background.
  // This resolves only if THIS instance becomes leader.
  void elector.awaitLeadership().then(async () => {
    if (!leaderStarted) {
      leaderStarted = true;
      await startLeaderHost(chan, name, workerUrl, type);
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

  // Wait for leader-ready announcement
  let leaderReady = false;
  let resolveReady!: () => void;
  const readyP = new Promise<void>((r) => (resolveReady = r));

  const readyHandler = (msg: ShimMsg) => {
    if (msg?.t === "__shim_ready" && !leaderReady) {
      leaderReady = true;
      resolveReady();
    }
  };
  chan.addEventListener("message", readyHandler);

  if (!(await elector.hasLeader())) {
    chan.postMessage({ t: "__shim_hello", clientId });
  }

  if (!leaderReady) {
    await Promise.race([
      readyP,
      (async () => {
        if (elector.isLeader && !leaderStarted) {
          leaderStarted = true;
          await startLeaderHost(chan, name, workerUrl, type);
        }
      })(),
    ]);
  }

  // Create virtual port and announce presence
  const port = createVirtualPort(chan, clientId);
  chan.postMessage({ t: "__shim_hello", clientId });

  const unload = () => chan.postMessage({ t: "__shim_disconnect", clientId });
  window.addEventListener("beforeunload", unload, { once: true });

  // Cleanup helper for terminate()
  const cleanup = async () => {
    try {
      window.removeEventListener("beforeunload", unload);
      port.close();
      chan.removeEventListener("message", readyHandler as any);
      await elector.die().catch(() => void 0);
      await chan.close();
    } catch {}
  };

  return { port, terminate: cleanup };
}

let leaderStarted = false;

function stableName(s: string) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return `sw-${h.toString(36)}`;
}

function createVirtualPort(
  chan: BroadcastChannel<ShimMsg>,
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
  chan.addEventListener("message", toClientHandler);

  return {
    postMessage: (data: any) => {
      if (!closed)
        chan.postMessage({ t: "__shim_toLeader", clientId, payload: data });
    },
    start: () => {},
    close: () => {
      if (closed) return;
      closed = true;
      chan.postMessage({ t: "__shim_disconnect", clientId });
      chan.removeEventListener("message", toClientHandler as any);
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
  chan: BroadcastChannel<ShimMsg>,
  _name: string,
  workerUrl: string | URL,
  type: "classic" | "module"
) {
  const absUrl = String(new URL(String(workerUrl), globalThis.location?.href));
  const bootstrap = `
    const clients = new Map(); // clientId -> VirtualPort

    class VirtualPort extends EventTarget {
      constructor(id){ super(); this.id=id; this._closed=false; this._on=null; }
      postMessage(d){ self.postMessage({ __toClient: this.id, payload: d }); }
      start() {}
      close(){ this._closed=true; }
      addEventListener(t, l){ super.addEventListener(t,l); }
      removeEventListener(t, l){ super.removeEventListener(t,l); }
      get onmessage(){ return this._on || null; }
      set onmessage(fn){ if(this._on) this.removeEventListener('message', this._on); this._on=fn; if(fn) this.addEventListener('message', fn); }
      _deliver(d){ const ev = new MessageEvent('message', { data: d }); this.dispatchEvent(ev); }
    }

    let hasConnect = false;
    const pend = [];
    const origAdd = self.addEventListener.bind(self);
    self.addEventListener = (t, l, o) => { if (t==='connect') hasConnect=true; return origAdd(t,l,o); };

    function doConnect(id){
      const p = new VirtualPort(id);
      clients.set(id, p);
      const ev = new MessageEvent('connect', { ports: [p] });
      dispatchEvent(ev);
    }

    self.onmessage = (e) => {
      const m = e.data;
      if (!m) return;
      if (m.__cmd === '__connect') {
        if (hasConnect) doConnect(m.clientId);
        else pend.push(m.clientId);
      } else if (m.__cmd === '__fromClient') {
        const p = clients.get(m.clientId); if (p) p._deliver(m.payload);
      } else if (m.__cmd === '__disconnect') {
        clients.delete(m.clientId);
      }
    };

    async function __afterLoad(){
      if (pend.length) { for (const id of pend) doConnect(id); pend.length = 0; }
    }

    ${
      type === "module"
        ? `import(${JSON.stringify(absUrl)}).then(__afterLoad);`
        : `importScripts(${JSON.stringify(absUrl)}); __afterLoad();`
    }
  `;

  const blob = new Blob([bootstrap], { type: "application/javascript" });
  const url = URL.createObjectURL(blob);
  const dedicated = new Worker(url, { type });

  // Revoke when worker starts
  const revoke = () => {
    try {
      URL.revokeObjectURL(url);
    } catch {}
  };
  dedicated.addEventListener("message", function onceLoaded() {
    revoke();
    dedicated.removeEventListener("message", onceLoaded);
  });
  dedicated.addEventListener("error", () => revoke());

  // Dedicated Worker → followers
  const fromWorker = (e: MessageEvent) => {
    const m = e.data;
    if (m && m.__toClient) {
      chan.postMessage({
        t: "__shim_toClient",
        clientId: m.__toClient,
        payload: m.payload,
      });
    } else if (m && m.__shim_error) {
      console.error("[SW shim] worker error:", m.__shim_error);
    }
  };
  dedicated.onmessage = fromWorker;

  dedicated.onerror = (ev) => {
    console.error("[SW shim] worker onerror", ev);
    chan.postMessage({ t: "__shim_ready" }); // still unblock clients; your code may retry
  };

  // Followers → Dedicated Worker
  const toWorker = (msg: ShimMsg) => {
    if (!msg) return;
    if (msg.t === "__shim_hello") {
      dedicated.postMessage({ __cmd: "__connect", clientId: msg.clientId });
      chan.postMessage({ t: "__shim_ready" });
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
  chan.addEventListener("message", toWorker);

  // Announce readiness
  chan.postMessage({ t: "__shim_ready" });
}
