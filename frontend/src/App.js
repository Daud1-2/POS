import React from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import Cashier from './pages/Cashier';

function App() {
  return (
    <Router>
      <div className="App">
        <Routes>
          <Route path="/" element={<div>Home Page</div>} />
          <Route path="/login" element={<div>Login Page</div>} />
          <Route path="/dashboard" element={<div>Dashboard</div>} />
          <Route path="/products" element={<div>Products</div>} />
          <Route path="/sales" element={<div>Sales</div>} />
          <Route path="/cashier" element={<Cashier />} />
        </Routes>
      </div>
    </Router>
  );
}

export default App;
