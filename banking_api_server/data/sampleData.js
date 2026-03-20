const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');

// Sample users with hashed passwords
const sampleUsers = [
  {
    id: '1',
    username: 'john.doe',
    email: 'john.doe@example.com',
    firstName: 'John',
    lastName: 'Doe',
    password: bcrypt.hashSync('password123', 10),
    role: 'customer',
    createdAt: new Date('2024-01-15'),
    isActive: true
  },
  {
    id: '2',
    username: 'jane.smith',
    email: 'jane.smith@example.com',
    firstName: 'Jane',
    lastName: 'Smith',
    password: bcrypt.hashSync('password123', 10),
    role: 'customer',
    createdAt: new Date('2024-01-20'),
    isActive: true
  },
  {
    id: '3',
    username: 'mike.johnson',
    email: 'mike.johnson@example.com',
    firstName: 'Mike',
    lastName: 'Johnson',
    password: bcrypt.hashSync('password123', 10),
    role: 'customer',
    createdAt: new Date('2024-02-01'),
    isActive: true
  },
  {
    id: '4',
    username: 'admin',
    email: 'admin@bank.com',
    firstName: 'Admin',
    lastName: 'User',
    password: bcrypt.hashSync('admin123', 10),
    role: 'admin',
    createdAt: new Date('2024-01-01'),
    isActive: true
  }
];

// Sample accounts
const sampleAccounts = [
  {
    id: '1',
    userId: '1',
    accountNumber: '1001-2345-6789',
    accountType: 'checking',
    balance: 2500.00,
    currency: 'USD',
    createdAt: new Date('2024-01-15'),
    isActive: true
  },
  {
    id: '2',
    userId: '1',
    accountNumber: '1001-2345-6790',
    accountType: 'savings',
    balance: 15000.00,
    currency: 'USD',
    createdAt: new Date('2024-01-15'),
    isActive: true
  },
  {
    id: '3',
    userId: '2',
    accountNumber: '1002-3456-7890',
    accountType: 'checking',
    balance: 3200.50,
    currency: 'USD',
    createdAt: new Date('2024-01-20'),
    isActive: true
  },
  {
    id: '4',
    userId: '2',
    accountNumber: '1002-3456-7891',
    accountType: 'savings',
    balance: 8500.75,
    currency: 'USD',
    createdAt: new Date('2024-01-20'),
    isActive: true
  },
  {
    id: '5',
    userId: '3',
    accountNumber: '1003-4567-8901',
    accountType: 'checking',
    balance: 1800.25,
    currency: 'USD',
    createdAt: new Date('2024-02-01'),
    isActive: true
  }
];

// Sample transactions
const sampleTransactions = [
  {
    id: '1',
    fromAccountId: '1',
    toAccountId: '3',
    amount: 500.00,
    type: 'transfer',
    description: 'Payment for services',
    status: 'completed',
    createdAt: new Date('2024-03-01T10:30:00Z'),
    userId: '1'
  },
  {
    id: '2',
    fromAccountId: '2',
    toAccountId: null,
    amount: 1000.00,
    type: 'withdrawal',
    description: 'ATM withdrawal',
    status: 'completed',
    createdAt: new Date('2024-03-02T14:15:00Z'),
    userId: '1'
  },
  {
    id: '3',
    fromAccountId: null,
    toAccountId: '3',
    amount: 750.00,
    type: 'deposit',
    description: 'Salary deposit',
    status: 'completed',
    createdAt: new Date('2024-03-03T09:00:00Z'),
    userId: '2'
  },
  {
    id: '4',
    fromAccountId: '3',
    toAccountId: '5',
    amount: 200.00,
    type: 'transfer',
    description: 'Rent payment',
    status: 'completed',
    createdAt: new Date('2024-03-04T16:45:00Z'),
    userId: '2'
  },
  {
    id: '5',
    fromAccountId: '5',
    toAccountId: null,
    amount: 150.00,
    type: 'withdrawal',
    description: 'Grocery shopping',
    status: 'completed',
    createdAt: new Date('2024-03-05T11:20:00Z'),
    userId: '3'
  },
  {
    id: '6',
    fromAccountId: null,
    toAccountId: '1',
    amount: 300.00,
    type: 'deposit',
    description: 'Refund',
    status: 'completed',
    createdAt: new Date('2024-03-06T13:30:00Z'),
    userId: '1'
  }
];

// Activity logs
const sampleActivityLogs = [
  {
    id: '1',
    userId: '1',
    username: 'john.doe',
    action: 'LOGIN',
    endpoint: '/api/auth/login',
    timestamp: new Date('2024-03-01T08:30:00Z'),
    ipAddress: '192.168.1.100',
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
  },
  {
    id: '2',
    userId: '1',
    username: 'john.doe',
    action: 'CHECK_BALANCE',
    endpoint: '/api/accounts/1/balance',
    timestamp: new Date('2024-03-01T08:35:00Z'),
    ipAddress: '192.168.1.100',
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
  },
  {
    id: '3',
    userId: '1',
    username: 'john.doe',
    action: 'TRANSFER_MONEY',
    endpoint: '/api/transactions',
    timestamp: new Date('2024-03-01T10:30:00Z'),
    ipAddress: '192.168.1.100',
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
  },
  {
    id: '4',
    userId: '2',
    username: 'jane.smith',
    action: 'LOGIN',
    endpoint: '/api/auth/login',
    timestamp: new Date('2024-03-02T09:15:00Z'),
    ipAddress: '192.168.1.101',
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
  },
  {
    id: '5',
    userId: '2',
    username: 'jane.smith',
    action: 'GET_TRANSACTIONS',
    endpoint: '/api/transactions',
    timestamp: new Date('2024-03-02T09:20:00Z'),
    ipAddress: '192.168.1.101',
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
  }
];

module.exports = {
  sampleUsers,
  sampleAccounts,
  sampleTransactions,
  sampleActivityLogs
};
