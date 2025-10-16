// Simple self-contained shared worker for testing
console.log('[SharedWorker] Simple shared worker starting...');

interface WorkerMessage {
  type: 'sync' | 'test';
  data?: any;
}

interface WorkerResponse {
  type: 'sync-data' | 'error' | 'test-response';
  data?: any;
  error?: string;
}

let isReady = true;

// Handle messages from tabs
self.addEventListener('connect', (event: any) => {
  const port = event.ports[0];
  console.log('[SharedWorker] New tab connected');
  
  port.addEventListener('message', async (messageEvent: MessageEvent) => {
    const message: WorkerMessage = messageEvent.data;
    console.log('[SharedWorker] Received message from tab:', message);
    
    try {
      switch (message.type) {
        case 'test':
          port.postMessage({
            type: 'test-response',
            data: { message: 'Worker is working!', timestamp: Date.now() }
          } as WorkerResponse);
          break;
          
        case 'sync':
          if (!isReady) {
            port.postMessage({
              type: 'error',
              error: 'Worker not ready'
            } as WorkerResponse);
            return;
          }
          
          // Send empty sync data for now
          port.postMessage({
            type: 'sync-data',
            data: []
          } as WorkerResponse);
          break;
          
        default:
          console.warn('[SharedWorker] Unknown message type:', message.type);
      }
    } catch (error) {
      console.error('[SharedWorker] Error handling message:', error);
      port.postMessage({
        type: 'error',
        error: (error as Error).message
      } as WorkerResponse);
    }
  });
  
  port.start();
});

console.log('[SharedWorker] Simple shared worker initialized');