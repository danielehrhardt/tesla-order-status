import React, { useState, useEffect, useCallback } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

// Type definitions
interface TokenData {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: string;
  created_at?: number;
}

interface Order {
  referenceNumber: string;
  orderStatus: string;
  modelCode: string;
  vin?: string;
  [key: string]: any;
}

interface OrderDetails {
  tasks?: {
    scheduling?: {
      deliveryWindowDisplay?: string;
      apptDateTimeAddressStr?: string;
    };
    registration?: {
      orderDetails?: {
        reservationDate?: string;
        orderBookedDate?: string;
        vehicleOdometer?: string;
        vehicleOdometerType?: string;
        vehicleRoutingLocation?: number;
      };
    };
    finalPayment?: {
      data?: {
        etaToDeliveryCenter?: string;
      };
    };
  };
}

interface DetailedOrder {
  order: Order;
  details: OrderDetails;
}

// Storage keys
const STORAGE_KEYS = {
  TOKENS: 'tesla_tokens',
  ORDERS: 'tesla_orders',
  CODE_VERIFIER: 'tesla_code_verifier',
};

// Utility functions
function saveToLocalStorage<T>(key: string, data: T): void {
  localStorage.setItem(key, JSON.stringify(data));
}

function loadFromLocalStorage<T>(key: string): T | null {
  const data = localStorage.getItem(key);
  return data ? JSON.parse(data) : null;
}

function removeFromLocalStorage(key: string): void {
  localStorage.removeItem(key);
}

function formatDate(dateString?: string): string {
  if (!dateString) return 'N/A';
  try {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  } catch {
    return dateString;
  }
}

function compareDicts(oldDict: any, newDict: any, path: string = ''): string[] {
  const differences: string[] = [];

  for (const key in oldDict) {
    if (!(key in newDict)) {
      differences.push(`- Removed key '${path}${key}'`);
    } else if (typeof oldDict[key] === 'object' && oldDict[key] !== null &&
               typeof newDict[key] === 'object' && newDict[key] !== null &&
               !Array.isArray(oldDict[key]) && !Array.isArray(newDict[key])) {
      differences.push(...compareDicts(oldDict[key], newDict[key], `${path}${key}.`));
    } else if (oldDict[key] !== newDict[key]) {
      differences.push(`- ${path}${key}: ${oldDict[key]}`);
      differences.push(`+ ${path}${key}: ${newDict[key]}`);
    }
  }

  for (const key in newDict) {
    if (!(key in oldDict)) {
      differences.push(`+ Added key '${path}${key}': ${newDict[key]}`);
    }
  }

  return differences;
}

