const express = require('express');
const router = express.Router();
const dataStore = require('../data/store');
const { authenticateToken, requireScopes } = require('../middleware/auth');
const runtimeSettings = require('../config/runtimeSettings');
const pingOneAuthorizeService = require('../services/pingOneAuthorizeService');

// Get all transactions (admin only)
router.get('/', authenticateToken, requireScopes(['banking:transactions:read', 'banking:read']), async (req, res) => {
  try {
    // Check if user is admin
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Access denied. Admin role required.' });
    }
    
    const transactions = dataStore.getAllTransactions();
    const transactionsWithNames = transactions.map(transaction => {
      const user = dataStore.getUserById(transaction.userId);
      return {
        ...transaction,
        performedBy: user ? `${user.firstName} ${user.lastName}` : transaction.userId
      };
    });
    res.json({ transactions: transactionsWithNames });
  } catch (error) {
    console.error('Error getting transactions:', error);
    res.status(500).json({ error: 'Failed to get transactions' });
  }
});



// Get user's own transactions (end users)
router.get('/my', authenticateToken, requireScopes(['banking:transactions:read', 'banking:read']), async (req, res) => {
  try {
    // Add cache headers for frequent polling
    res.set({
      'Cache-Control': 'private, max-age=10', // Cache for 10 seconds
      'ETag': `"transactions-${req.user.id}-${Date.now()}"`,
    });
    
    const userTransactions = dataStore.getTransactionsByUserId(req.user.id);
    const user = dataStore.getUserById(req.user.id);
    const fullName = user ? `${user.firstName} ${user.lastName}` : req.user.username;
    
    // Add username and account information to each transaction
    const transactionsWithUsername = userTransactions.map(transaction => {
      // Get account information
      let accountInfo = 'Unknown';
      if (transaction.fromAccountId) {
        const fromAccount = dataStore.getAccountById(transaction.fromAccountId);
        if (fromAccount) {
          accountInfo = `${fromAccount.accountType} - ${fromAccount.accountNumber}`;
        }
      } else if (transaction.toAccountId) {
        const toAccount = dataStore.getAccountById(transaction.toAccountId);
        if (toAccount) {
          accountInfo = `${toAccount.accountType} - ${toAccount.accountNumber}`;
        }
      }
      
      return {
        ...transaction,
        performedBy: fullName,
        accountInfo: accountInfo
      };
    });
    
    res.json({ 
      transactions: transactionsWithUsername,
      timestamp: new Date().toISOString(),
      count: transactionsWithUsername.length
    });
  } catch (error) {
    console.error('Error getting user transactions:', error);
    res.status(500).json({ error: 'Failed to get your transactions' });
  }
});

// Get transaction by ID (admin or transaction owner)
router.get('/:id', authenticateToken, requireScopes(['banking:transactions:read', 'banking:read']), async (req, res) => {
  try {
    const transaction = dataStore.getTransactionById(req.params.id);
    if (!transaction) {
      return res.status(404).json({ error: 'Transaction not found' });
    }
    
    // Check if user is admin or transaction owner
    if (req.user.role !== 'admin' && transaction.userId !== req.user.id) {
      return res.status(403).json({ error: 'Access denied. You can only view your own transactions.' });
    }
    
    res.json({ transaction });
  } catch (error) {
    console.error('Error getting transaction:', error);
    res.status(500).json({ error: 'Failed to get transaction' });
  }
});

