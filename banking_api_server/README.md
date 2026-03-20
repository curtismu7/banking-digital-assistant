# Banking API with P1AIC OAuth Integration

A comprehensive banking API server with administrative UI and PingOne Advanced Identity Cloud (P1AIC) OAuth2 integration for secure admin authentication.

## Features

- **RESTful Banking APIs**: CRUD operations for users, accounts, and transactions
- **Admin Dashboard**: Comprehensive administrative interface with activity logging
- **P1AIC OAuth Integration**: Enterprise-grade authentication using authorization code flow
- **Activity Logging**: Detailed request/response logging with filtering and export
- **Persistent Data**: File-based data persistence across server restarts
- **Security**: JWT authentication, rate limiting, CORS, and Helmet security headers

## Quick Start

### Prerequisites

- Node.js (v14 or higher)
- P1AIC tenant with admin access
- OAuth2 client configured in P1AIC

### Installation

1. **Clone the repository:**
   ```bash
   git clone <repository-url>
   cd agentic_mcp_server
   ```

2. **Install dependencies:**
   ```bash
   npm install
   cd client && npm install && cd ..
   ```

3. **Set up environment configuration:**
   ```bash
   ./setup-env.sh
   ```

4. **Configure P1AIC OAuth client:**
   - Follow the detailed instructions in `P1AIC_SETUP.md`
   - Update the `.env` file with your P1AIC configuration

5. **Start the application:**
   ```bash
   npm start
   ```

6. **Access the application:**
   - Frontend: http://localhost:3000
   - API: http://localhost:3001

## Authentication Options

### Regular Login (Demo)
- Username: `admin`
- Password: `admin123`
- Suitable for development and testing

### P1AIC OAuth (Production)
- Enterprise-grade authentication
- Single Sign-On (SSO) support
- Multi-Factor Authentication (MFA)
- Role-based access control
- Secure token management

## API Endpoints

### Authentication
- `POST /api/auth/login` - Regular login
- `GET /api/auth/oauth/login` - Initiate OAuth login
- `GET /api/auth/oauth/callback` - OAuth callback
- `GET /api/auth/oauth/logout` - Logout
- `GET /api/auth/me` - Get current user

### Banking Operations
- `GET /api/users` - Get all users
- `GET /api/accounts` - Get all accounts
- `GET /api/accounts/:id/balance` - Check account balance
- `POST /api/transactions/transfer` - Transfer money
- `GET /api/transactions` - Get transactions

### Admin Operations
- `GET /api/admin/stats` - System statistics
- `GET /api/admin/activity` - Activity logs
- `GET /api/admin/activity/summary` - Activity summary

## Configuration

### Environment Variables

Copy `env.example` to `.env` and configure:

```env
# P1AIC Configuration
P1AIC_TENANT_NAME=your-tenant-name
P1AIC_CLIENT_ID=your-client-id
P1AIC_CLIENT_SECRET=your-client-secret
P1AIC_REDIRECT_URI=http://localhost:3001/api/auth/oauth/callback

# Security
SESSION_SECRET=your-session-secret
ADMIN_ROLE=admin

# Server
PORT=3001
NODE_ENV=development
```

### P1AIC Setup

1. Create OAuth2 client in P1AIC admin console
2. Configure redirect URI: `http://localhost:3001/api/auth/oauth/callback`
3. Set grant types to "Authorization Code"
4. Configure user roles and attributes
5. Update `.env` file with client credentials

## Development

### Project Structure

```
├── config/           # Configuration files
├── data/            # Data store and sample data
├── middleware/      # Express middleware
├── routes/          # API route handlers
├── services/        # Business logic services
├── client/          # React frontend
├── server.js        # Main server file
└── setup-env.sh     # Environment setup script
```

### Available Scripts

- `npm start` - Start the server
- `npm run dev` - Start with nodemon
- `npm run build` - Build React app
- `./setup-env.sh` - Set up environment

## Security Features

- **OAuth2 Authorization Code Flow**: Secure authentication
- **CSRF Protection**: State parameter validation
- **Session Management**: Secure httpOnly cookies
- **Rate Limiting**: Request throttling
- **CORS**: Cross-origin resource sharing
- **Helmet**: Security headers
- **JWT Tokens**: Stateless authentication

## Troubleshooting

### Common Issues

1. **"Invalid redirect URI"**
   - Ensure redirect URI matches P1AIC configuration exactly

2. **"Invalid client"**
   - Verify client ID and secret in `.env` file

3. **"Insufficient permissions"**
   - Check user role assignment in P1AIC

4. **Session issues**
   - Verify session secret is properly set

### Debug Mode

Enable OAuth debugging:
```env
DEBUG_OAUTH=true
```

## Documentation

- `P1AIC_SETUP.md` - Detailed P1AIC configuration guide
- `env.example` - Environment configuration template
- `setup-env.sh` - Automated environment setup

## License

MIT License - see LICENSE file for details.
