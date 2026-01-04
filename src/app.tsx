import React, { useState, useEffect, useCallback, useRef } from "react";
import { createRoot } from "react-dom/client";

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
        routingLocationLabel?: string;
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

// History and Timeline types
interface ChangeOperation {
  key: string;
  operation: "added" | "removed" | "changed";
  oldValue?: any;
  newValue?: any;
}

interface HistoryEntry {
  timestamp: number;
  changes: ChangeOperation[];
}

interface TimelineEvent {
  timestamp: number;
  key: string;
  value: any;
  label: string;
  isNew?: boolean;
}

// Privacy settings
interface PrivacySettings {
  maskVIN: boolean;
  maskOrderId: boolean;
  vinMaskLength: number;
  orderIdMaskLength: number;
}

// Storage keys
const STORAGE_KEYS = {
  TOKENS: "tesla_tokens",
  ORDERS: "tesla_orders",
  SESSION_ID: "tesla_session_id",
  HISTORY: "tesla_history",
  TIMELINE: "tesla_timeline",
  PRIVACY_SETTINGS: "tesla_privacy_settings",
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
  if (!dateString) return "N/A";
  try {
    return new Date(dateString).toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  } catch {
    return dateString;
  }
}

// Enhanced comparison function that returns structured change operations
function compareDicts(
  oldDict: any,
  newDict: any,
  path: string = ""
): ChangeOperation[] {
  const changes: ChangeOperation[] = [];

  // Helper function to check if values are effectively equal
  const areValuesEqual = (val1: any, val2: any): boolean => {
    if (val1 === val2) return true;
    if (
      (val1 === null || val1 === undefined) &&
      (val2 === null || val2 === undefined)
    ) {
      return true;
    }
    if (Array.isArray(val1) && Array.isArray(val2)) {
      return JSON.stringify(val1) === JSON.stringify(val2);
    }
    if (
      typeof val1 === "object" &&
      val1 !== null &&
      typeof val2 === "object" &&
      val2 !== null
    ) {
      try {
        return JSON.stringify(val1) === JSON.stringify(val2);
      } catch {
        return false;
      }
    }
    return false;
  };

  for (const key in oldDict) {
    if (!(key in newDict)) {
      changes.push({
        key: `${path}${key}`,
        operation: "removed",
        oldValue: oldDict[key],
      });
    } else if (
      typeof oldDict[key] === "object" &&
      oldDict[key] !== null &&
      typeof newDict[key] === "object" &&
      newDict[key] !== null &&
      !Array.isArray(oldDict[key]) &&
      !Array.isArray(newDict[key])
    ) {
      // Recursively compare nested objects
      changes.push(
        ...compareDicts(oldDict[key], newDict[key], `${path}${key}.`)
      );
    } else if (!areValuesEqual(oldDict[key], newDict[key])) {
      changes.push({
        key: `${path}${key}`,
        operation: "changed",
        oldValue: oldDict[key],
        newValue: newDict[key],
      });
    }
  }

  for (const key in newDict) {
    if (!(key in oldDict)) {
      changes.push({
        key: `${path}${key}`,
        operation: "added",
        newValue: newDict[key],
      });
    }
  }

  return changes;
}

// Convert change operations to display strings (for backward compatibility)
function formatChangeOperations(changes: ChangeOperation[]): string[] {
  const formatValue = (val: any): string => {
    if (val === null) return "null";
    if (val === undefined) return "undefined";
    if (Array.isArray(val)) return JSON.stringify(val);
    if (typeof val === "object") return JSON.stringify(val);
    return String(val);
  };

  return changes.map((change) => {
    switch (change.operation) {
      case "added":
        return `+ Added key '${change.key}': ${formatValue(change.newValue)}`;
      case "removed":
        return `- Removed key '${change.key}'`;
      case "changed":
        return `≠ ${change.key}: ${formatValue(
          change.oldValue
        )} → ${formatValue(change.newValue)}`;
      default:
        return "";
    }
  });
}

// History management functions
function saveHistoryEntry(changes: ChangeOperation[]): void {
  if (changes.length === 0) return;

  const history =
    loadFromLocalStorage<HistoryEntry[]>(STORAGE_KEYS.HISTORY) || [];
  history.push({
    timestamp: Date.now(),
    changes,
  });
  saveToLocalStorage(STORAGE_KEYS.HISTORY, history);
}

function getHistory(): HistoryEntry[] {
  return loadFromLocalStorage<HistoryEntry[]>(STORAGE_KEYS.HISTORY) || [];
}

