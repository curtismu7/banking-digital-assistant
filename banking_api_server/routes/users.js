const express = require('express');
const router = express.Router();
const dataStore = require('../data/store');
const { requireAdmin, requireOwnershipOrAdmin, requireAIAgent, authenticateToken, requireScopes, hashPassword } = require('../middleware/auth');

// Query user by email (AI agents only)
router.get('/query/by-email/:email', authenticateToken, requireAIAgent, (req, res) => {
  try {
    const { email } = req.params;
    
    if (!email) {
      return res.status(400).json({ error: 'Email parameter is required' });
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ error: 'Invalid email format' });
    }

    // Find user by email
    const user = dataStore.getAllUsers().find(u => u.email.toLowerCase() === email.toLowerCase());
    
    if (!user) {
      return res.status(404).json({ 
        error: 'User not found',
        email: email,
        exists: false
      });
    }

    // Remove sensitive information from response
    const { password, ...userWithoutPassword } = user;

    // Log the AI agent query for audit purposes
    console.log(`🤖 [AI Agent Query] User lookup by email: ${email} - Found: ${user.username} (${user.role}) - Agent: ${req.user.username}`);

    res.json({ 
      user: userWithoutPassword,
      exists: true,
      queriedBy: req.user.username,
      queriedAt: new Date().toISOString()
    });

  } catch (error) {
    console.error('AI agent user query error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get all users (admin only)
router.get('/', authenticateToken, requireScopes(['banking:read']), requireAdmin, (req, res) => {
  try {
    const users = dataStore.getAllUsers();
    
    // Remove passwords from response
    const usersWithoutPasswords = users.map(user => {
      const { password, ...userWithoutPassword } = user;
      return userWithoutPassword;
    });

    res.json({ users: usersWithoutPasswords });

  } catch (error) {
    console.error('Get users error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get user by ID
router.get('/:userId', authenticateToken, requireScopes(['banking:read']), requireOwnershipOrAdmin, (req, res) => {
  try {
    const { userId } = req.params;
    const user = dataStore.getUserById(userId);

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Remove password from response
    const { password, ...userWithoutPassword } = user;

    res.json({ user: userWithoutPassword });

  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Create new user (admin only)
router.post('/', authenticateToken, requireScopes(['banking:write']), requireAdmin, async (req, res) => {
  try {
    const { username, email, password, firstName, lastName, role } = req.body;

    if (!username || !email || !password || !firstName || !lastName) {
      return res.status(400).json({ error: 'All fields are required' });
    }

    // Check if username already exists
    const existingUser = dataStore.getUserByUsername(username);
    if (existingUser) {
      return res.status(400).json({ error: 'Username already exists' });
    }

    // Check if email already exists
    const existingEmail = dataStore.getAllUsers().find(user => user.email === email);
    if (existingEmail) {
      return res.status(400).json({ error: 'Email already exists' });
    }

    // Validate password strength
    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters long' });
    }

    const hashedPassword = hashPassword(password);
    
    const userData = {
      username,
      email,
      password: hashedPassword,
      firstName,
      lastName,
      role: role || 'customer'
    };

    const newUser = await dataStore.createUser(userData);
    
    // Remove password from response
    const { password: _, ...userWithoutPassword } = newUser;

    res.status(201).json({
      message: 'User created successfully',
      user: userWithoutPassword
    });

  } catch (error) {
    console.error('Create user error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update user
router.put('/:userId', authenticateToken, requireScopes(['banking:write']), requireOwnershipOrAdmin, async (req, res) => {
  try {
    const { userId } = req.params;
    const updates = req.body;

    const user = dataStore.getUserById(userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Prevent updating certain fields for non-admin users
    if (req.user.role !== 'admin') {
      delete updates.role;
      delete updates.isActive;
    }

    // If password is being updated, hash it
    if (updates.password) {
      if (updates.password.length < 6) {
        return res.status(400).json({ error: 'Password must be at least 6 characters long' });
      }
      updates.password = hashPassword(updates.password);
    }

    // Check for username/email conflicts
    if (updates.username) {
      const existingUser = dataStore.getUserByUsername(updates.username);
      if (existingUser && existingUser.id !== userId) {
        return res.status(400).json({ error: 'Username already exists' });
      }
    }

    if (updates.email) {
      const existingEmail = dataStore.getAllUsers().find(user => user.email === updates.email && user.id !== userId);
      if (existingEmail) {
        return res.status(400).json({ error: 'Email already exists' });
      }
    }

    const updatedUser = await dataStore.updateUser(userId, updates);
    
    // Remove password from response
    const { password, ...userWithoutPassword } = updatedUser;

    res.json({
      message: 'User updated successfully',
      user: userWithoutPassword
    });

  } catch (error) {
    console.error('Update user error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Delete user (admin only)
router.delete('/:userId', authenticateToken, requireScopes(['banking:write']), requireAdmin, async (req, res) => {
  try {
    const { userId } = req.params;

    const user = dataStore.getUserById(userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Check if user has accounts
    const userAccounts = dataStore.getAccountsByUserId(userId);
    if (userAccounts.length > 0) {
      return res.status(400).json({ 
        error: 'Cannot delete user with existing accounts. Deactivate user instead.' 
      });
    }

    await dataStore.deleteUser(userId);

    res.json({ message: 'User deleted successfully' });

  } catch (error) {
    console.error('Delete user error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Search users (admin only)
router.get('/search/:query', authenticateToken, requireScopes(['banking:read']), requireAdmin, (req, res) => {
  try {
    const { query } = req.params;
    const users = dataStore.searchUsers(query);
    
    // Remove passwords from response
    const usersWithoutPasswords = users.map(user => {
      const { password, ...userWithoutPassword } = user;
      return userWithoutPassword;
    });

    res.json({ users: usersWithoutPasswords });

  } catch (error) {
    console.error('Search users error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
