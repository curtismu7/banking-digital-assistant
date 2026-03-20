const express = require('express');
const router = express.Router();
const dataStore = require('../data/store');
const { requireAdmin, requireScopes } = require('../middleware/auth');

// Get system statistics
router.get('/stats', requireAdmin, requireScopes(['banking:admin']), (req, res) => {
  try {
    const users = dataStore.getAllUsers();
    const accounts = dataStore.getAllAccounts();
    const transactions = dataStore.getAllTransactions();
    const activityLogs = dataStore.getAllActivityLogs();

    const stats = {
      totalUsers: users.length,
      activeUsers: users.filter(user => user.isActive).length,
      totalAccounts: accounts.length,
      activeAccounts: accounts.filter(account => account.isActive).length,
      totalTransactions: transactions.length,
      totalActivityLogs: activityLogs.length,
      totalBalance: accounts.reduce((sum, account) => sum + account.balance, 0),
      averageBalance: accounts.length > 0 ? accounts.reduce((sum, account) => sum + account.balance, 0) / accounts.length : 0
    };

    res.json({ stats });

  } catch (error) {
    console.error('Get stats error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get all activity logs
router.get('/activity', requireAdmin, requireScopes(['banking:admin']), (req, res) => {
  try {
    const { page = 1, limit = 50, username, action, startDate, endDate } = req.query;
    
    let logs = dataStore.getAllActivityLogs();

    // Filter by username
    if (username) {
      logs = logs.filter(log => log.username && log.username.toLowerCase().includes(username.toLowerCase()));
    }

    // Filter by action
    if (action) {
      logs = logs.filter(log => log.action && log.action.toLowerCase().includes(action.toLowerCase()));
    }

    // Filter by date range
    if (startDate) {
      const start = new Date(startDate);
      logs = logs.filter(log => new Date(log.timestamp) >= start);
    }

    if (endDate) {
      const end = new Date(endDate);
      logs = logs.filter(log => new Date(log.timestamp) <= end);
    }

    // Sort by timestamp (newest first)
    logs.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    // Pagination
    const startIndex = (page - 1) * limit;
    const endIndex = page * limit;
    const paginatedLogs = logs.slice(startIndex, endIndex);

    const totalPages = Math.ceil(logs.length / limit);

    res.json({
      logs: paginatedLogs,
      pagination: {
        currentPage: parseInt(page),
        totalPages,
        totalLogs: logs.length,
        logsPerPage: parseInt(limit)
      }
    });

  } catch (error) {
    console.error('Get activity logs error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get activity logs by username
router.get('/activity/user/:username', requireAdmin, requireScopes(['banking:admin']), (req, res) => {
  try {
    const { username } = req.params;
    const { page = 1, limit = 50 } = req.query;

    let logs = dataStore.getActivityLogsByUsername(username);

    // Sort by timestamp (newest first)
    logs.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    // Pagination
    const startIndex = (page - 1) * limit;
    const endIndex = page * limit;
    const paginatedLogs = logs.slice(startIndex, endIndex);

    const totalPages = Math.ceil(logs.length / limit);

    res.json({
      logs: paginatedLogs,
      pagination: {
        currentPage: parseInt(page),
        totalPages,
        totalLogs: logs.length,
        logsPerPage: parseInt(limit)
      }
    });

  } catch (error) {
    console.error('Get user activity logs error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get activity logs by user ID
router.get('/activity/userid/:userId', requireAdmin, requireScopes(['banking:admin']), (req, res) => {
  try {
    const { userId } = req.params;
    const { page = 1, limit = 50 } = req.query;

    let logs = dataStore.getActivityLogsByUserId(userId);

    // Sort by timestamp (newest first)
    logs.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    // Pagination
    const startIndex = (page - 1) * limit;
    const endIndex = page * limit;
    const paginatedLogs = logs.slice(startIndex, endIndex);

    const totalPages = Math.ceil(logs.length / limit);

    res.json({
      logs: paginatedLogs,
      pagination: {
        currentPage: parseInt(page),
        totalPages,
        totalLogs: logs.length,
        logsPerPage: parseInt(limit)
      }
    });

  } catch (error) {
    console.error('Get user ID activity logs error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get recent activity (last 24 hours)
router.get('/activity/recent', requireAdmin, requireScopes(['banking:admin']), (req, res) => {
  try {
    const { hours = 24 } = req.query;
    const cutoffTime = new Date(Date.now() - (hours * 60 * 60 * 1000));
    
    const logs = dataStore.getAllActivityLogs()
      .filter(log => new Date(log.timestamp) >= cutoffTime)
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    res.json({ logs });

  } catch (error) {
    console.error('Get recent activity error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get activity summary by action type
router.get('/activity/summary', requireAdmin, requireScopes(['banking:admin']), (req, res) => {
  try {
    const logs = dataStore.getAllActivityLogs();
    
    const summary = logs.reduce((acc, log) => {
      const action = log.action || 'UNKNOWN';
      acc[action] = (acc[action] || 0) + 1;
      return acc;
    }, {});

    // Convert to array and sort by count
    const summaryArray = Object.entries(summary)
      .map(([action, count]) => ({ action, count }))
      .sort((a, b) => b.count - a.count);

    res.json({ summary: summaryArray });

  } catch (error) {
    console.error('Get activity summary error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get user activity summary
router.get('/activity/users/summary', requireAdmin, requireScopes(['banking:admin']), (req, res) => {
  try {
    const logs = dataStore.getAllActivityLogs();
    
    const userSummary = logs.reduce((acc, log) => {
      const username = log.username || 'Unknown';
      if (!acc[username]) {
        acc[username] = {
          username,
          totalActions: 0,
          actions: {}
        };
      }
      
      acc[username].totalActions++;
      const action = log.action || 'UNKNOWN';
      acc[username].actions[action] = (acc[username].actions[action] || 0) + 1;
      
      return acc;
    }, {});

    // Convert to array and sort by total actions
    const summaryArray = Object.values(userSummary)
      .sort((a, b) => b.totalActions - a.totalActions);

    res.json({ userSummary: summaryArray });

  } catch (error) {
    console.error('Get user activity summary error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Clear old activity logs (older than specified days)
router.delete('/activity/clear', requireAdmin, requireScopes(['banking:admin']), (req, res) => {
  try {
    const { days = 30 } = req.query;
    const cutoffDate = new Date(Date.now() - (days * 24 * 60 * 60 * 1000));
    
    const logs = dataStore.getAllActivityLogs();
    const logsToKeep = logs.filter(log => new Date(log.timestamp) >= cutoffDate);
    const logsToDelete = logs.filter(log => new Date(log.timestamp) < cutoffDate);

    // Clear all logs and restore only the ones to keep
    dataStore.activityLogs.clear();
    logsToKeep.forEach(log => {
      dataStore.activityLogs.set(log.id, log);
    });

    res.json({ 
      message: `Cleared ${logsToDelete.length} old activity logs`,
      deletedCount: logsToDelete.length,
      remainingCount: logsToKeep.length
    });

  } catch (error) {
    console.error('Clear activity logs error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Export activity logs (CSV format)
router.get('/activity/export', requireAdmin, requireScopes(['banking:admin']), (req, res) => {
  try {
    const logs = dataStore.getAllActivityLogs()
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    // Create CSV content
    const csvHeaders = 'ID,User ID,Username,Action,Endpoint,IP Address,User Agent,Response Status,Duration (ms),Timestamp\n';
    const csvRows = logs.map(log => {
      return [
        log.id,
        log.userId || '',
        log.username || '',
        log.action || '',
        log.endpoint || '',
        log.ipAddress || '',
        `"${(log.userAgent || '').replace(/"/g, '""')}"`,
        log.responseStatus || '',
        log.duration || '',
        log.timestamp
      ].join(',');
    }).join('\n');

    const csvContent = csvHeaders + csvRows;

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="activity_logs_${new Date().toISOString().split('T')[0]}.csv"`);
    res.send(csvContent);

  } catch (error) {
    console.error('Export activity logs error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