// Main App Component
export default function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [tokens, setTokens] = useState<TokenData | null>(null);
  const [orders, setOrders] = useState<DetailedOrder[]>([]);
  const [previousOrders, setPreviousOrders] = useState<DetailedOrder[] | null>(null);
  const [differences, setDifferences] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [authUrl, setAuthUrl] = useState<string | null>(null);
  const [authCode, setAuthCode] = useState('');
  const [showComparison, setShowComparison] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [refreshInterval, setRefreshInterval] = useState(30); // minutes

  // Initialize from localStorage on mount
  useEffect(() => {
    const storedTokens = loadFromLocalStorage<TokenData>(STORAGE_KEYS.TOKENS);
    const storedOrders = loadFromLocalStorage<DetailedOrder[]>(STORAGE_KEYS.ORDERS);

    if (storedTokens) {
      checkAndRefreshToken(storedTokens);
    }

    if (storedOrders) {
      setPreviousOrders(storedOrders);
    }
  }, []);

  // Auto-refresh timer
  useEffect(() => {
    if (!autoRefresh || !isAuthenticated) return;

    const intervalId = setInterval(() => {
      fetchOrders();
    }, refreshInterval * 60 * 1000);

    return () => clearInterval(intervalId);
  }, [autoRefresh, refreshInterval, isAuthenticated]);

  const checkAndRefreshToken = async (tokenData: TokenData) => {
    try {
      const response = await fetch('/api/auth/check-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accessToken: tokenData.access_token }),
      });

      const result = await response.json();

      if (!result.valid && tokenData.refresh_token) {
        // Try to refresh the token
        const refreshResponse = await fetch('/api/auth/refresh', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refreshToken: tokenData.refresh_token }),
        });

        if (refreshResponse.ok) {
          const newTokens = await refreshResponse.json();
          const updatedTokens = {
            ...tokenData,
            access_token: newTokens.access_token,
            created_at: Date.now(),
          };
          setTokens(updatedTokens);
          saveToLocalStorage(STORAGE_KEYS.TOKENS, updatedTokens);
          setIsAuthenticated(true);
        } else {
          // Refresh failed, need to re-authenticate
          handleLogout();
        }
      } else if (result.valid) {
        setTokens(tokenData);
        setIsAuthenticated(true);
      } else {
        handleLogout();
      }
    } catch (err) {
      console.error('Error checking token:', err);
      handleLogout();
    }
  };

  const handleStartAuth = async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/auth/generate-url');
      const data = await response.json();

      setAuthUrl(data.authUrl);
      saveToLocalStorage(STORAGE_KEYS.CODE_VERIFIER, data.codeVerifier);

      // Open auth URL in new window
      window.open(data.authUrl, '_blank', 'width=800,height=600');
    } catch (err) {
      setError('Failed to generate authentication URL');
    } finally {
      setLoading(false);
    }
  };

  const handleAuthCodeSubmit = async () => {
    if (!authCode) {
      setError('Please enter the authorization code from the URL');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const codeVerifier = loadFromLocalStorage<string>(STORAGE_KEYS.CODE_VERIFIER);
      if (!codeVerifier) {
        throw new Error('Code verifier not found. Please restart authentication.');
      }

      // Extract code from URL if full URL was pasted
      let code = authCode;
      if (authCode.includes('code=')) {
        const url = new URL(authCode);
        code = url.searchParams.get('code') || '';
      }

      const response = await fetch('/api/auth/exchange-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, codeVerifier }),
      });

      if (!response.ok) {
        throw new Error('Failed to exchange code for tokens');
      }

      const tokenData = await response.json();
      const tokensWithTime = {
        ...tokenData,
        created_at: Date.now(),
      };

      setTokens(tokensWithTime);
      saveToLocalStorage(STORAGE_KEYS.TOKENS, tokensWithTime);
      setIsAuthenticated(true);
      setAuthCode('');
      setAuthUrl(null);
      removeFromLocalStorage(STORAGE_KEYS.CODE_VERIFIER);

      // Fetch orders immediately after authentication
      await fetchOrdersWithToken(tokensWithTime);
    } catch (err: any) {
      setError(err.message || 'Failed to authenticate');
    } finally {
      setLoading(false);
    }
  };

  const fetchOrdersWithToken = async (tokenData: TokenData) => {
    setLoading(true);
    setError(null);

    try {
      // Fetch orders
      const ordersResponse = await fetch('/api/orders', {
        headers: {
          'Authorization': `Bearer ${tokenData.access_token}`,
        },
      });

      if (!ordersResponse.ok) {
        if (ordersResponse.status === 401) {
          handleLogout();
          throw new Error('Authentication expired. Please log in again.');
        }
        throw new Error('Failed to fetch orders');
      }

      const ordersData = await ordersResponse.json();

      // Fetch detailed info for each order
      const detailedOrders: DetailedOrder[] = [];
      for (const order of ordersData) {
        const detailsResponse = await fetch(`/api/orders/details?orderId=${order.referenceNumber}`, {
          headers: {
            'Authorization': `Bearer ${tokenData.access_token}`,
          },
        });

        if (detailsResponse.ok) {
          const details = await detailsResponse.json();

          // Get store label
          const routingLocation = details.tasks?.registration?.orderDetails?.vehicleRoutingLocation;
          if (routingLocation) {
            const storeResponse = await fetch(`/api/stores/label?storeId=${routingLocation}`);
            if (storeResponse.ok) {
              const storeData = await storeResponse.json();
              if (!details.tasks.registration.orderDetails.routingLocationLabel) {
                details.tasks.registration.orderDetails.routingLocationLabel = storeData.label;
              }
            }
          }

          detailedOrders.push({ order, details });
        } else {
          detailedOrders.push({ order, details: {} });
        }
      }

      // Compare with previous orders
      const prevOrders = loadFromLocalStorage<DetailedOrder[]>(STORAGE_KEYS.ORDERS);
      if (prevOrders) {
        const diffs: string[] = [];
        for (let i = 0; i < Math.max(prevOrders.length, detailedOrders.length); i++) {
          if (i < prevOrders.length && i < detailedOrders.length) {
            diffs.push(...compareDicts(prevOrders[i], detailedOrders[i], `Order ${i}.`));
          } else if (i >= detailedOrders.length) {
            diffs.push(`- Removed order ${i}`);
          } else {
            diffs.push(`+ Added order ${i}`);
          }
        }
        setDifferences(diffs);
        if (diffs.length > 0) {
          setShowComparison(true);
        }
      }

      setOrders(detailedOrders);
      saveToLocalStorage(STORAGE_KEYS.ORDERS, detailedOrders);
    } catch (err: any) {
      setError(err.message || 'Failed to fetch orders');
    } finally {
      setLoading(false);
    }
  };

  const fetchOrders = () => {
    if (tokens) {
      fetchOrdersWithToken(tokens);
    }
  };

  const handleLogout = () => {
    setIsAuthenticated(false);
    setTokens(null);
    setOrders([]);
    setDifferences([]);
    removeFromLocalStorage(STORAGE_KEYS.TOKENS);
    setAuthUrl(null);
    setAuthCode('');
  };

  const handleClearData = () => {
    if (confirm('Are you sure you want to clear all stored data?')) {
      handleLogout();
      removeFromLocalStorage(STORAGE_KEYS.ORDERS);
      setPreviousOrders(null);
      setShowComparison(false);
    }
  };

  const renderOrderCard = (detailedOrder: DetailedOrder, index: number) => {
    const { order, details } = detailedOrder;
    const scheduling = details?.tasks?.scheduling || {};
    const orderInfo = details?.tasks?.registration?.orderDetails || {};
    const finalPaymentData = details?.tasks?.finalPayment?.data || {};

    return (
      <div key={order.referenceNumber} className="order-card">
        <div className="order-header">
          <h3>Order #{index + 1}</h3>
          <span className={`order-status status-${order.orderStatus?.toLowerCase()}`}>
            {order.orderStatus}
          </span>
        </div>

        <div className="order-content">
          <div className="order-section">
            <h4>Order Details</h4>
            <div className="info-grid">
              <div className="info-item">
                <span className="info-label">Order ID:</span>
                <span className="info-value">{order.referenceNumber}</span>
              </div>
              <div className="info-item">
                <span className="info-label">Model:</span>
                <span className="info-value">{order.modelCode}</span>
              </div>
              <div className="info-item">
                <span className="info-label">VIN:</span>
                <span className="info-value">{order.vin || 'Not assigned'}</span>
              </div>
              <div className="info-item">
                <span className="info-label">Odometer:</span>
                <span className="info-value">
                  {orderInfo.vehicleOdometer || 'N/A'} {orderInfo.vehicleOdometerType || ''}
                </span>
              </div>
            </div>
          </div>

          <div className="order-section">
            <h4>Dates</h4>
            <div className="info-grid">
              <div className="info-item">
                <span className="info-label">Reservation:</span>
                <span className="info-value">{formatDate(orderInfo.reservationDate)}</span>
              </div>
              <div className="info-item">
                <span className="info-label">Order Booked:</span>
                <span className="info-value">{formatDate(orderInfo.orderBookedDate)}</span>
              </div>
            </div>
          </div>

          <div className="order-section">
            <h4>Delivery Information</h4>
            <div className="info-grid">
              <div className="info-item">
                <span className="info-label">Routing Location:</span>
                <span className="info-value">
                  {orderInfo.routingLocationLabel || orderInfo.vehicleRoutingLocation || 'N/A'}
                </span>
              </div>
              <div className="info-item">
                <span className="info-label">Delivery Window:</span>
                <span className="info-value">{scheduling.deliveryWindowDisplay || 'Not scheduled'}</span>
              </div>
              <div className="info-item">
                <span className="info-label">ETA to Delivery Center:</span>
                <span className="info-value">{finalPaymentData.etaToDeliveryCenter || 'N/A'}</span>
              </div>
              <div className="info-item full-width">
                <span className="info-label">Appointment:</span>
                <span className="info-value">{scheduling.apptDateTimeAddressStr || 'Not scheduled'}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="app">
      <header className="header">
        <div className="container">
          <h1>Tesla Order Status Tracker</h1>
          <div className="header-actions">
            {isAuthenticated && (
              <>
                <button onClick={fetchOrders} disabled={loading} className="btn btn-primary">
                  {loading ? 'Refreshing...' : 'Refresh Orders'}
                </button>
                <button onClick={handleLogout} className="btn btn-secondary">
                  Logout
                </button>
                <button onClick={handleClearData} className="btn btn-danger">
                  Clear All Data
                </button>
              </>
            )}
          </div>
        </div>
      </header>

      <main className="main">
        <div className="container">
          {!isAuthenticated ? (
            <div className="auth-section">
              <div className="auth-card">
                <h2>Authenticate with Tesla</h2>
                <p>To track your Tesla order status, you need to authenticate with your Tesla account.</p>

                {!authUrl ? (
                  <button onClick={handleStartAuth} disabled={loading} className="btn btn-primary btn-large">
                    {loading ? 'Generating...' : 'Start Authentication'}
                  </button>
                ) : (
                  <div className="auth-code-section">
                    <p className="auth-instructions">
                      A new window has opened for Tesla authentication. After logging in, you'll be redirected
                      to a page that may show an error. Copy the entire URL from that page and paste it below:
                    </p>
                    <div className="auth-input-group">
                      <input
                        type="text"
                        value={authCode}
                        onChange={(e) => setAuthCode(e.target.value)}
                        placeholder="Paste the redirect URL here..."
                        className="auth-input"
                      />
                      <button
                        onClick={handleAuthCodeSubmit}
                        disabled={loading || !authCode}
                        className="btn btn-primary"
                      >
                        {loading ? 'Authenticating...' : 'Submit'}
                      </button>
                    </div>
                  </div>
                )}

                {error && <div className="error-message">{error}</div>}
              </div>
            </div>
          ) : (
            <>
              <div className="controls-section">
                <div className="controls-card">
                  <h3>Settings</h3>
                  <div className="controls-group">
                    <label className="checkbox-label">
                      <input
                        type="checkbox"
                        checked={autoRefresh}
                        onChange={(e) => setAutoRefresh(e.target.checked)}
                      />
                      <span>Auto-refresh orders</span>
                    </label>
                    {autoRefresh && (
                      <div className="refresh-interval">
                        <label>
                          Refresh every:
                          <select
                            value={refreshInterval}
                            onChange={(e) => setRefreshInterval(parseInt(e.target.value))}
                            className="select-input"
                          >
                            <option value={5}>5 minutes</option>
                            <option value={10}>10 minutes</option>
                            <option value={30}>30 minutes</option>
                            <option value={60}>1 hour</option>
                            <option value={120}>2 hours</option>
                          </select>
                        </label>
                      </div>
                    )}
                  </div>
                  {differences.length > 0 && (
                    <div className="controls-group">
                      <label className="checkbox-label">
                        <input
                          type="checkbox"
                          checked={showComparison}
                          onChange={(e) => setShowComparison(e.target.checked)}
                        />
                        <span>Show order comparisons ({differences.length} changes)</span>
                      </label>
                    </div>
                  )}
                </div>
              </div>

              {error && <div className="error-message container">{error}</div>}

              {showComparison && differences.length > 0 && (
                <div className="comparison-section">
                  <div className="comparison-card">
                    <h3>Changes Detected</h3>
                    <div className="differences-list">
                      {differences.map((diff, index) => (
                        <div
                          key={index}
                          className={`diff-item ${diff.startsWith('+') ? 'diff-add' : diff.startsWith('-') ? 'diff-remove' : ''}`}
                        >
                          {diff}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              <div className="orders-section">
                {loading && !orders.length ? (
                  <div className="loading-state">Loading orders...</div>
                ) : orders.length === 0 ? (
                  <div className="empty-state">
                    <p>No orders found. Click "Refresh Orders" to check for updates.</p>
                  </div>
                ) : (
                  <div className="orders-grid">
                    {orders.map((order, index) => renderOrderCard(order, index))}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </main>

      <footer className="footer">
        <div className="container">
          <p>Tesla Order Status Tracker - Built with Bun & React</p>
          <p className="footer-note">
            Your authentication tokens and order data are stored locally in your browser.
          </p>
        </div>
      </footer>
    </div>
  );
}

// Mount the app
const root = createRoot(document.getElementById('root')!);
root.render(<App />);