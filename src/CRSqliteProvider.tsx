import {
  createContext,
  useContext,
  useState,
  useEffect,
  ReactNode,
} from "react";
import { TestDB } from "./TestDB";
import { CRSqliteWorkerClientBrowser } from "./worker/CRSqliteWorkerClientBrowser";

type DbStatus = "initializing" | "ready" | "error";

interface CRSqliteContextType {
  dbStatus: DbStatus;
  error: string | null;
  testDB: TestDB | null;
  client: CRSqliteWorkerClientBrowser | null;
  setError: (error: string | null) => void;
  retryInitialization: () => Promise<void>;
  onDataChanged: () => void;
}

const CRSqliteContext = createContext<CRSqliteContextType | undefined>(
  undefined
);

interface CRSqliteProviderProps {
  children: ReactNode;
  sharedWorkerUrl: string;
  db: TestDB;
}

export function CRSqliteProvider({
  children,
  db,
  sharedWorkerUrl,
}: CRSqliteProviderProps) {
  const [dbStatus, setDbStatus] = useState<DbStatus>("initializing");
  const [error, setError] = useState<string | null>(null);
  const [testDB] = useState(db);
  const [client, setClient] = useState<CRSqliteWorkerClientBrowser | null>(
    null
  );
  const [dataChangeListeners, setDataChangeListeners] = useState<
    (() => void)[]
  >([]);

  useEffect(() => {
    initializeDatabase();

    // Cleanup on unmount
    return () => {
      if (client) {
        client.stop();
      }
      testDB.close();
    };
  }, []);

  const initializeDatabase = async () => {
    try {
      setDbStatus("initializing");
      setError(null);

      // Initialize local TestDB
      await testDB.initialize();

      // Create and configure tab sync
      console.log("sharedWorkerUrl", sharedWorkerUrl);
      const sync = new CRSqliteWorkerClientBrowser({
        db: testDB.db,
        sharedWorkerUrl,
      });

      // Set up event handlers
      sync.onSyncData(() => {
        notifyDataChanged();
      });

      sync.onErrorOccurred((errorMsg) => {
        setError(errorMsg);
      });

      // Start synchronization
      await sync.start();

      setClient(sync);
      setDbStatus("ready");

      // Notify initial data load
      notifyDataChanged();

      console.log("[CRSqliteProvider] Initialized successfully");
    } catch (err) {
      setDbStatus("error");
      setError((err as Error).message);
      console.error("[CRSqliteProvider] Initialization failed:", err);
    }
  };

  const retryInitialization = async () => {
    // Stop existing sync if any
    if (client) {
      client.stop();
      setClient(null);
    }

    await initializeDatabase();
  };

  const notifyDataChanged = () => {
    dataChangeListeners.forEach((listener) => {
      try {
        listener();
      } catch (error) {
        console.error(
          "[CRSqliteProvider] Error in data change listener:",
          error
        );
      }
    });
  };

  const onDataChanged = (listener: () => void) => {
    setDataChangeListeners((prev) => [...prev, listener]);

    // Return cleanup function
    return () => {
      setDataChangeListeners((prev) => prev.filter((l) => l !== listener));
    };
  };

  const contextValue: CRSqliteContextType = {
    dbStatus,
    error,
    testDB,
    client: client,
    setError,
    retryInitialization,
    onDataChanged: () => {
      // This is a bit of a hack - we return a function that can be used to register listeners
      // In practice, components should use the hook pattern
      notifyDataChanged();
    },
  };

  return (
    <CRSqliteContext.Provider value={contextValue}>
      {children}
    </CRSqliteContext.Provider>
  );
}

export function useCRSqlite() {
  const context = useContext(CRSqliteContext);
  if (context === undefined) {
    throw new Error("useCRSqlite must be used within a CRSqliteProvider");
  }
  return context;
}

// Custom hook for data changes
export function useCRSqliteData<T>(
  dataLoader: () => Promise<T>,
  deps: any[] = []
) {
  const { testDB, dbStatus } = useCRSqlite();
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);

  const loadData = async () => {
    if (!testDB || dbStatus !== "ready") return;

    try {
      setLoading(true);
      const result = await dataLoader();
      setData(result);
    } catch (error) {
      console.error("[useCRSqliteData] Error loading data:", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [testDB, dbStatus, ...deps]);

  // Set up data change listener
  useEffect(() => {
    if (dbStatus !== "ready") return;

    const cleanup = () => {
      loadData();
    };

    // Listen for data changes
    const interval = setInterval(() => {
      loadData();
    }, 100); // Check for changes every 100ms

    return () => {
      clearInterval(interval);
    };
  }, [dbStatus]);

  return { data, loading, reload: loadData };
}
