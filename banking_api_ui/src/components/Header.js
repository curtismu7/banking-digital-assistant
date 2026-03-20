import React from 'react';
import { NavLink, useLocation } from 'react-router-dom';

const Header = ({ user, onLogout }) => {
  const location = useLocation();
  const isAdmin = user?.role === 'admin';

  return (
    <header className="header">
      <div className="container">
        <div className="header-content">
          <h1>{isAdmin ? 'Accounts API Admin Dashboard' : 'Personal Account Dashboard'}</h1>
          <nav className="nav">
            {isAdmin ? (
              <>
                <NavLink 
                  to="/admin" 
                  className={`nav-link ${location.pathname === '/admin' ? 'active' : ''}`}
                >
                  Admin Dashboard
                </NavLink>
                <NavLink 
                  to="/activity" 
                  className={`nav-link ${location.pathname === '/activity' ? 'active' : ''}`}
                >
                  Activity Logs
                </NavLink>
                <NavLink 
                  to="/users" 
                  className={`nav-link ${location.pathname === '/users' ? 'active' : ''}`}
                >
                  Users
                </NavLink>
                <NavLink 
                  to="/accounts" 
                  className={`nav-link ${location.pathname === '/accounts' ? 'active' : ''}`}
                >
                  Accounts
                </NavLink>
                <NavLink 
                  to="/transactions" 
                  className={`nav-link ${location.pathname === '/transactions' ? 'active' : ''}`}
                >
                  Transactions
                </NavLink>
              </>
            ) : (
              <NavLink 
                to="/dashboard" 
                className={`nav-link ${location.pathname === '/dashboard' ? 'active' : ''}`}
              >
                My Dashboard
              </NavLink>
            )}
            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
              <span>Welcome, {user.firstName} {user.lastName}</span>
              <button onClick={onLogout} className="btn btn-secondary">
                Logout
              </button>
            </div>
          </nav>
        </div>
      </div>
    </header>
  );
};

export default Header;
