// App component using TanStack Query for reactive database integration
import { useState, useEffect } from 'react';
import { useCRSqliteQuery } from './CRSqliteQueryProvider';
import { useTodoLists, useTodosByList, useAllTodos, useChanges } from './dbReads';
import { useAddTodoRemote, useToggleTodoRemote, useDeleteTodoRemote, useAddTodoListRemote, useDeleteTodoListRemote } from './dbWrites-remote';

interface AppState {
  selectedList: string;
  newTodoText: string;
  newListName: string;
}

function App() {
  const { dbStatus, error, client: tabSync, setError, retryInitialization, getWorkerSiteId } = useCRSqliteQuery();
  
  const [appState, setAppState] = useState<AppState>({
    selectedList: '',
    newTodoText: '',
    newListName: ''
  });

  // Use TanStack Query hooks for data
  const { data: todoLists = [], isLoading: listsLoading } = useTodoLists();
  const { data: allTodos = [], isLoading: todosLoading } = useAllTodos();
  const { data: changes = [], isLoading: changesLoading } = useChanges();
  const { data: selectedTodos = [], isLoading: selectedTodosLoading } = useTodosByList(appState.selectedList);

  // Get worker site ID for display
  const workerSiteId = getWorkerSiteId();
  const workerSiteIdHex = workerSiteId ? Array.from(workerSiteId).map(b => b.toString(16).padStart(2, '0')).join('') : 'Not available';

  // Mutations
  const addTodoMutation = useAddTodoRemote();
  const toggleTodoMutation = useToggleTodoRemote();
  const deleteTodoMutation = useDeleteTodoRemote();
  const addTodoListMutation = useAddTodoListRemote();
  const deleteTodoListMutation = useDeleteTodoListRemote();

  // Set default selected list when todo lists load
  useEffect(() => {
    if (todoLists && todoLists.length > 0 && !appState.selectedList) {
      setAppState(prev => ({
        ...prev,
        selectedList: todoLists[0].name
      }));
    }
  }, [todoLists, appState.selectedList]);

  const handleAddTodo = async () => {
    if (!appState.newTodoText.trim() || !appState.selectedList) return;
    
    try {
      await addTodoMutation.mutateAsync({
        list: appState.selectedList,
        text: appState.newTodoText.trim()
      });
      setAppState(prev => ({ ...prev, newTodoText: '' }));
    } catch (err) {
      console.error('Error adding todo:', err);
      setError((err as Error).message);
    }
  };

  const handleDeleteTodo = async (id: string) => {
    try {
      await deleteTodoMutation.mutateAsync({ id });
    } catch (err) {
      console.error('Error deleting todo:', err);
      setError((err as Error).message);
    }
  };

  const handleToggleTodo = async (id: string) => {
    try {
      await toggleTodoMutation.mutateAsync({ id });
    } catch (err) {
      console.error('Error toggling todo:', err);
      setError((err as Error).message);
    }
  };

  const handleAddList = async () => {
    if (!appState.newListName.trim()) return;
    
    try {
      await addTodoListMutation.mutateAsync({ name: appState.newListName.trim() });
      setAppState(prev => ({
        ...prev,
        newListName: '',
        selectedList: appState.newListName.trim()
      }));
    } catch (err) {
      console.error('Error adding list:', err);
      setError((err as Error).message);
    }
  };

  const handleDeleteList = async (name: string) => {
    try {
      await deleteTodoListMutation.mutateAsync({ name });
      if (appState.selectedList === name) {
        setAppState(prev => ({
          ...prev,
          selectedList: todoLists && todoLists.length > 1 ? todoLists[0]?.name || '' : ''
        }));
      }
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

  if (dbStatus === 'initializing') {
    return (
      <div className="app">
        <div className="loading">Initializing TanStack Query + CRSqlite...</div>
      </div>
    );
  }

  if (dbStatus === 'error') {
    return (
      <div className="app">
        <h1>TanStack Query + CRSqlite Test</h1>
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
      <h1>TanStack Query + CRSqlite Test (Remote-First)</h1>
      
      <div className="sync-controls">
        <button className="btn btn-primary" onClick={handleManualSync}>
          Manual Sync
        </button>
        <div className="status" style={{ marginLeft: '20px' }}>
          <strong>Tab ID:</strong> {tabSync?.getTabId() || 'N/A'} |
          <strong> Worker Site ID:</strong> {workerSiteIdHex} |
          <strong> Broadcast Version:</strong> {tabSync?.getLastBroadcastVersion() || 0} |
          <strong> Sync Status:</strong> {tabSync?.isRunning() ? 'Running' : 'Stopped'} |
          <strong> Changes:</strong> {changes.length} |
          <strong> Todos:</strong> {allTodos.length}
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
              disabled={addTodoListMutation.isPending}
            />
            <button 
              className="btn btn-primary" 
              onClick={handleAddList}
              disabled={addTodoListMutation.isPending}
            >
              {addTodoListMutation.isPending ? 'Adding...' : 'Add List'}
            </button>
          </div>
          
          {listsLoading ? (
            <div>Loading lists...</div>
          ) : todoLists.length > 0 ? (
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
                        disabled={deleteTodoListMutation.isPending}
                      >
                        {deleteTodoListMutation.isPending ? 'Deleting...' : 'Delete'}
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
                disabled={addTodoMutation.isPending}
              />
              <button 
                className="btn btn-primary" 
                onClick={handleAddTodo}
                disabled={addTodoMutation.isPending}
              >
                {addTodoMutation.isPending ? 'Adding...' : 'Add Todo'}
              </button>
            </div>
            
            {selectedTodosLoading ? (
              <div>Loading todos...</div>
            ) : selectedTodos.length > 0 ? (
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
                  {selectedTodos.map((todo) => (
                    <tr key={todo.id}>
                      <td>
                        <input
                          type="checkbox"
                          checked={todo.complete === 1}
                          onChange={() => handleToggleTodo(todo.id)}
                          disabled={toggleTodoMutation.isPending}
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
                          disabled={deleteTodoMutation.isPending}
                        >
                          {deleteTodoMutation.isPending ? 'Deleting...' : 'Delete'}
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
          ) : changes.length > 0 ? (
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
          {changes.length > 5 && (
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