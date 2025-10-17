import { useState, useEffect } from 'react';
import { useCRSqlite, useCRSqliteData } from './CRSqliteProvider';

interface AppState {
  selectedList: string;
  newTodoText: string;
  newListName: string;
}

function App() {
  const { dbStatus, error, testDB, client: tabSync, setError, retryInitialization } = useCRSqlite();
  
  const [appState, setAppState] = useState<AppState>({
    selectedList: '',
    newTodoText: '',
    newListName: ''
  });

  // Use custom hooks for data loading
  const { data: todoLists, loading: listsLoading, reload: reloadLists } = useCRSqliteData(
    async () => testDB ? await testDB.getTodoLists() : [],
    []
  );

  const { data: todos, loading: todosLoading, reload: reloadTodos } = useCRSqliteData(
    async () => testDB ? await testDB.getTodos() : [],
    []
  );

  const { data: changes, loading: changesLoading, reload: reloadChanges } = useCRSqliteData(
    async () => testDB ? await testDB.getChanges() : [],
    []
  );

  // Set default selected list when todo lists load
  useEffect(() => {
    if (todoLists && todoLists.length > 0 && !appState.selectedList) {
      setAppState(prev => ({
        ...prev,
        selectedList: todoLists[0].name
      }));
    }
  }, [todoLists, appState.selectedList]);

  const reloadAllData = () => {
    reloadLists();
    reloadTodos();
    reloadChanges();
  };

  const handleAddTodo = async () => {
    if (!appState.newTodoText.trim() || !appState.selectedList || !testDB) return;
    
    try {
      await testDB.addTodo(appState.selectedList, appState.newTodoText.trim());
      setAppState(prev => ({ ...prev, newTodoText: '' }));
      reloadAllData();
    } catch (err) {
      console.error('Error adding todo:', err);
      setError((err as Error).message);
    }
  };

  const handleDeleteTodo = async (id: string) => {
    if (!testDB) return;
    
    try {
      await testDB.deleteTodo(id);
      reloadAllData();
    } catch (err) {
      console.error('Error deleting todo:', err);
      setError((err as Error).message);
    }
  };

  const handleToggleTodo = async (id: string) => {
    if (!testDB) return;
    
    try {
      await testDB.toggleTodo(id);
      reloadAllData();
    } catch (err) {
      console.error('Error toggling todo:', err);
      setError((err as Error).message);
    }
  };

  const handleAddList = async () => {
    if (!appState.newListName.trim() || !testDB) return;
    
    try {
      await testDB.addTodoList(appState.newListName.trim());
      setAppState(prev => ({
        ...prev,
        newListName: '',
        selectedList: appState.newListName.trim()
      }));
      reloadAllData();
    } catch (err) {
      console.error('Error adding list:', err);
      setError((err as Error).message);
    }
  };

  const handleDeleteList = async (name: string) => {
    if (!testDB) return;
    
    try {
      await testDB.deleteTodoList(name);
      if (appState.selectedList === name) {
        setAppState(prev => ({
          ...prev,
          selectedList: todoLists && todoLists.length > 1 ? todoLists[0]?.name || '' : ''
        }));
      }
      reloadAllData();
    } catch (err) {
      console.error('Error deleting list:', err);
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

  const filteredTodos = todos ? todos.filter(todo => todo.list === appState.selectedList) : [];

  if (dbStatus === 'initializing') {
    return (
      <div className="app">
        <div className="loading">Initializing CRSqlite Provider...</div>
      </div>
    );
  }

  if (dbStatus === 'error') {
    return (
      <div className="app">
        <h1>CRSqlite Provider Test</h1>
        <div className="error">
          <strong>Database Error:</strong> {error}
        </div>
        <button className="btn btn-primary" onClick={retryInitialization}>
          Retry Initialization
        </button>
      </div>
    );
  }

  return (
    <div className="app">
      <h1>CRSqlite Provider Test</h1>
      
      <div className="sync-controls">
        <button className="btn btn-primary" onClick={handleManualSync}>
          Manual Sync
        </button>
        <div className="status" style={{ marginLeft: '20px' }}>
          <strong>Tab ID:</strong> {tabSync?.getTabId() || 'N/A'} | 
          <strong> Broadcast Version:</strong> {tabSync?.getLastBroadcastVersion() || 0} | 
          <strong> Sync Status:</strong> {tabSync?.isRunning() ? 'Running' : 'Stopped'} | 
          <strong> Changes:</strong> {changes?.length || 0} | 
          <strong> Todos:</strong> {todos?.length || 0}
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
          
          {listsLoading ? (
            <div>Loading lists...</div>
          ) : todoLists && todoLists.length > 0 ? (
            <table className="table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Created</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {todoLists.map((list) => (
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
            
            {todosLoading ? (
              <div>Loading todos...</div>
            ) : filteredTodos.length > 0 ? (
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
          {changesLoading ? (
            <div>Loading changes...</div>
          ) : changes && changes.length > 0 ? (
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
                {changes.slice(-5).map((change, index) => (
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
          {changes && changes.length > 5 && (
            <p style={{ textAlign: 'center', color: '#666', fontSize: '12px' }}>
              Showing last 5 changes (total: {changes.length})
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

export default App;