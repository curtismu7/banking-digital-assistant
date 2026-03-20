const { v4: uuidv4 } = require('uuid');
const fs = require('fs').promises;
const path = require('path');
const { sampleUsers, sampleAccounts, sampleTransactions, sampleActivityLogs } = require('./sampleData');

class DataStore {
  constructor() {
    this.users = new Map();
    this.accounts = new Map();
    this.transactions = new Map();
    this.activityLogs = new Map();
    
    this.dataDir = path.join(__dirname, '..', 'data', 'persistent');
    this.files = {
      users: path.join(this.dataDir, 'users.json'),
      accounts: path.join(this.dataDir, 'accounts.json'),
      transactions: path.join(this.dataDir, 'transactions.json'),
      activityLogs: path.join(this.dataDir, 'activityLogs.json')
    };
    
    // Initialize with sample data and load persistent data
    this.initializeData();
  }

  async initializeData() {
    try {
      // Ensure data directory exists
      await fs.mkdir(this.dataDir, { recursive: true });
      
      // Load persistent data or initialize with sample data
      await this.loadOrInitializeData();
    } catch (error) {
      console.error('Error initializing data store:', error);
      // Fallback to sample data only
      this.initializeSampleData();
    }
  }

  async loadOrInitializeData() {
    try {
      // Try to load existing data
      const [usersData, accountsData, transactionsData, activityLogsData] = await Promise.allSettled([
        this.loadDataFromFile(this.files.users),
        this.loadDataFromFile(this.files.accounts),
        this.loadDataFromFile(this.files.transactions),
        this.loadDataFromFile(this.files.activityLogs)
      ]);

      // Load users
      if (usersData.status === 'fulfilled' && usersData.value.length > 0) {
        console.log('Loading users from file:', usersData.value.length, 'users');
        usersData.value.forEach(user => {
          this.users.set(user.id, { ...user, createdAt: new Date(user.createdAt) });
        });
        console.log('Loaded users:', Array.from(this.users.keys()));
      } else {
        // Initialize with sample data
        console.log('No users file found, initializing with sample data');
        sampleUsers.forEach(user => {
          this.users.set(user.id, { ...user });
        });
        await this.saveDataToFile(this.files.users, Array.from(this.users.values()));
      }

      // Load accounts
      if (accountsData.status === 'fulfilled' && accountsData.value.length > 0) {
        accountsData.value.forEach(account => {
          this.accounts.set(account.id, { ...account, createdAt: new Date(account.createdAt) });
        });
      } else {
        sampleAccounts.forEach(account => {
          this.accounts.set(account.id, { ...account });
        });
        await this.saveDataToFile(this.files.accounts, Array.from(this.accounts.values()));
      }

      // Load transactions
      if (transactionsData.status === 'fulfilled' && transactionsData.value.length > 0) {
        transactionsData.value.forEach(transaction => {
          this.transactions.set(transaction.id, { ...transaction, createdAt: new Date(transaction.createdAt) });
        });
      } else {
        sampleTransactions.forEach(transaction => {
          this.transactions.set(transaction.id, { ...transaction });
        });
        await this.saveDataToFile(this.files.transactions, Array.from(this.transactions.values()));
      }

      // Load activity logs
      if (activityLogsData.status === 'fulfilled' && activityLogsData.value.length > 0) {
        activityLogsData.value.forEach(log => {
          this.activityLogs.set(log.id, { ...log, timestamp: new Date(log.timestamp) });
        });
      } else {
        sampleActivityLogs.forEach(log => {
          this.activityLogs.set(log.id, { ...log });
        });
        await this.saveDataToFile(this.files.activityLogs, Array.from(this.activityLogs.values()));
      }

    } catch (error) {
      console.error('Error loading data:', error);
      // Fallback to sample data
      this.initializeSampleData();
    }
  }

  async loadDataFromFile(filePath) {
    try {
      const data = await fs.readFile(filePath, 'utf8');
      return JSON.parse(data);
    } catch (error) {
      if (error.code === 'ENOENT') {
        // File doesn't exist, return empty array
        return [];
      }
      throw error;
    }
  }

  async saveDataToFile(filePath, data) {
    try {
      await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf8');
    } catch (error) {
      console.error(`Error saving data to ${filePath}:`, error);
    }
  }

  initializeSampleData() {
    // Load users
    sampleUsers.forEach(user => {
      this.users.set(user.id, { ...user });
    });

    // Load accounts
    sampleAccounts.forEach(account => {
      this.accounts.set(account.id, { ...account });
    });

    // Load transactions
    sampleTransactions.forEach(transaction => {
      this.transactions.set(transaction.id, { ...transaction });
    });

    // Load activity logs
    sampleActivityLogs.forEach(log => {
      this.activityLogs.set(log.id, { ...log });
    });
  }

  // User methods
  getAllUsers() {
    return Array.from(this.users.values());
  }

  getUserById(id) {
    return this.users.get(id);
  }

  getUserByUsername(username) {
    return Array.from(this.users.values()).find(user => user.username === username);
  }

  async createUser(userData) {
    const id = uuidv4();
    const user = {
      id,
      ...userData,
      createdAt: new Date(),
      isActive: true
    };
    this.users.set(id, user);
    
    // Persist to file
    await this.saveDataToFile(this.files.users, Array.from(this.users.values()));
    
    return user;
  }

