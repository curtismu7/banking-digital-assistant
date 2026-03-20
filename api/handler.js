/**
 * Vercel serverless entry point.
 *
 * Vercel's @vercel/node runtime wraps this file as a serverless function.
 * ALL requests to /api/* are rewritten here by vercel.json, then Express
 * handles routing internally (routes/oauth.js, routes/auth.js, etc.).
 *
 * In local development the proxy in banking_api_ui/package.json forwards
 * /api/* to localhost:3001 — this file is NOT used locally.
 *
 * Environment variables:
 *   - Set in Vercel dashboard (Settings → Environment Variables)
 *   - See .env.vercel.example at the project root for the full list
 */
module.exports = require('../banking_api_server/server');