// Timeline management functions
function buildTimeline(
  orders: DetailedOrder[],
  history: HistoryEntry[]
): TimelineEvent[] {
  const events: TimelineEvent[] = [];
  const seenKeys = new Set<string>();

  // Extract events from current order state
  orders.forEach((detailedOrder, index) => {
    const orderInfo = detailedOrder.details?.tasks?.registration?.orderDetails;
    const scheduling = detailedOrder.details?.tasks?.scheduling;
    const finalPayment = detailedOrder.details?.tasks?.finalPayment?.data;

    // Add reservation date
    if (orderInfo?.reservationDate) {
      const key = `order.${index}.reservationDate`;
      events.push({
        timestamp: new Date(orderInfo.reservationDate).getTime(),
        key,
        value: orderInfo.reservationDate,
        label: "Reservation",
      });
      seenKeys.add(key);
    }

    // Add order booked date
    if (orderInfo?.orderBookedDate) {
      const key = `order.${index}.orderBookedDate`;
      events.push({
        timestamp: new Date(orderInfo.orderBookedDate).getTime(),
        key,
        value: orderInfo.orderBookedDate,
        label: "Order Booked",
      });
      seenKeys.add(key);
    }

    // Add VIN assignment (if present, use current time as we don't have exact assignment date)
    if (detailedOrder.order.vin) {
      const key = `order.${index}.vin`;
      if (!seenKeys.has(key)) {
        events.push({
          timestamp: Date.now(),
          key,
          value: detailedOrder.order.vin,
          label: "VIN Assigned",
        });
        seenKeys.add(key);
      }
    }

    // Add delivery window
    if (scheduling?.deliveryWindowDisplay) {
      const key = `order.${index}.deliveryWindow`;
      if (!seenKeys.has(key)) {
        events.push({
          timestamp: Date.now(),
          key,
          value: scheduling.deliveryWindowDisplay,
          label: "Delivery Window",
        });
        seenKeys.add(key);
      }
    }

    // Add odometer reading (indicates car is built)
    if (orderInfo?.vehicleOdometer) {
      const key = `order.${index}.carBuilt`;
      if (!seenKeys.has(key)) {
        events.push({
          timestamp: Date.now(),
          key,
          value: `${orderInfo.vehicleOdometer} ${
            orderInfo.vehicleOdometerType || ""
          }`,
          label: "Car Built",
        });
        seenKeys.add(key);
      }
    }
  });

  // Add events from history
  history.forEach((entry) => {
    entry.changes.forEach((change) => {
      // Check if this is a significant event worth adding to timeline
      const lowerKey = change.key.toLowerCase();

      if (
        lowerKey.includes("vin") ||
        lowerKey.includes("deliverywindow") ||
        lowerKey.includes("orderstatus") ||
        lowerKey.includes("vehicleodometer") ||
        lowerKey.includes("appointment")
      ) {
        const eventKey = `${change.key}.${change.operation}`;
        const existingEvent = events.find((e) => e.key === change.key);

        events.push({
          timestamp: entry.timestamp,
          key: change.key,
          value: change.newValue || change.oldValue,
          label: translateKeyToLabel(change.key),
          isNew: !!existingEvent, // Mark as "new" if key already exists
        });
      }
    });
  });

  // Sort by timestamp
  return events.sort((a, b) => a.timestamp - b.timestamp);
}

function translateKeyToLabel(key: string): string {
  const lowerKey = key.toLowerCase();

  if (lowerKey.includes("vin")) return "VIN";
  if (lowerKey.includes("deliverywindow")) return "Delivery Window";
  if (lowerKey.includes("orderstatus")) return "Order Status";
  if (lowerKey.includes("vehicleodometer")) return "Odometer";
  if (lowerKey.includes("appointment")) return "Appointment";
  if (lowerKey.includes("reservation")) return "Reservation";
  if (lowerKey.includes("orderbooked")) return "Order Booked";
  if (lowerKey.includes("etatodeliverycenter")) return "ETA to Center";

  // Default: capitalize and remove path prefixes
  const parts = key.split(".");
  const lastPart = parts[parts.length - 1];
  return lastPart.charAt(0).toUpperCase() + lastPart.slice(1);
}

// Privacy/masking functions
function maskString(str: string, maskLength: number): string {
  if (!str || maskLength >= str.length) return "█".repeat(str.length);
  const visibleChars = Math.max(0, str.length - maskLength);
  return "█".repeat(maskLength) + str.slice(visibleChars);
}

function applyPrivacyMask(data: any, settings: PrivacySettings): any {
  if (!data) return data;

  const masked = JSON.parse(JSON.stringify(data)); // Deep clone

  function maskObject(obj: any, path: string = ""): void {
    for (const key in obj) {
      const currentPath = path ? `${path}.${key}` : key;

      if (typeof obj[key] === "object" && obj[key] !== null) {
        maskObject(obj[key], currentPath);
      } else if (typeof obj[key] === "string") {
        const lowerKey = key.toLowerCase();

        if (settings.maskVIN && lowerKey === "vin") {
          obj[key] = maskString(obj[key], settings.vinMaskLength);
        } else if (
          settings.maskOrderId &&
          (lowerKey === "referencenumber" || lowerKey === "orderid")
        ) {
          obj[key] = maskString(obj[key], settings.orderIdMaskLength);
        }
      }
    }
  }

  maskObject(masked);
  return masked;
}

