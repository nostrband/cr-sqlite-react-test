import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App-v5";
import { CRSqliteQueryProvider } from "./CRSqliteQueryProvider";
import { createDB, closeDB } from "./databaseFactory";
import "./index.css";
// @ts-ignore
import sharedWorkerUrl from "./shared-worker-v3.ts?sharedworker&url";
import { notifyTablesChanged, queryClient, setOnLocalChanges } from "./queryClient";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <CRSqliteQueryProvider
      sharedWorkerUrl={sharedWorkerUrl}
      createDB={() => createDB(":memory:")}
      closeDB={closeDB}
      queryClient={queryClient}
      setOnLocalChanges={setOnLocalChanges}
      onRemoteChanges={(tables) => notifyTablesChanged(tables, false)}
    >
      <App />
    </CRSqliteQueryProvider>
  </React.StrictMode>
);
