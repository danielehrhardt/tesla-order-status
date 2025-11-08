import React, { useState, useEffect, useCallback } from 'react';
import { createRoot } from 'react-dom/client';

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
  SESSION_ID: 'tesla_session_id',
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
  const [differences, setDifferences] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showComparison, setShowComparison] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [refreshInterval, setRefreshInterval] = useState(30);

  // Initialize from localStorage on mount
  useEffect(() => {
    const storedTokens = loadFromLocalStorage<TokenData>(STORAGE_KEYS.TOKENS);
    const authSuccess = localStorage.getItem('tesla_auth_success');

    // Check if we just completed auth
    if (authSuccess === 'true') {
      localStorage.removeItem('tesla_auth_success');
      const newTokens = loadFromLocalStorage<TokenData>(STORAGE_KEYS.TOKENS);
      if (newTokens) {
        setTokens(newTokens);
        setIsAuthenticated(true);
        fetchOrdersWithToken(newTokens);
      }
    } else if (storedTokens) {
      checkAndRefreshToken(storedTokens);
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

      // Store session ID
      saveToLocalStorage(STORAGE_KEYS.SESSION_ID, data.sessionId);

      // Redirect to Tesla auth in the same window
      window.location.href = data.authUrl;
    } catch (err) {
      setError('Failed to start authentication');
    } finally {
      setLoading(false);
    }
  };

  const fetchOrdersWithToken = async (tokenData: TokenData) => {
    setLoading(true);
    setError(null);

    try {
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
    removeFromLocalStorage(STORAGE_KEYS.SESSION_ID);
  };

  const handleClearData = () => {
    if (confirm('Are you sure you want to clear all stored data?')) {
      handleLogout();
      removeFromLocalStorage(STORAGE_KEYS.ORDERS);
      setShowComparison(false);
    }
  };

  const renderOrderCard = (detailedOrder: DetailedOrder, index: number) => {
    const { order, details } = detailedOrder;
    const scheduling = details?.tasks?.scheduling || {};
    const orderInfo = details?.tasks?.registration?.orderDetails || {};
    const finalPaymentData = details?.tasks?.finalPayment?.data || {};

    const statusColors: Record<string, string> = {
      ordered: 'bg-green-900/20 text-green-400 border-green-900',
      active: 'bg-green-900/20 text-green-400 border-green-900',
      pending: 'bg-yellow-900/20 text-yellow-400 border-yellow-900',
      delivered: 'bg-blue-900/20 text-blue-400 border-blue-900',
    };

    return (
      <div key={order.referenceNumber} className="bg-gray-900/50 backdrop-blur border border-gray-800 rounded-xl p-6 hover:-translate-y-1 hover:shadow-2xl hover:shadow-red-900/20 hover:border-red-900/30 transition-all duration-300">
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-lg font-semibold text-white">Order #{index + 1}</h3>
          <span className={`px-3 py-1 rounded-full text-xs font-semibold uppercase tracking-wider border ${statusColors[order.orderStatus?.toLowerCase()] || 'bg-gray-900/20 text-gray-400 border-gray-800'}`}>
            {order.orderStatus}
          </span>
        </div>

        <div className="space-y-6">
          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-3">Order Details</h4>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <span className="text-xs text-gray-500">Order ID</span>
                <p className="text-sm font-medium text-white">{order.referenceNumber}</p>
              </div>
              <div className="space-y-1">
                <span className="text-xs text-gray-500">Model</span>
                <p className="text-sm font-medium text-white">{order.modelCode}</p>
              </div>
              <div className="space-y-1">
                <span className="text-xs text-gray-500">VIN</span>
                <p className="text-sm font-medium text-white">{order.vin || 'Not assigned'}</p>
              </div>
              <div className="space-y-1">
                <span className="text-xs text-gray-500">Odometer</span>
                <p className="text-sm font-medium text-white">
                  {orderInfo.vehicleOdometer || 'N/A'} {orderInfo.vehicleOdometerType || ''}
                </p>
              </div>
            </div>
          </div>

          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-3">Dates</h4>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <span className="text-xs text-gray-500">Reservation</span>
                <p className="text-sm font-medium text-white">{formatDate(orderInfo.reservationDate)}</p>
              </div>
              <div className="space-y-1">
                <span className="text-xs text-gray-500">Order Booked</span>
                <p className="text-sm font-medium text-white">{formatDate(orderInfo.orderBookedDate)}</p>
              </div>
            </div>
          </div>

          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-3">Delivery Information</h4>
            <div className="space-y-3">
              <div className="space-y-1">
                <span className="text-xs text-gray-500">Routing Location</span>
                <p className="text-sm font-medium text-white">
                  {orderInfo.routingLocationLabel || orderInfo.vehicleRoutingLocation || 'N/A'}
                </p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <span className="text-xs text-gray-500">Delivery Window</span>
                  <p className="text-sm font-medium text-white">{scheduling.deliveryWindowDisplay || 'Not scheduled'}</p>
                </div>
                <div className="space-y-1">
                  <span className="text-xs text-gray-500">ETA to Center</span>
                  <p className="text-sm font-medium text-white">{finalPaymentData.etaToDeliveryCenter || 'N/A'}</p>
                </div>
              </div>
              <div className="space-y-1">
                <span className="text-xs text-gray-500">Appointment</span>
                <p className="text-sm font-medium text-white">{scheduling.apptDateTimeAddressStr || 'Not scheduled'}</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-black">
      {/* Header */}
      <header className="bg-gray-900/90 backdrop-blur-lg border-b border-gray-800 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <h1 className="text-xl font-bold bg-gradient-to-r from-white to-gray-400 bg-clip-text text-transparent">
              Tesla Order Status Tracker
            </h1>
            {isAuthenticated && (
              <div className="flex gap-3">
                <button
                  onClick={fetchOrders}
                  disabled={loading}
                  className="px-4 py-2 bg-gradient-to-r from-red-600 to-red-700 hover:from-red-700 hover:to-red-800 text-white rounded-lg font-medium transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg hover:shadow-red-900/50 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {loading ? 'Refreshing...' : 'Refresh Orders'}
                </button>
                <button
                  onClick={handleLogout}
                  className="px-4 py-2 bg-gray-800 hover:bg-gray-700 text-white rounded-lg font-medium transition-all duration-200 border border-gray-700 hover:border-gray-600"
                >
                  Logout
                </button>
                <button
                  onClick={handleClearData}
                  className="px-4 py-2 bg-red-900/20 hover:bg-red-900/30 text-red-400 rounded-lg font-medium transition-all duration-200 border border-red-900/50 hover:border-red-900"
                >
                  Clear Data
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {!isAuthenticated ? (
          <div className="flex items-center justify-center min-h-[60vh]">
            <div className="bg-gray-900/50 backdrop-blur border border-gray-800 rounded-2xl p-10 max-w-md w-full text-center">
              <h2 className="text-3xl font-bold bg-gradient-to-r from-white to-gray-300 bg-clip-text text-transparent mb-4">
                Authenticate with Tesla
              </h2>
              <p className="text-gray-400 mb-8">
                Connect your Tesla account to track your order status in real-time.
              </p>
              <button
                onClick={handleStartAuth}
                disabled={loading}
                className="w-full px-6 py-3 bg-gradient-to-r from-red-600 to-red-700 hover:from-red-700 hover:to-red-800 text-white rounded-lg font-semibold transition-all duration-200 hover:-translate-y-0.5 hover:shadow-xl hover:shadow-red-900/50 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? 'Starting...' : 'Start Authentication'}
              </button>
              <p className="text-xs text-gray-500 mt-4">
                You'll be redirected to Tesla's secure login page
              </p>
              {error && (
                <div className="mt-4 p-3 bg-red-900/20 border border-red-900/50 rounded-lg text-red-400 text-sm">
                  {error}
                </div>
              )}
            </div>
          </div>
        ) : (
          <>
            {/* Controls */}
            <div className="bg-gray-900/50 backdrop-blur border border-gray-800 rounded-xl p-6 mb-6">
              <h3 className="text-lg font-semibold text-white mb-4">Settings</h3>
              <div className="space-y-4">
                <label className="flex items-center gap-3 cursor-pointer group">
                  <input
                    type="checkbox"
                    checked={autoRefresh}
                    onChange={(e) => setAutoRefresh(e.target.checked)}
                    className="w-5 h-5 rounded border-gray-700 bg-gray-800 text-red-600 focus:ring-red-900 focus:ring-offset-0"
                  />
                  <span className="text-gray-300 group-hover:text-white transition-colors">Auto-refresh orders</span>
                </label>
                {autoRefresh && (
                  <div className="ml-8 flex items-center gap-3">
                    <label className="text-gray-400">Refresh every:</label>
                    <select
                      value={refreshInterval}
                      onChange={(e) => setRefreshInterval(parseInt(e.target.value))}
                      className="px-3 py-1.5 bg-gray-800 border border-gray-700 rounded-lg text-white focus:border-red-900 focus:outline-none focus:ring-1 focus:ring-red-900"
                    >
                      <option value={5}>5 minutes</option>
                      <option value={10}>10 minutes</option>
                      <option value={30}>30 minutes</option>
                      <option value={60}>1 hour</option>
                      <option value={120}>2 hours</option>
                    </select>
                  </div>
                )}
                {differences.length > 0 && (
                  <label className="flex items-center gap-3 cursor-pointer group">
                    <input
                      type="checkbox"
                      checked={showComparison}
                      onChange={(e) => setShowComparison(e.target.checked)}
                      className="w-5 h-5 rounded border-gray-700 bg-gray-800 text-red-600 focus:ring-red-900 focus:ring-offset-0"
                    />
                    <span className="text-gray-300 group-hover:text-white transition-colors">
                      Show order comparisons ({differences.length} changes)
                    </span>
                  </label>
                )}
              </div>
            </div>

            {/* Error Message */}
            {error && (
              <div className="mb-6 p-4 bg-red-900/20 border border-red-900/50 rounded-lg text-red-400">
                {error}
              </div>
            )}

            {/* Comparison */}
            {showComparison && differences.length > 0 && (
              <div className="bg-gray-900/50 backdrop-blur border border-gray-800 rounded-xl p-6 mb-6">
                <h3 className="text-lg font-semibold text-yellow-400 mb-4">Changes Detected</h3>
                <div className="bg-black/50 rounded-lg p-4 max-h-96 overflow-y-auto">
                  <div className="font-mono text-sm space-y-1">
                    {differences.map((diff, index) => (
                      <div
                        key={index}
                        className={`${
                          diff.startsWith('+') ? 'text-green-400' :
                          diff.startsWith('-') ? 'text-red-400' :
                          'text-gray-400'
                        }`}
                      >
                        {diff}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* Orders */}
            <div className="space-y-4">
              {loading && !orders.length ? (
                <div className="text-center py-12 text-gray-400">
                  <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-red-600"></div>
                  <p className="mt-4">Loading orders...</p>
                </div>
              ) : orders.length === 0 ? (
                <div className="text-center py-12 text-gray-400">
                  <p>No orders found. Click "Refresh Orders" to check for updates.</p>
                </div>
              ) : (
                <div className="grid gap-6 md:grid-cols-2">
                  {orders.map((order, index) => renderOrderCard(order, index))}
                </div>
              )}
            </div>
          </>
        )}
      </main>

      {/* Footer */}
      <footer className="mt-auto border-t border-gray-800 bg-gray-900/50 backdrop-blur">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 text-center">
          <p className="text-gray-400">Tesla Order Status Tracker - Built with Bun & React</p>
          <p className="text-xs text-gray-600 mt-2">
            Your authentication tokens and order data are stored locally in your browser
          </p>
        </div>
      </footer>
    </div>
  );
}

// Mount the app
const root = createRoot(document.getElementById('root')!);
root.render(<App />);