// Share/Export functions
function generateMarkdownSummary(
  orders: DetailedOrder[],
  timeline: TimelineEvent[],
  settings: PrivacySettings
): string {
  const maskedOrders = applyPrivacyMask(orders, settings);

  let markdown = "# Tesla Online Order Status Summary\n\n";
  markdown += `Generated: ${new Date().toLocaleString()}\n\n`;

  // Orders section
  maskedOrders.forEach((detailedOrder: DetailedOrder, index: number) => {
    const { order, details } = detailedOrder;
    const orderInfo = details?.tasks?.registration?.orderDetails;
    const scheduling = details?.tasks?.scheduling;

    markdown += `## Order #${index + 1}\n\n`;
    markdown += `- **Order ID**: ${order.referenceNumber}\n`;
    markdown += `- **Model**: ${order.modelCode}\n`;
    markdown += `- **Status**: ${order.orderStatus}\n`;
    markdown += `- **VIN**: ${order.vin || "Not assigned"}\n`;

    if (orderInfo?.reservationDate) {
      markdown += `- **Reservation Date**: ${formatDate(
        orderInfo.reservationDate
      )}\n`;
    }
    if (orderInfo?.orderBookedDate) {
      markdown += `- **Order Booked**: ${formatDate(
        orderInfo.orderBookedDate
      )}\n`;
    }
    if (scheduling?.deliveryWindowDisplay) {
      markdown += `- **Delivery Window**: ${scheduling.deliveryWindowDisplay}\n`;
    }
    if (orderInfo?.routingLocationLabel) {
      markdown += `- **Location**: ${orderInfo.routingLocationLabel}\n`;
    }

    markdown += "\n";
  });

  // Timeline section
  if (timeline.length > 0) {
    markdown += "## Timeline\n\n";
    timeline.slice(-10).forEach((event) => {
      // Show last 10 events
      const date = new Date(event.timestamp).toLocaleDateString();
      const label = event.isNew ? `${event.label} (updated)` : event.label;
      markdown += `- **${date}**: ${label}\n`;
    });
    markdown += "\n";
  }

  markdown += "---\n";
  markdown +=
    "Generated by [Tesla Order Status Tracker](https://tesla-order-status.codext.de)\n";

  return markdown;
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
  const [authUrl, setAuthUrl] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [authCode, setAuthCode] = useState("");
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // New state for TOST features
  const [timeline, setTimeline] = useState<TimelineEvent[]>([]);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [showTimeline, setShowTimeline] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [showPrivacySettings, setShowPrivacySettings] = useState(false);
  const [showShareModal, setShowShareModal] = useState(false);
  const [privacySettings, setPrivacySettings] = useState<PrivacySettings>({
    maskVIN: true,
    maskOrderId: true,
    vinMaskLength: 10,
    orderIdMaskLength: 8,
  });

  const authWindowRef = useRef<Window | null>(null);
  const clipboardIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const mobileMenuRef = useRef<HTMLDivElement | null>(null);

  // Initialize from localStorage on mount
  useEffect(() => {
    const storedTokens = loadFromLocalStorage<TokenData>(STORAGE_KEYS.TOKENS);
    const storedPrivacySettings = loadFromLocalStorage<PrivacySettings>(
      STORAGE_KEYS.PRIVACY_SETTINGS
    );
    const storedHistory = getHistory();
    const storedOrders = loadFromLocalStorage<DetailedOrder[]>(
      STORAGE_KEYS.ORDERS
    );

    if (storedPrivacySettings) {
      setPrivacySettings(storedPrivacySettings);
    }

    if (storedHistory) {
      setHistory(storedHistory);
    }

    if (storedOrders && storedHistory) {
      const timelineEvents = buildTimeline(storedOrders, storedHistory);
      setTimeline(timelineEvents);
    }

    if (storedTokens) {
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

  // Cleanup clipboard monitoring
  useEffect(() => {
    return () => {
      if (clipboardIntervalRef.current) {
        clearInterval(clipboardIntervalRef.current);
      }
    };
  }, []);

  // Handle click outside mobile menu
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        mobileMenuRef.current &&
        !mobileMenuRef.current.contains(event.target as Node)
      ) {
        setMobileMenuOpen(false);
      }
    };

    if (mobileMenuOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      return () =>
        document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [mobileMenuOpen]);

  // Close mobile menu on resize to desktop
  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth >= 768) {
        setMobileMenuOpen(false);
      }
    };

    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  const checkAndRefreshToken = async (tokenData: TokenData) => {
    try {
      const response = await fetch("/api/auth/check-token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accessToken: tokenData.access_token }),
      });

      const result = await response.json();

      if (!result.valid && tokenData.refresh_token) {
        // Try to refresh the token
        const refreshResponse = await fetch("/api/auth/refresh", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
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
          // Automatically fetch orders after successful token refresh
          await fetchOrdersWithToken(updatedTokens);
        } else {
          handleLogout();
        }
      } else if (result.valid) {
        setTokens(tokenData);
        setIsAuthenticated(true);
        // Automatically fetch orders after successful token validation
        await fetchOrdersWithToken(tokenData);
      } else {
        handleLogout();
      }
    } catch (err) {
      console.error("Error checking token:", err);
      handleLogout();
    }
  };

  const handleStartAuth = async () => {
    setLoading(true);
    setError(null);
    setShowAuthModal(true);

    try {
      const response = await fetch("/api/auth/generate-url");
      const data = await response.json();

      setAuthUrl(data.authUrl);
      setSessionId(data.sessionId);
      saveToLocalStorage(STORAGE_KEYS.SESSION_ID, data.sessionId);

      // Open auth URL in popup window
      const width = 800;
      const height = 600;
      const left = window.screen.width / 2 - width / 2;
      const top = window.screen.height / 2 - height / 2;

      authWindowRef.current = window.open(
        data.authUrl,
        "TeslaAuth",
        `width=${width},height=${height},left=${left},top=${top},toolbar=no,menubar=no,location=yes,status=yes`
      );

      // Start monitoring clipboard for automatic detection
      startClipboardMonitoring();
    } catch (err) {
      setError("Failed to generate authentication URL");
      setShowAuthModal(false);
    } finally {
      setLoading(false);
    }
  };

  const startClipboardMonitoring = () => {
    // Only works with modern browsers that support clipboard API
    if (navigator.clipboard && navigator.clipboard.readText) {
      clipboardIntervalRef.current = setInterval(async () => {
        try {
          const text = await navigator.clipboard.readText();
          if (
            text.includes("auth.tesla.com/void/callback") &&
            text.includes("code=")
          ) {
            setAuthCode(text);
            if (clipboardIntervalRef.current) {
              clearInterval(clipboardIntervalRef.current);
            }
          }
        } catch (err) {
          // User hasn't granted clipboard permission, ignore
        }
      }, 1000);
    }
  };

  const handleAuthCodeSubmit = async () => {
    if (!authCode || !sessionId) {
      setError("Please enter the authorization URL");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      // Extract code from URL
      let code = authCode;
      if (authCode.includes("code=")) {
        const url = new URL(authCode);
        code = url.searchParams.get("code") || "";
      }

      if (!code) {
        throw new Error("No authorization code found in the URL");
      }

      const response = await fetch("/api/auth/exchange-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, sessionId }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(
          errorData.error || "Failed to exchange code for tokens"
        );
      }

      const tokenData = await response.json();
      const tokensWithTime = {
        ...tokenData,
        created_at: Date.now(),
      };

      setTokens(tokensWithTime);
      saveToLocalStorage(STORAGE_KEYS.TOKENS, tokensWithTime);
      setIsAuthenticated(true);
      setAuthCode("");
      setAuthUrl(null);
      setSessionId(null);
      setShowAuthModal(false);
      removeFromLocalStorage(STORAGE_KEYS.SESSION_ID);

      // Close auth window if still open
      if (authWindowRef.current && !authWindowRef.current.closed) {
        authWindowRef.current.close();
      }

      // Stop clipboard monitoring
      if (clipboardIntervalRef.current) {
        clearInterval(clipboardIntervalRef.current);
      }

      // Fetch orders immediately after authentication
      await fetchOrdersWithToken(tokensWithTime);
    } catch (err: any) {
      setError(err.message || "Failed to authenticate");
    } finally {
      setLoading(false);
    }
  };

  const fetchOrdersWithToken = async (tokenData: TokenData) => {
    setLoading(true);
    setError(null);

    try {
      const ordersResponse = await fetch("/api/orders", {
        headers: {
          Authorization: `Bearer ${tokenData.access_token}`,
        },
      });

      if (!ordersResponse.ok) {
        if (ordersResponse.status === 401) {
          handleLogout();
          throw new Error("Authentication expired. Please log in again.");
        }
        throw new Error("Failed to fetch orders");
      }

      const ordersData = await ordersResponse.json();

      // Fetch detailed info for each order
      const detailedOrders: DetailedOrder[] = [];
      for (const order of ordersData) {
        const detailsResponse = await fetch(
          `/api/orders/details?orderId=${order.referenceNumber}`,
          {
            headers: {
              Authorization: `Bearer ${tokenData.access_token}`,
            },
          }
        );

        if (detailsResponse.ok) {
          const details = await detailsResponse.json();

          // Get store label
          const routingLocation =
            details.tasks?.registration?.orderDetails?.vehicleRoutingLocation;
          if (routingLocation) {
            const storeResponse = await fetch(
              `/api/stores/label?storeId=${routingLocation}`
            );
            if (storeResponse.ok) {
              const storeData = await storeResponse.json();
              if (
                !details.tasks.registration.orderDetails.routingLocationLabel
              ) {
                details.tasks.registration.orderDetails.routingLocationLabel =
                  storeData.label;
              }
            }
          }

          detailedOrders.push({ order, details });
        } else {
          detailedOrders.push({ order, details: {} });
        }
      }

      // Compare with previous orders
      const prevOrders = loadFromLocalStorage<DetailedOrder[]>(
        STORAGE_KEYS.ORDERS
      );
      if (prevOrders) {
        const changes: ChangeOperation[] = [];
        for (
          let i = 0;
          i < Math.max(prevOrders.length, detailedOrders.length);
          i++
        ) {
          if (i < prevOrders.length && i < detailedOrders.length) {
            changes.push(
              ...compareDicts(prevOrders[i], detailedOrders[i], `Order ${i}.`)
            );
          } else if (i >= detailedOrders.length) {
            changes.push({
              key: `Order ${i}`,
              operation: "removed",
              oldValue: prevOrders[i],
            });
          } else {
            changes.push({
              key: `Order ${i}`,
              operation: "added",
              newValue: detailedOrders[i],
            });
          }
        }

        // Save history entry if there are changes
        if (changes.length > 0) {
          saveHistoryEntry(changes);
          const updatedHistory = getHistory();
          setHistory(updatedHistory);

          // Rebuild timeline with new history
          const timelineEvents = buildTimeline(detailedOrders, updatedHistory);
          setTimeline(timelineEvents);

          // Update differences for display
          const diffStrings = formatChangeOperations(changes);
          setDifferences(diffStrings);
          setShowComparison(true);
        }
      }

      setOrders(detailedOrders);
      saveToLocalStorage(STORAGE_KEYS.ORDERS, detailedOrders);
    } catch (err: any) {
      setError(err.message || "Failed to fetch orders");
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
    setShowAuthModal(false);
  };

  const handleClearData = () => {
    if (confirm("Are you sure you want to clear all stored data?")) {
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
      ordered: "bg-green-900/20 text-green-400 border-green-900",
      active: "bg-green-900/20 text-green-400 border-green-900",
      pending: "bg-yellow-900/20 text-yellow-400 border-yellow-900",
      delivered: "bg-blue-900/20 text-blue-400 border-blue-900",
    };

    return (
      <div
        key={order.referenceNumber}
        className="bg-gray-900/50 backdrop-blur border border-gray-800 rounded-xl p-6 hover:-translate-y-1 hover:shadow-2xl hover:shadow-red-900/20 hover:border-red-900/30 transition-all duration-300"
      >
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-lg font-semibold text-white">
            Order #{index + 1}
          </h3>
          <span
            className={`px-3 py-1 rounded-full text-xs font-semibold uppercase tracking-wider border ${
              statusColors[order.orderStatus?.toLowerCase()] ||
              "bg-gray-900/20 text-gray-400 border-gray-800"
            }`}
          >
            {order.orderStatus}
          </span>
        </div>

        <div className="space-y-6">
          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-3">
              Order Details
            </h4>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <span className="text-xs text-gray-500">Order ID</span>
                <p className="text-sm font-medium text-white">
                  {order.referenceNumber}
                </p>
              </div>
              <div className="space-y-1">
                <span className="text-xs text-gray-500">Model</span>
                <p className="text-sm font-medium text-white">
                  {order.modelCode}
                </p>
              </div>
              <div className="space-y-1">
                <span className="text-xs text-gray-500">VIN</span>
                <p className="text-sm font-medium text-white">
                  {order.vin || "Not assigned"}
                </p>
              </div>
              <div className="space-y-1">
                <span className="text-xs text-gray-500">Odometer</span>
                <p className="text-sm font-medium text-white">
                  {orderInfo.vehicleOdometer || "N/A"}{" "}
                  {orderInfo.vehicleOdometerType || ""}
                </p>
              </div>
            </div>
          </div>

          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-3">
              Dates
            </h4>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <span className="text-xs text-gray-500">Reservation</span>
                <p className="text-sm font-medium text-white">
                  {formatDate(orderInfo.reservationDate)}
                </p>
              </div>
              <div className="space-y-1">
                <span className="text-xs text-gray-500">Order Booked</span>
                <p className="text-sm font-medium text-white">
                  {formatDate(orderInfo.orderBookedDate)}
                </p>
              </div>
            </div>
          </div>

          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-3">
              Delivery Information
            </h4>
            <div className="space-y-3">
              <div className="space-y-1">
                <span className="text-xs text-gray-500">Routing Location</span>
                <p className="text-sm font-medium text-white">
                  {orderInfo.routingLocationLabel ||
                    orderInfo.vehicleRoutingLocation ||
                    "N/A"}
                </p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <span className="text-xs text-gray-500">Delivery Window</span>
                  <p className="text-sm font-medium text-white">
                    {scheduling.deliveryWindowDisplay || "Not scheduled"}
                  </p>
                </div>
                <div className="space-y-1">
                  <span className="text-xs text-gray-500">ETA to Center</span>
                  <p className="text-sm font-medium text-white">
                    {finalPaymentData.etaToDeliveryCenter || "N/A"}
                  </p>
                </div>
              </div>
              <div className="space-y-1">
                <span className="text-xs text-gray-500">Appointment</span>
                <p className="text-sm font-medium text-white">
                  {scheduling.apptDateTimeAddressStr || "Not scheduled"}
                </p>
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
            <h1 className="text-base sm:text-lg md:text-xl font-bold bg-gradient-to-r from-white to-gray-400 bg-clip-text text-transparent">
              Tesla Order Tracker
            </h1>
            {isAuthenticated && (
              <>
                {/* Desktop Menu */}
                <div className="hidden md:flex gap-3">
                  <button
                    onClick={fetchOrders}
                    disabled={loading}
                    className="px-4 py-2 bg-gradient-to-r from-red-600 to-red-700 hover:from-red-700 hover:to-red-800 text-white rounded-lg font-medium transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg hover:shadow-red-900/50 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {loading ? "Refreshing..." : "Refresh Orders"}
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

                {/* Mobile Menu Button */}
                <button
                  onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                  className="md:hidden p-2 rounded-lg bg-gray-800 hover:bg-gray-700 transition-colors"
                  aria-label="Toggle menu"
                >
                  <svg
                    className="w-6 h-6 text-white"
                    fill="none"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    {mobileMenuOpen ? (
                      <path d="M6 18L18 6M6 6l12 12" />
                    ) : (
                      <path d="M4 6h16M4 12h16M4 18h16" />
                    )}
                  </svg>
                </button>
              </>
            )}
          </div>

          {/* Mobile Dropdown Menu */}
          {isAuthenticated && mobileMenuOpen && (
            <div
              ref={mobileMenuRef}
              className="md:hidden py-4 border-t border-gray-800 animate-in slide-in-from-top-2 duration-200"
            >
              <div className="space-y-2">
                <button
                  onClick={() => {
                    fetchOrders();
                    setMobileMenuOpen(false);
                  }}
                  disabled={loading}
                  className="w-full px-4 py-3 bg-gradient-to-r from-red-600 to-red-700 hover:from-red-700 hover:to-red-800 text-white rounded-lg font-medium transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed text-left"
                >
                  {loading ? (
                    <span className="flex items-center gap-2">
                      <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                        <circle
                          className="opacity-25"
                          cx="12"
                          cy="12"
                          r="10"
                          stroke="currentColor"
                          strokeWidth="4"
                          fill="none"
                        />
                        <path
                          className="opacity-75"
                          fill="currentColor"
                          d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                        />
                      </svg>
                      Refreshing...
                    </span>
                  ) : (
                    <span className="flex items-center gap-2">
                      <svg
                        className="w-5 h-5"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth="2"
                          d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                        />
                      </svg>
                      Refresh Orders
                    </span>
                  )}
                </button>
                <button
                  onClick={() => {
                    handleLogout();
                    setMobileMenuOpen(false);
                  }}
                  className="w-full px-4 py-3 bg-gray-800 hover:bg-gray-700 text-white rounded-lg font-medium transition-all duration-200 border border-gray-700 hover:border-gray-600 text-left"
                >
                  <span className="flex items-center gap-2">
                    <svg
                      className="w-5 h-5"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth="2"
                        d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"
                      />
                    </svg>
                    Logout
                  </span>
                </button>
                <button
                  onClick={() => {
                    handleClearData();
                    setMobileMenuOpen(false);
                  }}
                  className="w-full px-4 py-3 bg-red-900/20 hover:bg-red-900/30 text-red-400 rounded-lg font-medium transition-all duration-200 border border-red-900/50 hover:border-red-900 text-left"
                >
                  <span className="flex items-center gap-2">
                    <svg
                      className="w-5 h-5"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth="2"
                        d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                      />
                    </svg>
                    Clear Data
                  </span>
                </button>
              </div>
            </div>
          )}
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
                Connect your Tesla account to track your order status in
                real-time.
              </p>
              <button
                onClick={handleStartAuth}
                disabled={loading}
                className="w-full px-6 py-3 bg-gradient-to-r from-red-600 to-red-700 hover:from-red-700 hover:to-red-800 text-white rounded-lg font-semibold transition-all duration-200 hover:-translate-y-0.5 hover:shadow-xl hover:shadow-red-900/50 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? "Starting..." : "Start Authentication"}
              </button>
              <div className="mt-4 space-y-2">
                <p className="text-xs text-gray-500">
                  A popup window will open for Tesla login.
                </p>
                <p className="text-xs text-amber-400">
                  iPhone users: Disable Safari&apos;s pop-up blocker (Settings →
                  Safari → enable Allow Pop-ups) so the login window can open.
                </p>
              </div>
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
              <h3 className="text-lg font-semibold text-white mb-4">
                Settings
              </h3>
              <div className="space-y-4">
                <label className="flex items-center gap-3 cursor-pointer group">
                  <input
                    type="checkbox"
                    checked={autoRefresh}
                    onChange={(e) => setAutoRefresh(e.target.checked)}
                    className="w-5 h-5 rounded border-gray-700 bg-gray-800 text-red-600 focus:ring-red-900 focus:ring-offset-0"
                  />
                  <span className="text-gray-300 group-hover:text-white transition-colors">
                    Auto-refresh orders
                  </span>
                </label>
                {autoRefresh && (
                  <div className="ml-8 flex items-center gap-3">
                    <label className="text-gray-400">Refresh every:</label>
                    <select
                      value={refreshInterval}
                      onChange={(e) =>
                        setRefreshInterval(parseInt(e.target.value))
                      }
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

                {/* New TOST feature toggles */}
                <div className="border-t border-gray-700 pt-4 mt-4">
                  <h4 className="text-sm font-semibold text-gray-400 mb-3">
                    Features
                  </h4>
                  <div className="space-y-3">
                    <label className="flex items-center gap-3 cursor-pointer group">
                      <input
                        type="checkbox"
                        checked={showTimeline}
                        onChange={(e) => setShowTimeline(e.target.checked)}
                        className="w-5 h-5 rounded border-gray-700 bg-gray-800 text-red-600 focus:ring-red-900 focus:ring-offset-0"
                      />
                      <span className="text-gray-300 group-hover:text-white transition-colors">
                        Show Timeline ({timeline.length} events)
                      </span>
                    </label>
                    <label className="flex items-center gap-3 cursor-pointer group">
                      <input
                        type="checkbox"
                        checked={showHistory}
                        onChange={(e) => setShowHistory(e.target.checked)}
                        className="w-5 h-5 rounded border-gray-700 bg-gray-800 text-red-600 focus:ring-red-900 focus:ring-offset-0"
                      />
                      <span className="text-gray-300 group-hover:text-white transition-colors">
                        Show Change History ({history.length} snapshots)
                      </span>
                    </label>
                    <div className="flex gap-2">
                      <button
                        onClick={() =>
                          setShowPrivacySettings(!showPrivacySettings)
                        }
                        className="flex-1 px-4 py-2 bg-gray-800 hover:bg-gray-700 text-white rounded-lg font-medium transition-all duration-200 border border-gray-700 hover:border-gray-600"
                      >
                        Privacy Settings
                      </button>
                      <button
                        onClick={() => setShowShareModal(true)}
                        className="flex-1 px-4 py-2 bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 text-white rounded-lg font-medium transition-all duration-200"
                      >
                        Share
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Timeline */}
            {showTimeline && timeline.length > 0 && (
              <div className="bg-gray-900/50 backdrop-blur border border-gray-800 rounded-xl p-6 mb-6">
                <h3 className="text-lg font-semibold text-blue-400 mb-4">
                  Timeline
                </h3>
                <div className="space-y-4">
                  {timeline.map((event, index) => (
                    <div
                      key={index}
                      className="flex items-start gap-4 border-l-2 border-blue-600 pl-4"
                    >
                      <div className="flex-shrink-0 w-24 text-sm text-gray-500">
                        {new Date(event.timestamp).toLocaleDateString()}
                      </div>
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-white">
                            {event.label}
                            {event.isNew && (
                              <span className="ml-2 text-xs px-2 py-0.5 bg-yellow-900/20 text-yellow-400 border border-yellow-900 rounded">
                                updated
                              </span>
                            )}
                          </span>
                        </div>
                        <div className="text-sm text-gray-400 mt-1">
                          {typeof event.value === "string"
                            ? event.value
                            : JSON.stringify(event.value)}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* History */}
            {showHistory && history.length > 0 && (
              <div className="bg-gray-900/50 backdrop-blur border border-gray-800 rounded-xl p-6 mb-6">
                <h3 className="text-lg font-semibold text-purple-400 mb-4">
                  Change History
                </h3>
                <div className="space-y-4 max-h-96 overflow-y-auto">
                  {history
                    .slice()
                    .reverse()
                    .map((entry, index) => (
                      <div
                        key={index}
                        className="border-b border-gray-800 pb-4 last:border-0"
                      >
                        <div className="text-sm text-gray-500 mb-2">
                          {new Date(entry.timestamp).toLocaleString()}
                        </div>
                        <div className="font-mono text-sm space-y-1">
                          {entry.changes.map((change, changeIndex) => (
                            <div
                              key={changeIndex}
                              className={`${
                                change.operation === "added"
                                  ? "text-green-400"
                                  : change.operation === "removed"
                                  ? "text-red-400"
                                  : "text-yellow-400"
                              }`}
                            >
                              {change.operation === "added" &&
                                `+ ${change.key}: ${JSON.stringify(
                                  change.newValue
                                )}`}
                              {change.operation === "removed" &&
                                `- ${change.key}`}
                              {change.operation === "changed" &&
                                `≠ ${change.key}: ${JSON.stringify(
                                  change.oldValue
                                )} → ${JSON.stringify(change.newValue)}`}
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                </div>
              </div>
            )}

            {/* Privacy Settings Panel */}
            {showPrivacySettings && (
              <div className="bg-gray-900/50 backdrop-blur border border-gray-800 rounded-xl p-6 mb-6">
                <h3 className="text-lg font-semibold text-green-400 mb-4">
                  Privacy Settings
                </h3>
                <div className="space-y-4">
                  <label className="flex items-center gap-3 cursor-pointer group">
                    <input
                      type="checkbox"
                      checked={privacySettings.maskVIN}
                      onChange={(e) => {
                        const newSettings = {
                          ...privacySettings,
                          maskVIN: e.target.checked,
                        };
                        setPrivacySettings(newSettings);
                        saveToLocalStorage(
                          STORAGE_KEYS.PRIVACY_SETTINGS,
                          newSettings
                        );
                      }}
                      className="w-5 h-5 rounded border-gray-700 bg-gray-800 text-red-600 focus:ring-red-900 focus:ring-offset-0"
                    />
                    <span className="text-gray-300 group-hover:text-white transition-colors">
                      Mask VIN
                    </span>
                  </label>
                  {privacySettings.maskVIN && (
                    <div className="ml-8 flex items-center gap-3">
                      <label className="text-gray-400">Mask length:</label>
                      <input
                        type="number"
                        min="0"
                        max="17"
                        value={privacySettings.vinMaskLength}
                        onChange={(e) => {
                          const newSettings = {
                            ...privacySettings,
                            vinMaskLength: parseInt(e.target.value) || 0,
                          };
                          setPrivacySettings(newSettings);
                          saveToLocalStorage(
                            STORAGE_KEYS.PRIVACY_SETTINGS,
                            newSettings
                          );
                        }}
                        className="w-20 px-3 py-1.5 bg-gray-800 border border-gray-700 rounded-lg text-white focus:border-red-900 focus:outline-none focus:ring-1 focus:ring-red-900"
                      />
                      <span className="text-gray-500 text-sm">characters</span>
                    </div>
                  )}
                  <label className="flex items-center gap-3 cursor-pointer group">
                    <input
                      type="checkbox"
                      checked={privacySettings.maskOrderId}
                      onChange={(e) => {
                        const newSettings = {
                          ...privacySettings,
                          maskOrderId: e.target.checked,
                        };
                        setPrivacySettings(newSettings);
                        saveToLocalStorage(
                          STORAGE_KEYS.PRIVACY_SETTINGS,
                          newSettings
                        );
                      }}
                      className="w-5 h-5 rounded border-gray-700 bg-gray-800 text-red-600 focus:ring-red-900 focus:ring-offset-0"
                    />
                    <span className="text-gray-300 group-hover:text-white transition-colors">
                      Mask Order ID
                    </span>
                  </label>
                  {privacySettings.maskOrderId && (
                    <div className="ml-8 flex items-center gap-3">
                      <label className="text-gray-400">Mask length:</label>
                      <input
                        type="number"
                        min="0"
                        max="20"
                        value={privacySettings.orderIdMaskLength}
                        onChange={(e) => {
                          const newSettings = {
                            ...privacySettings,
                            orderIdMaskLength: parseInt(e.target.value) || 0,
                          };
                          setPrivacySettings(newSettings);
                          saveToLocalStorage(
                            STORAGE_KEYS.PRIVACY_SETTINGS,
                            newSettings
                          );
                        }}
                        className="w-20 px-3 py-1.5 bg-gray-800 border border-gray-700 rounded-lg text-white focus:border-red-900 focus:outline-none focus:ring-1 focus:ring-red-900"
                      />
                      <span className="text-gray-500 text-sm">characters</span>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Error Message */}
            {error && (
              <div className="mb-6 p-4 bg-red-900/20 border border-red-900/50 rounded-lg text-red-400">
                {error}
              </div>
            )}

            {/* Comparison */}
            {showComparison && differences.length > 0 && (
              <div className="bg-gray-900/50 backdrop-blur border border-gray-800 rounded-xl p-6 mb-6">
                <h3 className="text-lg font-semibold text-yellow-400 mb-4">
                  Changes Detected
                </h3>
                <div className="bg-black/50 rounded-lg p-4 max-h-96 overflow-y-auto">
                  <div className="font-mono text-sm space-y-1">
                    {differences.map((diff, index) => (
                      <div
                        key={index}
                        className={`${
                          diff.startsWith("+")
                            ? "text-green-400"
                            : diff.startsWith("-")
                            ? "text-red-400"
                            : "text-gray-400"
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
                  <p>
                    No orders found. Click "Refresh Orders" to check for
                    updates.
                  </p>
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

      {/* Auth Modal */}
      {showAuthModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-8 max-w-lg w-full">
            <h3 className="text-2xl font-bold text-white mb-4">
              Complete Authentication
            </h3>

            <div className="space-y-4">
              <div className="bg-blue-900/20 border border-blue-900/50 rounded-lg p-4">
                <p className="text-blue-400 text-sm">
                  <strong>Step 1:</strong> Log in with your Tesla account in the
                  popup window
                </p>
                <p className="text-blue-400 text-sm mt-2">
                  <strong>Step 2:</strong> After login, you'll see a "Page Not
                  Found" error - this is normal!
                </p>
                <p className="text-blue-400 text-sm mt-2">
                  <strong>Step 3:</strong> Copy the entire URL from that page
                  and paste it below
                </p>
              </div>

              <div className="space-y-2">
                <label className="text-gray-400 text-sm">
                  Paste the redirect URL here:
                </label>
                <textarea
                  value={authCode}
                  onChange={(e) => setAuthCode(e.target.value)}
                  placeholder="https://auth.tesla.com/void/callback?code=..."
                  className="w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:border-red-900 focus:outline-none focus:ring-1 focus:ring-red-900 resize-none"
                  rows={3}
                />
              </div>

              {error && (
                <div className="p-3 bg-red-900/20 border border-red-900/50 rounded-lg text-red-400 text-sm">
                  {error}
                </div>
              )}

              <div className="flex gap-3">
                <button
                  onClick={handleAuthCodeSubmit}
                  disabled={loading || !authCode}
                  className="flex-1 px-4 py-2 bg-gradient-to-r from-red-600 to-red-700 hover:from-red-700 hover:to-red-800 text-white rounded-lg font-medium transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {loading ? "Authenticating..." : "Complete Authentication"}
                </button>
                <button
                  onClick={() => {
                    setShowAuthModal(false);
                    setAuthCode("");
                    setError(null);
                    if (
                      authWindowRef.current &&
                      !authWindowRef.current.closed
                    ) {
                      authWindowRef.current.close();
                    }
                    if (clipboardIntervalRef.current) {
                      clearInterval(clipboardIntervalRef.current);
                    }
                  }}
                  className="px-4 py-2 bg-gray-800 hover:bg-gray-700 text-white rounded-lg font-medium transition-all duration-200 border border-gray-700"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Share Modal */}
      {showShareModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-8 max-w-2xl w-full max-h-[80vh] overflow-y-auto">
            <h3 className="text-2xl font-bold text-white mb-4">
              Share Order Status
            </h3>

            <div className="space-y-4">
              <div className="bg-blue-900/20 border border-blue-900/50 rounded-lg p-4">
                <p className="text-blue-400 text-sm">
                  Generate a shareable summary of your order status. Sensitive
                  information will be masked according to your privacy settings.
                </p>
              </div>

              {/* Preview */}
              <div className="space-y-2">
                <label className="text-gray-400 text-sm font-semibold">
                  Preview:
                </label>
                <div className="bg-black/50 rounded-lg p-4 max-h-96 overflow-y-auto">
                  <pre className="text-sm text-gray-300 whitespace-pre-wrap font-mono">
                    {generateMarkdownSummary(orders, timeline, privacySettings)}
                  </pre>
                </div>
              </div>

              <div className="flex gap-3">
                <button
                  onClick={async () => {
                    const markdown = generateMarkdownSummary(
                      orders,
                      timeline,
                      privacySettings
                    );
                    try {
                      await navigator.clipboard.writeText(markdown);
                      alert("Summary copied to clipboard!");
                    } catch (err) {
                      console.error("Failed to copy:", err);
                      alert(
                        "Failed to copy to clipboard. Please copy manually from the preview above."
                      );
                    }
                  }}
                  className="flex-1 px-4 py-2 bg-gradient-to-r from-green-600 to-green-700 hover:from-green-700 hover:to-green-800 text-white rounded-lg font-medium transition-all duration-200"
                >
                  Copy to Clipboard
                </button>
                <button
                  onClick={() => setShowShareModal(false)}
                  className="px-4 py-2 bg-gray-800 hover:bg-gray-700 text-white rounded-lg font-medium transition-all duration-200 border border-gray-700"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Footer */}
      <footer className="mt-auto border-t border-gray-800 bg-gray-900/50 backdrop-blur">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 text-center">
          <p className="text-gray-400">Tesla Order Status Tracker</p>
          <p className="text-xs text-gray-600 mt-2">
            Your authentication tokens and order data are stored locally in your
            browser
          </p>
        </div>
      </footer>
    </div>
  );
}

// Mount the app
const root = createRoot(document.getElementById("root")!);
root.render(<App />);
