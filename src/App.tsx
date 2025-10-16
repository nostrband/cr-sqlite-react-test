import React, { useState, useEffect } from 'react';
import {
  initDatabases,
  getTodoLists,
  getTodos,
  addTodo,
  deleteTodo,
  toggleTodo,
  addTodoList,
  deleteTodoList,
  getChanges,
  syncDatabases,
  Change
} from './database';

interface TodoList {
  name: string;
  creation_time: number;
}

interface Todo {
  id: string;
  list: string;
  text: string;
  complete: number;
}


type DbStatus = 'initializing' | 'ready' | 'error';
type DbInstance = 'db1' | 'db2';

interface DatabaseState {
  todoLists: TodoList[];
  todos: Todo[];
  selectedList: string;
  newTodoText: string;
  newListName: string;
  changes: Change[];
}

function DatabasePanel({
  dbInstance,
  title,
  state,
  setState,
  onDataChange
}: {
  dbInstance: DbInstance;
  title: string;
  state: DatabaseState;
  setState: React.Dispatch<React.SetStateAction<DatabaseState>>;
  onDataChange: () => Promise<void>;
}) {
  const handleAddTodo = async () => {
    if (!state.newTodoText.trim()) return;
    
    try {
      await addTodo(dbInstance, state.selectedList, state.newTodoText.trim());
      setState(prev => ({ ...prev, newTodoText: '' }));
      await onDataChange();
    } catch (err) {
      console.error(`Error adding todo to ${dbInstance}:`, err);
    }
  };

  const handleDeleteTodo = async (id: string) => {
    try {
      await deleteTodo(dbInstance, id);
      await onDataChange();
    } catch (err) {
      console.error(`Error deleting todo from ${dbInstance}:`, err);
    }
  };

  const handleToggleTodo = async (id: string) => {
    try {
      await toggleTodo(dbInstance, id);
      await onDataChange();
    } catch (err) {
      console.error(`Error toggling todo in ${dbInstance}:`, err);
    }
  };

  const handleAddList = async () => {
    if (!state.newListName.trim()) return;
    
    try {
      await addTodoList(dbInstance, state.newListName.trim());
      setState(prev => ({
        ...prev,
        newListName: '',
        selectedList: state.newListName.trim()
      }));
      await onDataChange();
    } catch (err) {
      console.error(`Error adding list to ${dbInstance}:`, err);
    }
  };

  const handleDeleteList = async (name: string) => {
    try {
      await deleteTodoList(dbInstance, name);
      if (state.selectedList === name) {
        setState(prev => ({
          ...prev,
          selectedList: state.todoLists.length > 1 ? state.todoLists[0]?.name || '' : ''
        }));
      }
      await onDataChange();
    } catch (err) {
      console.error(`Error deleting list from ${dbInstance}:`, err);
    }
  };

  const filteredTodos = state.todos.filter(todo => todo.list === state.selectedList);

  return (
    <div className="database-panel">
      <h2>{title}</h2>
      
      <div className="status">
        Database: <strong>{dbInstance.toUpperCase()}</strong> | 
        Changes: <strong>{state.changes.length}</strong> | 
        Todos: <strong>{state.todos.length}</strong>
      </div>

      <div className="section">
        <h3>Todo Lists</h3>
        <div className="form">
          <input
            type="text"
            placeholder="New list name..."
            value={state.newListName}
            onChange={(e) => setState(prev => ({ ...prev, newListName: e.target.value }))}
            onKeyPress={(e) => e.key === 'Enter' && handleAddList()}
          />
          <button className="btn btn-primary" onClick={handleAddList}>
            Add List
          </button>
        </div>
        
        {state.todoLists.length > 0 ? (
          <table className="table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Created</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {state.todoLists.map((list) => (
                <tr key={list.name} style={{ 
                  backgroundColor: state.selectedList === list.name ? '#e8f5e8' : 'transparent' 
                }}>
                  <td>
                    <button 
                      onClick={() => setState(prev => ({ ...prev, selectedList: list.name }))}
                      style={{ 
                        background: 'none', 
                        border: 'none', 
                        cursor: 'pointer',
                        fontWeight: state.selectedList === list.name ? 'bold' : 'normal'
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

      {state.selectedList && (
        <div className="section">
          <h3>Todos in "{state.selectedList}"</h3>
          <div className="form">
            <input
              type="text"
              placeholder="New todo..."
              value={state.newTodoText}
              onChange={(e) => setState(prev => ({ ...prev, newTodoText: e.target.value }))}
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
        {state.changes.length > 0 ? (
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
              {state.changes.slice(-5).map((change, index) => (
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
        {state.changes.length > 5 && (
          <p style={{ textAlign: 'center', color: '#666', fontSize: '12px' }}>
            Showing last 5 changes (total: {state.changes.length})
          </p>
        )}
      </div>
    </div>
  );
}

function App() {
  const [dbStatus, setDbStatus] = useState<DbStatus>('initializing');
  const [error, setError] = useState<string | null>(null);
  const [autoSync, setAutoSync] = useState<boolean>(false);
  
  const [db1State, setDb1State] = useState<DatabaseState>({
    todoLists: [],
    todos: [],
    selectedList: 'DB1 Todo List',
    newTodoText: '',
    newListName: '',
    changes: []
  });

  const [db2State, setDb2State] = useState<DatabaseState>({
    todoLists: [],
    todos: [],
    selectedList: 'DB2 Todo List',
    newTodoText: '',
    newListName: '',
    changes: []
  });

  useEffect(() => {
    initializeApp();
  }, []);

  useEffect(() => {
    if (dbStatus === 'ready' && autoSync) {
      const interval = setInterval(() => {
        performSync();
      }, 2000); // Sync every 2 seconds

      return () => clearInterval(interval);
    }
  }, [dbStatus, autoSync]);

  const initializeApp = async () => {
    try {
      setDbStatus('initializing');
      const result = await initDatabases();
      
      if (result.success) {
        setDbStatus('ready');
        loadAllData();
      } else {
        setDbStatus('error');
        setError(result.error || 'Unknown error');
      }
    } catch (err) {
      setDbStatus('error');
      setError((err as Error).message);
    }
  };

  const loadAllData = async () => {
    try {
      // Load DB1 data
      const db1Lists = await getTodoLists('db1');
      const db1Todos = await getTodos('db1');
      const db1Changes = await getChanges('db1');
      
      setDb1State(prev => ({
        ...prev,
        todoLists: db1Lists,
        todos: db1Todos,
        changes: db1Changes
      }));

      // Load DB2 data
      const db2Lists = await getTodoLists('db2');
      const db2Todos = await getTodos('db2');
      const db2Changes = await getChanges('db2');
      
      setDb2State(prev => ({
        ...prev,
        todoLists: db2Lists,
        todos: db2Todos,
        changes: db2Changes
      }));
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const performSync = async () => {
    try {
      await syncDatabases();
      loadAllData();
    } catch (err) {
      console.error('Sync error:', err);
    }
  };

  const handleManualSync = async () => {
    try {
      await performSync();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  if (dbStatus === 'initializing') {
    return (
      <div className="app">
        <div className="loading">Initializing dual cr-sqlite databases...</div>
      </div>
    );
  }

  if (dbStatus === 'error') {
    return (
      <div className="app">
        <h1>CR-SQLite Dual Database Test</h1>
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
      <h1>CR-SQLite Dual Database Test</h1>
      
      <div className="sync-controls">
        <button className="btn btn-primary" onClick={handleManualSync}>
          Manual Sync
        </button>
        <label style={{ marginLeft: '20px' }}>
          <input
            type="checkbox"
            checked={autoSync}
            onChange={(e) => setAutoSync(e.target.checked)}
          />
          Auto Sync (every 2s)
        </label>
      </div>

      {error && (
        <div className="error">
          <strong>Error:</strong> {error}
          <button onClick={() => setError(null)} style={{ float: 'right' }}>×</button>
        </div>
      )}

      <div className="dual-panel">
        <DatabasePanel
          dbInstance="db1"
          title="Database 1"
          state={db1State}
          setState={setDb1State}
          onDataChange={loadAllData}
        />
        
        <DatabasePanel
          dbInstance="db2"
          title="Database 2"
          state={db2State}
          setState={setDb2State}
          onDataChange={loadAllData}
        />
      </div>
    </div>
  );
}

export default App;