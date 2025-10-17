import { useState, useEffect } from "react";
import { TestDB, TodoList, Todo, Change } from "./TestDB";
import { CRSqliteWorkerClientBrowser } from "./worker/CRSqliteWorkerClientBrowser";

type DbStatus = "initializing" | "ready" | "error";

interface AppState {
  todoLists: TodoList[];
  todos: Todo[];
  selectedList: string;
  newTodoText: string;
  newListName: string;
  changes: Change[];
}

function App() {
  const [dbStatus, setDbStatus] = useState<DbStatus>("initializing");
  const [error, setError] = useState<string | null>(null);
  const [testDB] = useState(() => new TestDB(":memory:"));
  const [tabSync, setTabSync] = useState<CRSqliteWorkerClientBrowser | null>(
    null
  );

  const [appState, setAppState] = useState<AppState>({
    todoLists: [],
    todos: [],
    selectedList: "",
    newTodoText: "",
    newListName: "",
    changes: [],
  });

  useEffect(() => {
    initializeApp();

    // Cleanup on unmount
    return () => {
      if (tabSync) {
        tabSync.stop();
      }
      testDB.close();
    };
  }, []);

  const initializeApp = async () => {
    try {
      setDbStatus("initializing");

      // Initialize local TestDB
      await testDB.initialize();

      // Create and configure tab sync
      const sync = new CRSqliteWorkerClientBrowser({
        db: testDB.db,
        sharedWorkerUrl: "./shared-worker-v3.ts",
      });

      // Set up event handlers
      sync.onSyncData(() => {
        loadAllData();
      });

      sync.onErrorOccurred((errorMsg) => {
        setError(errorMsg);
      });

      // Start synchronization
      await sync.start();

      setTabSync(sync);
      setDbStatus("ready");

      // Load initial data
      await loadAllData();

      console.log("[App] Initialized successfully");
    } catch (err) {
      setDbStatus("error");
      setError((err as Error).message);
    }
  };

  const loadAllData = async () => {
    try {
      const todoLists = await testDB.getTodoLists();
      const todos = await testDB.getTodos();
      const changes = await testDB.getChanges();

      setAppState((prev) => ({
        ...prev,
        todoLists,
        todos,
        changes,
        selectedList:
          prev.selectedList || (todoLists.length > 0 ? todoLists[0].name : ""),
      }));
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const handleAddTodo = async () => {
    if (!appState.newTodoText.trim() || !appState.selectedList) return;

    try {
      await testDB.addTodo(appState.selectedList, appState.newTodoText.trim());
      setAppState((prev) => ({ ...prev, newTodoText: "" }));
      await loadAllData();
    } catch (err) {
      console.error("Error adding todo:", err);
      setError((err as Error).message);
    }
  };

  const handleDeleteTodo = async (id: string) => {
    try {
      await testDB.deleteTodo(id);
      await loadAllData();
    } catch (err) {
      console.error("Error deleting todo:", err);
      setError((err as Error).message);
    }
  };

  const handleToggleTodo = async (id: string) => {
    try {
      await testDB.toggleTodo(id);
      await loadAllData();
    } catch (err) {
      console.error("Error toggling todo:", err);
      setError((err as Error).message);
    }
  };

  const handleAddList = async () => {
    if (!appState.newListName.trim()) return;

    try {
      await testDB.addTodoList(appState.newListName.trim());
      setAppState((prev) => ({
        ...prev,
        newListName: "",
        selectedList: appState.newListName.trim(),
      }));
      await loadAllData();
    } catch (err) {
      console.error("Error adding list:", err);
      setError((err as Error).message);
    }
  };

  const handleDeleteList = async (name: string) => {
    try {
      await testDB.deleteTodoList(name);
      if (appState.selectedList === name) {
        setAppState((prev) => ({
          ...prev,
          selectedList:
            appState.todoLists.length > 1
              ? appState.todoLists[0]?.name || ""
              : "",
        }));
      }
      await loadAllData();
    } catch (err) {
      console.error("Error deleting list:", err);
      setError((err as Error).message);
    }
  };

  const handleManualSync = async () => {
    try {
      if (tabSync) {
        await tabSync.requestSync();
      }
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const filteredTodos = appState.todos.filter(
    (todo) => todo.list === appState.selectedList
  );

  if (dbStatus === "initializing") {
    return (
      <div className="app">
        <div className="loading">Initializing CRSqliteTabSync...</div>
      </div>
    );
  }

  if (dbStatus === "error") {
    return (
      <div className="app">
        <h1>CRSqlite Tab Sync Test</h1>
        <div className="error">
          <strong>Database Error:</strong> {error}
        </div>
        <button className="btn btn-primary" onClick={initializeApp}>
          Retry Initialization
        </button>
      </div>
    );
  }

  return (
    <div className="app">
      <h1>CRSqlite Tab Sync Test</h1>

      <div className="sync-controls">
        <button className="btn btn-primary" onClick={handleManualSync}>
          Manual Sync
        </button>
        <div className="status" style={{ marginLeft: "20px" }}>
          <strong>Tab ID:</strong> {tabSync?.getTabId() || "N/A"} |
          <strong> Broadcast Version:</strong>{" "}
          {tabSync?.getLastBroadcastVersion() || 0} |
          <strong> Sync Status:</strong>{" "}
          {tabSync?.isRunning() ? "Running" : "Stopped"} |
          <strong> Changes:</strong> {appState.changes.length} |
          <strong> Todos:</strong> {appState.todos.length}
        </div>
      </div>

      {error && (
        <div className="error">
          <strong>Error:</strong> {error}
          <button onClick={() => setError(null)} style={{ float: "right" }}>
            ×
          </button>
        </div>
      )}

      <div className="database-panel">
        <div className="section">
          <h3>Todo Lists</h3>
          <div className="form">
            <input
              type="text"
              placeholder="New list name..."
              value={appState.newListName}
              onChange={(e) =>
                setAppState((prev) => ({
                  ...prev,
                  newListName: e.target.value,
                }))
              }
              onKeyPress={(e) => e.key === "Enter" && handleAddList()}
            />
            <button className="btn btn-primary" onClick={handleAddList}>
              Add List
            </button>
          </div>

          {appState.todoLists.length > 0 ? (
            <table className="table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Created</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {appState.todoLists.map((list) => (
                  <tr
                    key={list.name}
                    style={{
                      backgroundColor:
                        appState.selectedList === list.name
                          ? "#e8f5e8"
                          : "transparent",
                    }}
                  >
                    <td>
                      <button
                        onClick={() =>
                          setAppState((prev) => ({
                            ...prev,
                            selectedList: list.name,
                          }))
                        }
                        style={{
                          background: "none",
                          border: "none",
                          cursor: "pointer",
                          fontWeight:
                            appState.selectedList === list.name
                              ? "bold"
                              : "normal",
                        }}
                      >
                        {list.name}
                      </button>
                    </td>
                    <td>{new Date(list.creation_time).toLocaleString()}</td>
                    <td>
                      <button
                        className="btn btn-danger"
                        onClick={() => handleDeleteList(list.name)}
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="empty-state">No todo lists found</div>
          )}
        </div>

        {appState.selectedList && (
          <div className="section">
            <h3>Todos in "{appState.selectedList}"</h3>
            <div className="form">
              <input
                type="text"
                placeholder="New todo..."
                value={appState.newTodoText}
                onChange={(e) =>
                  setAppState((prev) => ({
                    ...prev,
                    newTodoText: e.target.value,
                  }))
                }
                onKeyPress={(e) => e.key === "Enter" && handleAddTodo()}
              />
              <button className="btn btn-primary" onClick={handleAddTodo}>
                Add Todo
              </button>
            </div>

            {filteredTodos.length > 0 ? (
              <table className="table">
                <thead>
                  <tr>
                    <th>Status</th>
                    <th>Text</th>
                    <th>ID</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredTodos.map((todo) => (
                    <tr key={todo.id}>
                      <td>
                        <input
                          type="checkbox"
                          checked={todo.complete === 1}
                          onChange={() => handleToggleTodo(todo.id)}
                        />
                      </td>
                      <td
                        style={{
                          textDecoration:
                            todo.complete === 1 ? "line-through" : "none",
                          color: todo.complete === 1 ? "#666" : "inherit",
                        }}
                      >
                        {todo.text}
                      </td>
                      <td>
                        <code>{todo.id}</code>
                      </td>
                      <td>
                        <button
                          className="btn btn-danger"
                          onClick={() => handleDeleteTodo(todo.id)}
                        >
                          Delete
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div className="empty-state">No todos in this list</div>
            )}
          </div>
        )}

        <div className="section">
          <h3>CR-SQLite Changes (Debug)</h3>
          {appState.changes.length > 0 ? (
            <table className="table">
              <thead>
                <tr>
                  <th>Table</th>
                  <th>PK</th>
                  <th>CID</th>
                  <th>Val</th>
                  <th>Col Ver</th>
                  <th>DB Ver</th>
                </tr>
              </thead>
              <tbody>
                {appState.changes.slice(-5).map((change, index) => (
                  <tr key={index}>
                    <td>{change.table}</td>
                    <td>
                      <code>{Array.from(change.pk).join(",")}</code>
                    </td>
                    <td>{change.cid}</td>
                    <td>{change.val}</td>
                    <td>{change.col_version}</td>
                    <td>{change.db_version}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="empty-state">No changes recorded yet</div>
          )}
          {appState.changes.length > 5 && (
            <p style={{ textAlign: "center", color: "#666", fontSize: "12px" }}>
              Showing last 5 changes (total: {appState.changes.length})
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

export default App;