// Create new transaction (admin or end user)
router.post('/', authenticateToken, requireScopes(['banking:transactions:write', 'banking:write']), async (req, res) => {
  try {
    const { fromAccountId, toAccountId, amount, type, description, userId } = req.body;
    const performingUser = dataStore.getUserById(req.user.id);
    const performedByName = performingUser ? `${performingUser.firstName} ${performingUser.lastName}` : req.user.username;
    
    // Validate required fields
    if (!amount || !type) {
      return res.status(400).json({ error: 'Missing required fields: amount and type' });
    }
    
    // For deposits, we need toAccountId
    if (type === 'deposit' && !toAccountId) {
      return res.status(400).json({ error: 'Missing required field: toAccountId for deposit' });
    }
    
    // For withdrawals, we need fromAccountId
    if (type === 'withdrawal' && !fromAccountId) {
      return res.status(400).json({ error: 'Missing required field: fromAccountId for withdrawal' });
    }
    
    // For transfers, we need both fromAccountId and toAccountId
    if (type === 'transfer' && (!fromAccountId || !toAccountId)) {
      return res.status(400).json({ error: 'Missing required fields: fromAccountId and toAccountId for transfer' });
    }
    
    // For end users, ensure they can only create transactions for their own accounts
    if (req.user.role !== 'admin') {
      // Validate accounts exist and user has access
      if (fromAccountId) {
        const fromAccount = dataStore.getAccountById(fromAccountId);
        if (!fromAccount) {
          return res.status(404).json({ error: 'From account not found' });
        }
        if (fromAccount.userId !== req.user.id) {
          return res.status(403).json({ error: 'Access denied. You can only transfer from your own accounts.' });
        }
      }
      
      if (toAccountId) {
        const toAccount = dataStore.getAccountById(toAccountId);
        if (!toAccount) {
          return res.status(404).json({ error: 'To account not found' });
        }
        if (toAccount.userId !== req.user.id) {
          return res.status(403).json({ error: 'Access denied. You can only deposit to your own accounts.' });
        }
      }
      
      // Use the authenticated user's ID
      req.body.userId = req.user.id;
    }
    
    // Check if from account has sufficient balance (only for withdrawals and transfers)
    if (fromAccountId && (type === 'withdrawal' || type === 'transfer')) {
      const fromAccount = dataStore.getAccountById(fromAccountId);
      if (!fromAccount) {
        return res.status(404).json({ error: 'From account not found' });
      }
      if (fromAccount.balance < amount) {
        return res.status(400).json({ error: 'Insufficient balance' });
      }
    }

    // ── Step-up MFA gate ─────────────────────────────────────────────────────
    // Transfers and withdrawals above the threshold require a fresh MFA token.
    // All values are read from runtimeSettings (configurable via admin UI at /settings).
    const STEP_UP_THRESHOLD = runtimeSettings.get('stepUpAmountThreshold');
    const STEP_UP_ACR = runtimeSettings.get('stepUpAcrValue');
    const STEP_UP_TYPES = runtimeSettings.get('stepUpTransactionTypes');
    const STEP_UP_ENABLED = runtimeSettings.get('stepUpEnabled');

    if (STEP_UP_ENABLED && req.user.role !== 'admin' && STEP_UP_TYPES.includes(type) && parseFloat(amount) >= STEP_UP_THRESHOLD) {
      const userAcr = req.user.acr;
      if (!userAcr || userAcr !== STEP_UP_ACR) {
        console.log(`[StepUp] Amount ${amount} exceeds threshold ${STEP_UP_THRESHOLD}. User ACR: ${userAcr}. Requiring step-up.`);
        return res.status(428).json({
          error: 'step_up_required',
          error_description: `Transfers and withdrawals of $${STEP_UP_THRESHOLD} or more require additional authentication (MFA). Update this threshold in Admin → Security Settings.`,
          step_up_acr: STEP_UP_ACR,
          step_up_url: '/api/auth/oauth/user/stepup',
          amount_threshold: STEP_UP_THRESHOLD,
        });
      }
    }
    // ── End step-up gate ──────────────────────────────────────────────────────

    // ── PingOne Authorize gate ────────────────────────────────────────────────
    // When enabled, evaluates the transaction against the configured Authorize
    // policy decision point. Runs in addition to (not instead of) the threshold
    // gate above — both controls remain active independently.
    const AUTHORIZE_ENABLED = runtimeSettings.get('authorizeEnabled');
    const AUTHORIZE_POLICY_ID = runtimeSettings.get('authorizePolicyId');

    if (AUTHORIZE_ENABLED && AUTHORIZE_POLICY_ID && req.user.role !== 'admin') {
      try {
        const { decision } = await pingOneAuthorizeService.evaluateTransaction({
          policyId: AUTHORIZE_POLICY_ID,
          userId: req.user.id,
          amount: parseFloat(amount),
          type,
          acr: req.user.acr,
        });
        console.log(`[Authorize] Policy ${AUTHORIZE_POLICY_ID} — user ${req.user.id} — decision: ${decision}`);
        if (decision === 'DENY') {
          return res.status(403).json({
            error: 'transaction_denied',
            error_description: 'This transaction was denied by the authorization policy.',
            authorize_policy_id: AUTHORIZE_POLICY_ID,
          });
        }
      } catch (err) {
        // Fail open with a warning so a misconfigured Authorize integration
        // does not block all transactions. Change to fail-closed here if your
        // security posture requires it.
        console.warn(`[Authorize] Policy evaluation error — failing open: ${err.message}`);
      }
    }
    // ── End Authorize gate ────────────────────────────────────────────────────

    // For transfers, create two separate transactions
    if (type === 'transfer') {
      // Resolve account labels for human-readable descriptions
      const fromAccountInfo = dataStore.getAccountById(fromAccountId);
      const toAccountInfo = dataStore.getAccountById(toAccountId);
      const fromLabel = fromAccountInfo ? `${fromAccountInfo.accountType} - ${fromAccountInfo.accountNumber}` : fromAccountId;
      const toLabel = toAccountInfo ? `${toAccountInfo.accountType} - ${toAccountInfo.accountNumber}` : toAccountId;

      // Create withdrawal transaction from source account
      const withdrawalTransaction = await dataStore.createTransaction({
        fromAccountId: fromAccountId,
        toAccountId: null,
        amount: amount,
        type: 'withdrawal',
        description: `Transfer to ${toLabel}: ${description}`,
        userId: req.user.id || userId,
        performedBy: performedByName,
        clientType: req.user.clientType || 'unknown',
        tokenType: req.user.tokenType || 'unknown'
      });
      
      // Create deposit transaction to destination account
      const depositTransaction = await dataStore.createTransaction({
        fromAccountId: null,
        toAccountId: toAccountId,
        amount: amount,
        type: 'deposit',
        description: `Transfer from ${fromLabel}: ${description}`,
        userId: req.user.id || userId,
        performedBy: performedByName,
        clientType: req.user.clientType || 'unknown',
        tokenType: req.user.tokenType || 'unknown'
      });
      
      // Update account balances
      await dataStore.updateAccountBalance(fromAccountId, -amount);
      await dataStore.updateAccountBalance(toAccountId, amount);
      
      // Log transaction creation with client type
      console.log(`💰 [Transaction] Transfer created by ${req.user.username} (${req.user.clientType || 'unknown'} via ${req.user.tokenType || 'unknown'}) - Amount: $${amount}`);
      
      res.status(201).json({ 
        message: 'Transfer completed successfully', 
        withdrawalTransaction,
        depositTransaction
      });
    } else {
      // For non-transfer transactions, create single transaction
      const transaction = await dataStore.createTransaction({
        fromAccountId,
        toAccountId,
        amount,
        type,
        description,
        userId: req.user.id || userId,
        performedBy: performedByName,
        clientType: req.user.clientType || 'unknown',
        tokenType: req.user.tokenType || 'unknown'
      });
      
      // Update account balances
      if (fromAccountId) {
        await dataStore.updateAccountBalance(fromAccountId, -amount);
      }
      if (toAccountId) {
        await dataStore.updateAccountBalance(toAccountId, amount);
      }
      
      // Log transaction creation with client type
      console.log(`💰 [Transaction] ${type} created by ${req.user.username} (${req.user.clientType || 'unknown'} via ${req.user.tokenType || 'unknown'}) - Amount: $${amount}`);
      
      res.status(201).json({ 
        message: 'Transaction created successfully', 
        transaction 
      });
    }
  } catch (error) {
    console.error('Error creating transaction:', error);
    res.status(500).json({ error: 'Failed to create transaction' });
  }
});

// Update transaction (admin only)
router.put('/:id', authenticateToken, requireScopes(['banking:transactions:write', 'banking:write']), async (req, res) => {
  try {
    // Check if user is admin
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Access denied. Admin role required.' });
    }
    
    const transaction = await dataStore.updateTransaction(req.params.id, req.body);
    if (!transaction) {
      return res.status(404).json({ error: 'Transaction not found' });
    }
    res.json({ message: 'Transaction updated successfully', transaction });
  } catch (error) {
    console.error('Error updating transaction:', error);
    res.status(500).json({ error: 'Failed to update transaction' });
  }
});

// Delete transaction (admin only)
router.delete('/:id', authenticateToken, requireScopes(['banking:transactions:write', 'banking:write']), async (req, res) => {
  try {
    // Check if user is admin
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Access denied. Admin role required.' });
    }
    
    const deleted = await dataStore.deleteTransaction(req.params.id);
    if (!deleted) {
      return res.status(404).json({ error: 'Transaction not found' });
    }
    res.json({ message: 'Transaction deleted successfully' });
  } catch (error) {
    console.error('Error deleting transaction:', error);
    res.status(500).json({ error: 'Failed to delete transaction' });
  }
});

module.exports = router;