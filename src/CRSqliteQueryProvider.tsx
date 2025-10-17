// CRSqlite Provider with TanStack Query integration and createDB/closeDB pattern
import {
  createContext,
  useContext,
  useState,
  useEffect,
  ReactNode,
} from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { DB } from "@vlcn.io/crsqlite-wasm";
import { CRSqliteWorkerClientBrowser } from "./worker/CRSqliteWorkerClientBrowser";

type DbStatus = "initializing" | "ready" | "error";

interface CRSqliteQueryContextType {
  dbStatus: DbStatus;
  error: string | null;
  db: DB | null;
  client: CRSqliteWorkerClientBrowser | null;
  setError: (error: string | null) => void;
  retryInitialization: () => Promise<void>;
  dbExec: (sql: string, args?: any[]) => Promise<any>;
  getWorkerSiteId: () => Uint8Array | null;
}

const CRSqliteQueryContext = createContext<
  CRSqliteQueryContextType | undefined
>(undefined);

interface CRSqliteQueryProviderProps {
  children: ReactNode;
  sharedWorkerUrl?: string;
  dedicatedWorkerUrl?: string;
  createDB: () => Promise<DB>;
  closeDB: (db: DB) => Promise<void>;
  queryClient: QueryClient;
  setOnLocalChanges: (cb: () => void) => void;
  onRemoteChanges: (tables: string[]) => void;
}

export function CRSqliteQueryProvider({
  children,
  sharedWorkerUrl,
  dedicatedWorkerUrl,
  createDB,
  closeDB,
  queryClient,
  setOnLocalChanges,
  onRemoteChanges,
}: CRSqliteQueryProviderProps) {
  const [dbStatus, setDbStatus] = useState<DbStatus>("initializing");
  const [error, setError] = useState<string | null>(null);
  const [db, setDb] = useState<DB | null>(null);
  const [client, setClient] = useState<CRSqliteWorkerClientBrowser | null>(
    null
  );

  useEffect(() => {
    initializeDatabase();

    // Cleanup on unmount
    return () => {
      cleanup();
    };
  }, []);

  const cleanup = async () => {
    if (client) {
      client.stop();
    }
    if (db) {
      try {
        await closeDB(db);
      } catch (err) {
        console.error("[CRSqliteQueryProvider] Error closing database:", err);
      }
    }
  };

  const initializeDatabase = async () => {
    try {
      setDbStatus("initializing");
      setError(null);

      // Create database using provided factory
      const database = await createDB();
      setDb(database);

      // Create and configure tab sync with callback
      console.log("sharedWorkerUrl", sharedWorkerUrl);
      const sync = new CRSqliteWorkerClientBrowser({
        db: database,
        sharedWorkerUrl,
        dedicatedWorkerUrl,
        onTablesChanged: onRemoteChanges,
      });

      // Set up local changes callback to trigger sync
      setOnLocalChanges(() => {
        sync.triggerSync();
      });

      // Set up event handlers
      sync.onSyncData(() => {
        // Additional sync data handling if needed
        console.log("[CRSqliteQueryProvider] Sync data received");
      });

      sync.onErrorOccurred((errorMsg) => {
        setError(errorMsg);
      });

      // Start synchronization
      await sync.start();

      setClient(sync);
      setDbStatus("ready");

      console.log("[CRSqliteQueryProvider] Initialized successfully");
    } catch (err) {
      setDbStatus("error");
      setError((err as Error).message);
      console.error("[CRSqliteQueryProvider] Initialization failed:", err);
    }
  };

  const retryInitialization = async () => {
    // Cleanup existing resources
    await cleanup();
    setDb(null);
    setClient(null);

    // Retry initialization
    await initializeDatabase();
  };

  const dbExec = async (sql: string, args: any[] = []): Promise<any> => {
    if (!client || !db) {
      throw new Error("Database or TabSync not available");
    }
    return client.dbExec(sql, args);
  };

  const getWorkerSiteId = (): Uint8Array | null => {
    return client?.getWorkerSiteId() || null;
  };

  const contextValue: CRSqliteQueryContextType = {
    dbStatus,
    error,
    db,
    client,
    setError,
    retryInitialization,
    dbExec,
    getWorkerSiteId,
  };

  return (
    <QueryClientProvider client={queryClient}>
      <CRSqliteQueryContext.Provider value={contextValue}>
        {children}
      </CRSqliteQueryContext.Provider>
    </QueryClientProvider>
  );
}

export function useCRSqliteQuery() {
  const context = useContext(CRSqliteQueryContext);
  if (context === undefined) {
    throw new Error(
      "useCRSqliteQuery must be used within a CRSqliteQueryProvider"
    );
  }
  return context;
}
