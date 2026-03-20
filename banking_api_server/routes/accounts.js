const express = require('express');
const router = express.Router();
const dataStore = require('../data/store');
const { authenticateToken, requireScopes } = require('../middleware/auth');

// Get all accounts (admin only)
router.get('/', authenticateToken, requireScopes(['banking:accounts:read', 'banking:read']), async (req, res) => {
  try {
    // Check if user is admin
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Access denied. Admin role required.' });
    }
    
    const accounts = dataStore.getAllAccounts();
    res.json({ accounts });
  } catch (error) {
    console.error('Error getting accounts:', error);
    res.status(500).json({ error: 'Failed to get accounts' });
  }
});

// Get user's own accounts (end users)
router.get('/my', authenticateToken, requireScopes(['banking:accounts:read', 'banking:read']), async (req, res) => {
  try {
    const userAccounts = dataStore.getAccountsByUserId(req.user.id);
    res.json({ accounts: userAccounts });
  } catch (error) {
    console.error('Error getting user accounts:', error);
    res.status(500).json({ error: 'Failed to get your accounts' });
  }
});

// Get account by ID (admin only)
router.get('/:id', authenticateToken, requireScopes(['banking:accounts:read', 'banking:read']), async (req, res) => {
  try {
    // Check if user is admin
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Access denied. Admin role required.' });
    }
    
    const account = dataStore.getAccountById(req.params.id);
    if (!account) {
      return res.status(404).json({ error: 'Account not found' });
    }
    res.json({ account });
  } catch (error) {
    console.error('Error getting account:', error);
    res.status(500).json({ error: 'Failed to get account' });
  }
});

// Get account balance (admin or account owner)
router.get('/:id/balance', authenticateToken, requireScopes(['banking:accounts:read', 'banking:read']), async (req, res) => {
  try {
    const account = dataStore.getAccountById(req.params.id);
    if (!account) {
      return res.status(404).json({ error: 'Account not found' });
    }
    
    // Check if user is admin or account owner
    if (req.user.role !== 'admin' && account.userId !== req.user.id) {
      return res.status(403).json({ error: 'Access denied. You can only check your own account balance.' });
    }
    
    const balance = dataStore.getAccountBalance(req.params.id);
    res.json({ balance });
  } catch (error) {
    console.error('Error getting account balance:', error);
    res.status(500).json({ error: 'Failed to get account balance' });
  }
});

// Create new account (admin only)
router.post('/', authenticateToken, requireScopes(['banking:write']), async (req, res) => {
  try {
    // Check if user is admin
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Access denied. Admin role required.' });
    }
    
    const account = await dataStore.createAccount(req.body);
    res.status(201).json({ message: 'Account created successfully', account });
  } catch (error) {
    console.error('Error creating account:', error);
    res.status(500).json({ error: 'Failed to create account' });
  }
});

// Update account (admin only)
router.put('/:id', authenticateToken, requireScopes(['banking:write']), async (req, res) => {
  try {
    // Check if user is admin
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Access denied. Admin role required.' });
    }
    
    const account = await dataStore.updateAccount(req.params.id, req.body);
    if (!account) {
      return res.status(404).json({ error: 'Account not found' });
    }
    res.json({ message: 'Account updated successfully', account });
  } catch (error) {
    console.error('Error updating account:', error);
    res.status(500).json({ error: 'Failed to update account' });
  }
});

// Delete account (admin only)
router.delete('/:id', authenticateToken, requireScopes(['banking:write']), async (req, res) => {
  try {
    // Check if user is admin
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Access denied. Admin role required.' });
    }
    
    const deleted = await dataStore.deleteAccount(req.params.id);
    if (!deleted) {
      return res.status(404).json({ error: 'Account not found' });
    }
    res.json({ message: 'Account deleted successfully' });
  } catch (error) {
    console.error('Error deleting account:', error);
    res.status(500).json({ error: 'Failed to delete account' });
  }
});

module.exports = router;
