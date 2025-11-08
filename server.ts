import { getTeslaStoreLabel } from './src/lib/tesla-stores';
import * as crypto from 'crypto';
import indexHtml from "./src/pages/index.html";
import callbackHtml from "./src/pages/callback.html";

// Tesla API constants
const CLIENT_ID = 'ownerapi';
const REDIRECT_URI = 'https://auth.tesla.com/void/callback'; // Tesla's fixed redirect URI
const AUTH_URL = 'https://auth.tesla.com/oauth2/v3/authorize';
const TOKEN_URL = 'https://auth.tesla.com/oauth2/v3/token';
const SCOPE = 'openid email offline_access';
const CODE_CHALLENGE_METHOD = 'S256';
const APP_VERSION = '9.99.9-9999';

// Store auth sessions temporarily
const authSessions = new Map<string, { codeVerifier: string; codeChallenge: string; timestamp: number }>();

// Clean up old sessions every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [sessionId, session] of authSessions) {
    if (now - session.timestamp > 10 * 60 * 1000) { // 10 minutes
      authSessions.delete(sessionId);
    }
  }
}, 5 * 60 * 1000);

// Utility functions
function generateCodeVerifierAndChallenge(): { codeVerifier: string; codeChallenge: string } {
  const codeVerifier = crypto.randomBytes(32).toString('base64url');
  const codeChallenge = crypto.createHash('sha256')
    .update(codeVerifier)
    .digest('base64url');
  return { codeVerifier, codeChallenge };
}

function isTokenValid(accessToken: string): boolean {
  try {
    const parts = accessToken.split('.');
    if (parts.length !== 3) return false;

    let payload = parts[1];
    while (payload.length % 4 !== 0) {
      payload += '=';
    }

    const decoded = JSON.parse(Buffer.from(payload, 'base64').toString('utf-8'));
    return decoded.exp > Math.floor(Date.now() / 1000);
  } catch (error) {
    return false;
  }
}

// API Handlers
async function handleGenerateAuthUrl(req: Request): Promise<Response> {
  const { codeVerifier, codeChallenge } = generateCodeVerifierAndChallenge();
  const sessionId = crypto.randomBytes(16).toString('hex');
  const state = sessionId; // Use sessionId as state for security

  // Store session data
  authSessions.set(sessionId, {
    codeVerifier,
    codeChallenge,
    timestamp: Date.now()
  });

  const authParams = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: 'code',
    scope: SCOPE,
    state: state,
    code_challenge: codeChallenge,
    code_challenge_method: CODE_CHALLENGE_METHOD,
  });

  const authUrl = `${AUTH_URL}?${authParams.toString()}`;

  return new Response(JSON.stringify({
    authUrl,
    sessionId,
    redirectUri: REDIRECT_URI
  }), {
    headers: { 'Content-Type': 'application/json' }
  });
}

async function handleCallback(req: Request): Promise<Response> {
  // Return the callback HTML page that will handle the OAuth callback
  return new Response(await Bun.file("./src/pages/callback.html").text(), {
    headers: { 'Content-Type': 'text/html' }
  });
}