  async updateUser(id, updates) {
    const user = this.users.get(id);
    if (!user) return null;
    
    const updatedUser = { ...user, ...updates };
    this.users.set(id, updatedUser);
    
    // Persist to file
    await this.saveDataToFile(this.files.users, Array.from(this.users.values()));
    
    return updatedUser;
  }

  async deleteUser(id) {
    const deleted = this.users.delete(id);
    if (deleted) {
      await this.saveDataToFile(this.files.users, Array.from(this.users.values()));
    }
    return deleted;
  }

  // Account methods
  getAllAccounts() {
    return Array.from(this.accounts.values());
  }

  getAccountById(id) {
    return this.accounts.get(id);
  }

  getAccountsByUserId(userId) {
    return Array.from(this.accounts.values()).filter(account => account.userId === userId);
  }

  async createAccount(accountData) {
    // Use caller-supplied id if present so Map key always matches account.id
    const id = accountData.id || uuidv4();
    const account = {
      ...accountData,
      id,
      createdAt: accountData.createdAt || new Date(),
      isActive: accountData.isActive !== undefined ? accountData.isActive : true
    };
    this.accounts.set(id, account);
    
    // Persist to file
    await this.saveDataToFile(this.files.accounts, Array.from(this.accounts.values()));
    
    return account;
  }

  async updateAccount(id, updates) {
    const account = this.accounts.get(id);
    if (!account) return null;
    
    const updatedAccount = { ...account, ...updates };
    this.accounts.set(id, updatedAccount);
    
    // Persist to file
    await this.saveDataToFile(this.files.accounts, Array.from(this.accounts.values()));
    
    return updatedAccount;
  }

  async deleteAccount(id) {
    const deleted = this.accounts.delete(id);
    if (deleted) {
      await this.saveDataToFile(this.files.accounts, Array.from(this.accounts.values()));
    }
    return deleted;
  }

  // Transaction methods
  getAllTransactions() {
    return Array.from(this.transactions.values());
  }

  getTransactionById(id) {
    return this.transactions.get(id);
  }

  getTransactionsByUserId(userId) {
    return Array.from(this.transactions.values()).filter(transaction => transaction.userId === userId);
  }

  getTransactionsByAccountId(accountId) {
    return Array.from(this.transactions.values()).filter(transaction => 
      transaction.fromAccountId === accountId || transaction.toAccountId === accountId
    );
  }

  async createTransaction(transactionData) {
    const id = uuidv4();
    const transaction = {
      id,
      ...transactionData,
      createdAt: new Date(),
      status: 'completed'
    };
    this.transactions.set(id, transaction);
    
    // Persist to file
    await this.saveDataToFile(this.files.transactions, Array.from(this.transactions.values()));
    
    return transaction;
  }

  async updateTransaction(id, updates) {
    const transaction = this.transactions.get(id);
    if (!transaction) return null;
    
    const updatedTransaction = { ...transaction, ...updates };
    this.transactions.set(id, updatedTransaction);
    
    // Persist to file
    await this.saveDataToFile(this.files.transactions, Array.from(this.transactions.values()));
    
    return updatedTransaction;
  }

  async deleteTransaction(id) {
    const deleted = this.transactions.delete(id);
    if (deleted) {
      await this.saveDataToFile(this.files.transactions, Array.from(this.transactions.values()));
    }
    return deleted;
  }

  // Activity log methods
  getAllActivityLogs() {
    return Array.from(this.activityLogs.values());
  }

  getActivityLogById(id) {
    return this.activityLogs.get(id);
  }

  getActivityLogsByUserId(userId) {
    return Array.from(this.activityLogs.values()).filter(log => log.userId === userId);
  }

  getActivityLogsByUsername(username) {
    return Array.from(this.activityLogs.values()).filter(log => log.username === username);
  }

  async createActivityLog(logData) {
    const id = uuidv4();
    const log = {
      id,
      ...logData,
      timestamp: new Date()
    };
    this.activityLogs.set(id, log);
    
    // Persist to file (but don't wait for it to avoid blocking the request)
    this.saveDataToFile(this.files.activityLogs, Array.from(this.activityLogs.values())).catch(error => {
      console.error('Error saving activity log:', error);
    });
    
    return log;
  }

  // Utility methods
  getAccountBalance(accountId) {
    const account = this.accounts.get(accountId);
    return account ? account.balance : 0;
  }

  async updateAccountBalance(accountId, amount) {
    const account = this.accounts.get(accountId);
    if (!account) return false;
    
    account.balance += amount;
    this.accounts.set(accountId, account);
    
    // Persist to file
    await this.saveDataToFile(this.files.accounts, Array.from(this.accounts.values()));
    
    return true;
  }

  // Search methods
  searchUsers(query) {
    const users = Array.from(this.users.values());
    return users.filter(user => 
      user.firstName.toLowerCase().includes(query.toLowerCase()) ||
      user.lastName.toLowerCase().includes(query.toLowerCase()) ||
      user.username.toLowerCase().includes(query.toLowerCase()) ||
      user.email.toLowerCase().includes(query.toLowerCase())
    );
  }

  searchTransactions(query) {
    const transactions = Array.from(this.transactions.values());
    return transactions.filter(transaction => 
      transaction.description.toLowerCase().includes(query.toLowerCase()) ||
      transaction.type.toLowerCase().includes(query.toLowerCase())
    );
  }
}

// Create singleton instance
const dataStore = new DataStore();

module.exports = dataStore;
