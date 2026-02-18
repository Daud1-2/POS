import React, { useEffect, useRef, useState } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import Cashier from './pages/Cashier';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Orders from './pages/Orders';
import Products from './pages/Products';
import Discounts from './pages/Discounts';
import Customers from './pages/Customers';
import Reporting from './pages/Reporting';
import Settings from './pages/Settings';
import AdminLayout from './layouts/AdminLayout';
import { account, client } from './services/appwrite';

const WEB_AUTH_SESSION_KEY = 'posWebAuthActive';

const hasWebSessionAuth = () =>
  typeof window !== 'undefined' && sessionStorage.getItem(WEB_AUTH_SESSION_KEY) === '1';

function RequireWebSession({ children }) {
  if (!hasWebSessionAuth()) {
    return <Navigate to="/login" replace />;
  }
  return children;
}

function App() {
  const [showOfflineNotice, setShowOfflineNotice] = useState(false);
  const offlineTimerRef = useRef(null);

  useEffect(() => {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      return;
    }
    Promise.resolve(client.ping()).catch(() => {});
  }, []);

  useEffect(() => {
    if (!hasWebSessionAuth()) {
      account.deleteSession('current').catch(() => {});
    }
  }, []);

  useEffect(() => {
    const clearOfflineTimer = () => {
      if (offlineTimerRef.current) {
        clearTimeout(offlineTimerRef.current);
        offlineTimerRef.current = null;
      }
    };

    const handleOffline = () => {
      clearOfflineTimer();
      setShowOfflineNotice(true);
      offlineTimerRef.current = setTimeout(() => {
        setShowOfflineNotice(false);
        offlineTimerRef.current = null;
      }, 30000);
    };

    const handleOnline = () => {
      clearOfflineTimer();
      setShowOfflineNotice(false);
    };

    window.addEventListener('offline', handleOffline);
    window.addEventListener('online', handleOnline);

    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      handleOffline();
    }

    return () => {
      clearOfflineTimer();
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('online', handleOnline);
    };
  }, []);

  return (
    <Router>
      <div className="App">
        {showOfflineNotice && (
          <div className="fixed top-4 left-1/2 z-[100] -translate-x-1/2 rounded-lg border border-amber-300 bg-amber-100 px-4 py-2 text-sm font-medium text-amber-900 shadow-lg">
            Connect to internet to see real-time data across the website.
          </div>
        )}
        <Routes>
          <Route path="/" element={<Login />} />
          <Route path="/login" element={<Login />} />
          <Route
            element={(
              <RequireWebSession>
                <AdminLayout />
              </RequireWebSession>
            )}
          >
            <Route path="/home" element={<Dashboard />} />
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/orders" element={<Orders />} />
            <Route path="/products" element={<Products />} />
            <Route path="/discounts" element={<Discounts />} />
            <Route path="/customers" element={<Customers />} />
            <Route path="/reporting" element={<Reporting />} />
            <Route path="/settings" element={<Settings />} />
          </Route>
          <Route
            path="/cashier"
            element={(
              <RequireWebSession>
                <Cashier />
              </RequireWebSession>
            )}
          />
        </Routes>
      </div>
    </Router>
  );
}

export default App;
