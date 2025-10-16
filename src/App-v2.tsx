import React, { useState, useEffect } from 'react';
import { TestDB, TodoList, Todo, Change } from './TestDB';

type DbStatus = 'initializing' | 'ready' | 'error';

// Global variable to track last broadcast version (for testing)
let globalLastBroadcastVersion = 0;

interface AppState {
  todoLists: TodoList[];
  todos: Todo[];
  selectedList: string;
  newTodoText: string;
  newListName: string;
  changes: Change[];
}

function App() {
  const [dbStatus, setDbStatus] = useState<DbStatus>('initializing');
  const [error, setError] = useState<string | null>(null);
  const [testDB] = useState(() => new TestDB(':memory:'));
  const [worker, setWorker] = useState<SharedWorker | null>(null);
  const [port, setPort] = useState<MessagePort | null>(null);
  const [broadcastChannel] = useState(() => new BroadcastChannel('db-sync'));
  const [lastDbVersion, setLastDbVersion] = useState(0);
  const [tabId] = useState(`tab-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`);
  const [changeInterval, setChangeInterval] = useState<NodeJS.Timeout | null>(null);
  
  const [appState, setAppState] = useState<AppState>({
    todoLists: [],
    todos: [],
    selectedList: '',
    newTodoText: '',
    newListName: '',
    changes: []
  });

  useEffect(() => {
    initializeApp();
    
    // Cleanup on unmount
    return () => {
      if (changeInterval) {
        clearInterval(changeInterval);
      }
      testDB.close();
      broadcastChannel.close();
      if (port) {
        port.close();
      }
    };
  }, []);

  const initializeApp = async () => {
    try {
      setDbStatus('initializing');
      
      // Initialize local TestDB
      await testDB.initialize();
      
      // Initialize shared worker
      const sharedWorker = new SharedWorker(new URL('./shared-worker-v3.ts', import.meta.url), {
        type: 'module'
      });
      
      setWorker(sharedWorker);
      const workerPort = sharedWorker.port;
      setPort(workerPort);
      
      // Set up worker message handling
      workerPort.addEventListener('message', handleWorkerMessage);
      workerPort.start();
      
      // Set up broadcast channel
      broadcastChannel.addEventListener('message', handleBroadcastMessage);
      
      // Request initial sync immediately
      workerPort.postMessage({ type: 'sync' });
      
      // Start periodic change detection
      startChangeDetection();
      
      setDbStatus('ready');
      console.log('[App] Initialized successfully');
      
    } catch (err) {
      setDbStatus('error');
      setError((err as Error).message);
    }
  };

  const handleWorkerMessage = async (event: MessageEvent) => {
    const response = event.data;
    console.log('[App] Received worker message:', response);
    
    switch (response.type) {
      case 'sync-data':
        if (response.data) {
          // Apply changes from worker to local database
          await testDB.applyChanges(response.data);
          
          // Update last db version
          if (response.data.length > 0) {
            const maxVersion = Math.max(...response.data.map((c: Change) => c.db_version));
            setLastDbVersion(maxVersion);
          }
          
          // Refresh UI
          await loadAllData();
        }
        break;
        
      case 'error':
        console.error('[App] Worker error:', response.error);
        setError(response.error);
        break;
    }
  };

  const handleBroadcastMessage = async (event: MessageEvent) => {
    const message = event.data;
    console.log('[App] Received broadcast message:', message);
    
    // Ignore messages from this tab
    if (message.sourceTabId === tabId) {
      return;
    }
    
    switch (message.type) {
      case 'changes-applied':
        if (message.data) {
          // Apply changes from other tabs
          await testDB.applyChanges(message.data);
          
          // Update last db version to prevent re-broadcasting these changes
          if (message.data.length > 0) {
            const maxVersion = Math.max(...message.data.map((c: Change) => c.db_version));
            const newLastVersion = Math.max(lastDbVersion, maxVersion);
            setLastDbVersion(newLastVersion);
            // Don't update broadcast version here - these are external changes
            console.log(`[App] Updated lastDbVersion to ${newLastVersion} after applying external changes`);
          }
          
          // Refresh UI
          await loadAllData();
        }
        break;
    }
  };

  const startChangeDetection = () => {
    // Check for local changes every 1 second
    const interval = setInterval(async () => {
      try {
        // Only check for changes that are newer than what we last broadcasted
        const changes = await testDB.getChangesAfterVersion(globalLastBroadcastVersion);
        
        if (changes.length > 0) {
          console.log(`[App] Found ${changes.length} changes after broadcast version ${globalLastBroadcastVersion}`);
          
          // Check if broadcast channel is still open
          if (broadcastChannel) {
            // Broadcast all new changes
            broadcastChannel.postMessage({
              type: 'changes',
              data: changes,
              sourceTabId: tabId
            });
            
            // Update the last broadcast version to prevent re-broadcasting
            const maxVersion = Math.max(...changes.map(c => c.db_version));
            globalLastBroadcastVersion = maxVersion;
            setLastDbVersion(maxVersion);
            console.log(`[App] Broadcasted ${changes.length} changes, updated broadcast version to ${maxVersion}`);
          }
        }
      } catch (error) {
        console.error('[App] Error checking for changes:', error);
      }
    }, 1000);
    
    setChangeInterval(interval);
  };

  const loadAllData = async () => {
    try {
      const todoLists = await testDB.getTodoLists();
      const todos = await testDB.getTodos();
      const changes = await testDB.getChanges();
      
      setAppState(prev => ({
        ...prev,
        todoLists,
        todos,
        changes,
        selectedList: prev.selectedList || (todoLists.length > 0 ? todoLists[0].name : '')
      }));
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const handleAddTodo = async () => {
    if (!appState.newTodoText.trim() || !appState.selectedList) return;
    
    try {
      await testDB.addTodo(appState.selectedList, appState.newTodoText.trim());
      setAppState(prev => ({ ...prev, newTodoText: '' }));
      await loadAllData();
    } catch (err) {
      console.error('Error adding todo:', err);
      setError((err as Error).message);
    }
  };

  const handleDeleteTodo = async (id: string) => {
    try {
      await testDB.deleteTodo(id);
      await loadAllData();
    } catch (err) {
      console.error('Error deleting todo:', err);
      setError((err as Error).message);
    }
  };

  const handleToggleTodo = async (id: string) => {
    try {
      await testDB.toggleTodo(id);
      await loadAllData();
    } catch (err) {
      console.error('Error toggling todo:', err);
      setError((err as Error).message);
    }
  };

  const handleAddList = async () => {
    if (!appState.newListName.trim()) return;
    
    try {
      await testDB.addTodoList(appState.newListName.trim());
      setAppState(prev => ({
        ...prev,
        newListName: '',
        selectedList: appState.newListName.trim()
      }));
      await loadAllData();
    } catch (err) {
      console.error('Error adding list:', err);
      setError((err as Error).message);
    }
  };

  const handleDeleteList = async (name: string) => {
    try {
      await testDB.deleteTodoList(name);
      if (appState.selectedList === name) {
        setAppState(prev => ({
          ...prev,
          selectedList: appState.todoLists.length > 1 ? appState.todoLists[0]?.name || '' : ''
        }));
      }
      await loadAllData();
    } catch (err) {
      console.error('Error deleting list:', err);
      setError((err as Error).message);
    }
  };

  const handleManualSync = async () => {
    try {
      if (port) {
        port.postMessage({ type: 'sync' });
      }
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const filteredTodos = appState.todos.filter(todo => todo.list === appState.selectedList);

  if (dbStatus === 'initializing') {
    return (
      <div className="app">
        <div className="loading">Initializing TestDB with shared worker...</div>
      </div>
    );
  }

  if (dbStatus === 'error') {
    return (
      <div className="app">
        <h1>TestDB Shared Worker Test</h1>
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
      <h1>TestDB Shared Worker Test</h1>
      
      <div className="sync-controls">
        <button className="btn btn-primary" onClick={handleManualSync}>
          Manual Sync
        </button>
        <div className="status" style={{ marginLeft: '20px' }}>
          <strong>Tab ID:</strong> {tabId} | 
          <strong> DB Version:</strong> {lastDbVersion} | 
          <strong> Changes:</strong> {appState.changes.length} | 
          <strong> Todos:</strong> {appState.todos.length}
        </div>
      </div>

      {error && (
        <div className="error">
          <strong>Error:</strong> {error}
          <button onClick={() => setError(null)} style={{ float: 'right' }}>×</button>
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
              onChange={(e) => setAppState(prev => ({ ...prev, newListName: e.target.value }))}
              onKeyPress={(e) => e.key === 'Enter' && handleAddList()}
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
                  <tr key={list.name} style={{ 
                    backgroundColor: appState.selectedList === list.name ? '#e8f5e8' : 'transparent' 
                  }}>
                    <td>
                      <button 
                        onClick={() => setAppState(prev => ({ ...prev, selectedList: list.name }))}
                        style={{ 
                          background: 'none', 
                          border: 'none', 
                          cursor: 'pointer',
                          fontWeight: appState.selectedList === list.name ? 'bold' : 'normal'
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
                onChange={(e) => setAppState(prev => ({ ...prev, newTodoText: e.target.value }))}
                onKeyPress={(e) => e.key === 'Enter' && handleAddTodo()}
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
                      <td style={{ 
                        textDecoration: todo.complete === 1 ? 'line-through' : 'none',
                        color: todo.complete === 1 ? '#666' : 'inherit'
                      }}>
                        {todo.text}
                      </td>
                      <td><code>{todo.id}</code></td>
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
                    <td><code>{Array.from(change.pk).join(',')}</code></td>
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
            <p style={{ textAlign: 'center', color: '#666', fontSize: '12px' }}>
              Showing last 5 changes (total: {appState.changes.length})
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

export default App;