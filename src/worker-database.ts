// Worker-based database interface that communicates with shared worker
import WorkerManager, { SyncData } from './worker-manager';
import { Change } from './database';

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

class WorkerDatabase {
  private workerManager: WorkerManager;
  private isInitialized = false;
  private currentData: {
    todoLists: TodoList[];
    todos: Todo[];
    changes: Change[];
  } = {
    todoLists: [],
    todos: [],
    changes: []
  };
  
  // Event handlers
  private onDataUpdated: (() => void) | null = null;
  private lastDbVersion = 0;
  private changeCheckInterval: number | null = null;

  constructor() {
    this.workerManager = new WorkerManager();
  }

  async initialize(): Promise<{ success: boolean; error?: string }> {
    try {
      console.log('[WorkerDatabase] Initializing...');
      
      // Set up event handlers
      this.workerManager.onSyncData(this.handleSyncData.bind(this));
      this.workerManager.onChanges(this.handleIncomingChanges.bind(this));
      this.workerManager.onReady(this.handleWorkerReady.bind(this));
      
      // Initialize worker manager
      const success = await this.workerManager.initialize();
      
      if (success) {
        this.isInitialized = true;
        this.startChangeDetection();
        console.log('[WorkerDatabase] Successfully initialized');
        return { success: true };
      } else {
        return { success: false, error: 'Failed to initialize worker manager' };
      }
      
    } catch (error) {
      console.error('[WorkerDatabase] Initialization failed:', error);
      return { success: false, error: (error as Error).message };
    }
  }

  private handleSyncData(data: SyncData): void {
    console.log('[WorkerDatabase] Received sync data:', data);
    
    this.currentData = {
      todoLists: data.todoLists,
      todos: data.todos,
      changes: data.changes
    };
    
    // Update last db version
    if (data.changes.length > 0) {
      this.lastDbVersion = Math.max(...data.changes.map(c => c.db_version));
      this.workerManager.updateLastDbVersion(this.lastDbVersion);
    }
    
    // Notify listeners
    if (this.onDataUpdated) {
      this.onDataUpdated();
    }
  }

  private handleIncomingChanges(changes: Change[]): void {
    console.log('[WorkerDatabase] Received incoming changes:', changes);
    
    // Update local changes array
    this.currentData.changes = [...this.currentData.changes, ...changes];
    
    // Update last db version
    if (changes.length > 0) {
      this.lastDbVersion = Math.max(this.lastDbVersion, ...changes.map(c => c.db_version));
      this.workerManager.updateLastDbVersion(this.lastDbVersion);
    }
    
    // Refresh data from worker
    this.workerManager.requestSync();
  }

  private handleWorkerReady(): void {
    console.log('[WorkerDatabase] Worker is ready');
    // Request fresh sync when worker becomes ready
    this.workerManager.requestSync();
  }

  private startChangeDetection(): void {
    // Check for local changes every 1 second
    this.changeCheckInterval = window.setInterval(async () => {
      await this.checkForLocalChanges();
    }, 1000);
  }

  private async checkForLocalChanges(): Promise<void> {
    // This would be implemented if we had local database changes to detect
    // For now, we rely on the shared worker for all persistence
    // In a real implementation, you might check a local in-memory database
    // for changes since the last sync
  }

  // Public API methods
  getTodoLists(): TodoList[] {
    return this.currentData.todoLists;
  }

  getTodos(listName?: string): Todo[] {
    if (listName) {
      return this.currentData.todos.filter(todo => todo.list === listName);
    }
    return this.currentData.todos;
  }

  getChanges(): Change[] {
    return this.currentData.changes;
  }

  async addTodo(listName: string, text: string): Promise<string> {
    // For now, we'll simulate adding a todo by broadcasting the change
    // In a real implementation, you'd add to local database first, then sync
    const id = `tab-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    // Create a mock change for the new todo
    const change: Change = {
      table: 'todo',
      pk: new TextEncoder().encode(id),
      cid: 'text',
      val: text,
      col_version: 1,
      db_version: this.lastDbVersion + 1,
      site_id: new TextEncoder().encode('local-site'),
      cl: 0,
      seq: 0
    };
    
    // Broadcast the change
    this.workerManager.broadcastChanges([change]);
    
    return id;
  }

  async deleteTodo(id: string): Promise<void> {
    // Similar to addTodo, create a mock delete change
    const change: Change = {
      table: 'todo',
      pk: new TextEncoder().encode(id),
      cid: '__crsql_delete',
      val: null,
      col_version: 1,
      db_version: this.lastDbVersion + 1,
      site_id: new TextEncoder().encode('local-site'),
      cl: 0,
      seq: 0
    };
    
    this.workerManager.broadcastChanges([change]);
  }

  async toggleTodo(id: string): Promise<void> {
    const todo = this.currentData.todos.find(t => t.id === id);
    if (!todo) return;
    
    const newComplete = todo.complete === 1 ? 0 : 1;
    
    const change: Change = {
      table: 'todo',
      pk: new TextEncoder().encode(id),
      cid: 'complete',
      val: newComplete,
      col_version: 1,
      db_version: this.lastDbVersion + 1,
      site_id: new TextEncoder().encode('local-site'),
      cl: 0,
      seq: 0
    };
    
    this.workerManager.broadcastChanges([change]);
  }

  async addTodoList(name: string): Promise<void> {
    const change: Change = {
      table: 'todo_list',
      pk: new TextEncoder().encode(name),
      cid: 'creation_time',
      val: Date.now(),
      col_version: 1,
      db_version: this.lastDbVersion + 1,
      site_id: new TextEncoder().encode('local-site'),
      cl: 0,
      seq: 0
    };
    
    this.workerManager.broadcastChanges([change]);
  }

  async deleteTodoList(name: string): Promise<void> {
    // Delete the list
    const listChange: Change = {
      table: 'todo_list',
      pk: new TextEncoder().encode(name),
      cid: '__crsql_delete',
      val: null,
      col_version: 1,
      db_version: this.lastDbVersion + 1,
      site_id: new TextEncoder().encode('local-site'),
      cl: 0,
      seq: 0
    };
    
    // Delete all todos in the list
    const todosToDelete = this.currentData.todos.filter(todo => todo.list === name);
    const todoChanges: Change[] = todosToDelete.map(todo => ({
      table: 'todo',
      pk: new TextEncoder().encode(todo.id),
      cid: '__crsql_delete',
      val: null,
      col_version: 1,
      db_version: this.lastDbVersion + 1,
      site_id: new TextEncoder().encode('local-site'),
      cl: 0,
      seq: 0
    }));
    
    this.workerManager.broadcastChanges([listChange, ...todoChanges]);
  }

  // Event handler setter
  onDataChange(handler: () => void): void {
    this.onDataUpdated = handler;
  }

  async requestSync(): Promise<void> {
    await this.workerManager.requestSync();
  }

  destroy(): void {
    if (this.changeCheckInterval) {
      clearInterval(this.changeCheckInterval);
      this.changeCheckInterval = null;
    }
    
    this.workerManager.destroy();
    this.isInitialized = false;
  }
}

export default WorkerDatabase;
export type { TodoList, Todo };