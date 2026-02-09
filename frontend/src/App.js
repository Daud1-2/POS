import React, { useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import Cashier from './pages/Cashier';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Orders from './pages/Orders';
import Products from './pages/Products';
import Discounts from './pages/Discounts';
import Customers from './pages/Customers';
import SmsCampaigns from './pages/SmsCampaigns';
import Reporting from './pages/Reporting';
import Settings from './pages/Settings';
import AdminLayout from './layouts/AdminLayout';
import { client } from './services/appwrite';

function App() {
  useEffect(() => {
    client.ping();
  }, []);

  return (
    <Router>
      <div className="App">
        <Routes>
          <Route path="/" element={<Login />} />
          <Route path="/login" element={<Login />} />
          <Route element={<AdminLayout />}>
            <Route path="/home" element={<Dashboard />} />
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/orders" element={<Orders />} />
            <Route path="/products" element={<Products />} />
            <Route path="/discounts" element={<Discounts />} />
            <Route path="/customers" element={<Customers />} />
            <Route path="/sms" element={<SmsCampaigns />} />
            <Route path="/reporting" element={<Reporting />} />
            <Route path="/settings" element={<Settings />} />
          </Route>
          <Route path="/cashier" element={<Cashier />} />
        </Routes>
      </div>
    </Router>
  );
}

export default App;