async function handleExchangeCode(req: Request): Promise<Response> {
  const body = await req.json();
  const { code, sessionId } = body;

  // Retrieve session data using sessionId instead of state
  const session = authSessions.get(sessionId);
  if (!session) {
    return new Response(JSON.stringify({ error: 'Invalid session' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  const { codeVerifier } = session;

  const tokenData = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: CLIENT_ID,
    code: code,
    redirect_uri: REDIRECT_URI,
    code_verifier: codeVerifier,
  });

  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: tokenData.toString(),
  });

  // Clean up session
  authSessions.delete(sessionId);

  if (!response.ok) {
    return new Response(JSON.stringify({ error: 'Token exchange failed' }), {
      status: response.status,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  const tokens = await response.json();
  return new Response(JSON.stringify(tokens), {
    headers: { 'Content-Type': 'application/json' }
  });
}

async function handleRefreshToken(req: Request): Promise<Response> {
  const body = await req.json();
  const { refreshToken } = body;

  const tokenData = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: CLIENT_ID,
    refresh_token: refreshToken,
  });

  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: tokenData.toString(),
  });

  if (!response.ok) {
    return new Response(JSON.stringify({ error: 'Token refresh failed' }), {
      status: response.status,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  const tokens = await response.json();
  return new Response(JSON.stringify(tokens), {
    headers: { 'Content-Type': 'application/json' }
  });
}

async function handleGetOrders(req: Request): Promise<Response> {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return new Response(JSON.stringify({ error: 'No authorization token provided' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  const accessToken = authHeader.substring(7);

  if (!isTokenValid(accessToken)) {
    return new Response(JSON.stringify({ error: 'Token is expired' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  const response = await fetch('https://owner-api.teslamotors.com/api/1/users/orders', {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    return new Response(JSON.stringify({ error: 'Failed to retrieve orders' }), {
      status: response.status,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  const data = await response.json();
  return new Response(JSON.stringify(data.response), {
    headers: { 'Content-Type': 'application/json' }
  });
}

async function handleGetOrderDetails(req: Request): Promise<Response> {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return new Response(JSON.stringify({ error: 'No authorization token provided' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  const accessToken = authHeader.substring(7);
  const url = new URL(req.url);
  const orderId = url.searchParams.get('orderId');

  if (!orderId) {
    return new Response(JSON.stringify({ error: 'Order ID is required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  const apiUrl = `https://akamai-apigateway-vfx.tesla.com/tasks?deviceLanguage=en&deviceCountry=DE&referenceNumber=${orderId}&appVersion=${APP_VERSION}`;

  const response = await fetch(apiUrl, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    return new Response(JSON.stringify({ error: 'Failed to get order details' }), {
      status: response.status,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  const details = await response.json();
  return new Response(JSON.stringify(details), {
    headers: { 'Content-Type': 'application/json' }
  });
}

async function handleGetStoreLabel(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const storeId = url.searchParams.get('storeId');

  if (!storeId) {
    return new Response(JSON.stringify({ error: 'Store ID is required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  const label = getTeslaStoreLabel(parseInt(storeId));
  return new Response(JSON.stringify({ label }), {
    headers: { 'Content-Type': 'application/json' }
  });
}

async function handleCheckToken(req: Request): Promise<Response> {
  const body = await req.json();
  const { accessToken } = body;

  if (!accessToken) {
    return new Response(JSON.stringify({ valid: false }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }

  const valid = isTokenValid(accessToken);
  return new Response(JSON.stringify({ valid }), {
    headers: { 'Content-Type': 'application/json' }
  });
}

// Bun server with route handling
const port = process.env.PORT || 3456;

Bun.serve({
  port: port,
  routes: {
    "/": indexHtml,
    "/callback": callbackHtml,
    "/api/auth/generate-url": {
      GET: handleGenerateAuthUrl,
    },
    "/api/auth/exchange-code": {
      POST: handleExchangeCode,
    },
    "/api/auth/refresh": {
      POST: handleRefreshToken,
    },
    "/api/auth/check-token": {
      POST: handleCheckToken,
    },
    "/api/orders": {
      GET: handleGetOrders,
    },
    "/api/orders/details": {
      GET: handleGetOrderDetails,
    },
    "/api/stores/label": {
      GET: handleGetStoreLabel,
    },
  },
  development: {
    hmr: true,
    console: true,
  },
  fetch(req: Request) {
    const url = new URL(req.url);
    const path = url.pathname;

    // Handle callback route
    if (path === '/callback') {
      return handleCallback(req);
    }

    // Handle API routes
    if (path === '/api/auth/generate-url' && req.method === 'GET') {
      return handleGenerateAuthUrl(req);
    }
    if (path === '/api/auth/exchange-code' && req.method === 'POST') {
      return handleExchangeCode(req);
    }
    if (path === '/api/auth/refresh' && req.method === 'POST') {
      return handleRefreshToken(req);
    }
    if (path === '/api/auth/check-token' && req.method === 'POST') {
      return handleCheckToken(req);
    }
    if (path === '/api/orders' && req.method === 'GET') {
      return handleGetOrders(req);
    }
    if (path === '/api/orders/details' && req.method === 'GET') {
      return handleGetOrderDetails(req);
    }
    if (path === '/api/stores/label' && req.method === 'GET') {
      return handleGetStoreLabel(req);
    }

    // Default to 404
    return new Response('Not Found', { status: 404 });
  },
});

console.log(`Tesla Order Status Web Server running on http://localhost:${port}`);