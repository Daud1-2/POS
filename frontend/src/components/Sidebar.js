import React from 'react';
import { NavLink } from 'react-router-dom';
import Logo from './Logo';

const navItems = [
  { label: 'Dashboard', path: '/home', icon: 'home' },
  { label: 'Orders', path: '/orders', icon: 'orders' },
  { label: 'Products Catalogue', path: '/products', icon: 'products' },
  { label: 'Discounts', path: '/discounts', icon: 'discounts' },
  { label: 'Customers', path: '/customers', icon: 'customers' },
  { label: 'SMS Campaigns', path: '/sms', icon: 'sms' },
  { label: 'Reporting', path: '/reporting', icon: 'reporting' },
  { label: 'Settings', path: '/settings', icon: 'settings' },
];

const iconMap = {
  home: (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M3 10.5L12 3l9 7.5" />
      <path d="M5 9.5V21h14V9.5" />
    </svg>
  ),
  orders: (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="4" y="4" width="16" height="16" rx="3" />
      <path d="M8 9h8M8 13h8M8 17h5" />
    </svg>
  ),
  products: (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M4 7h16M4 12h16M4 17h16" />
    </svg>
  ),
  discounts: (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M6 18L18 6" />
      <circle cx="7.5" cy="7.5" r="2.5" />
      <circle cx="16.5" cy="16.5" r="2.5" />
    </svg>
  ),
  customers: (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="8" r="3.5" />
      <path d="M4 20c1.5-3 4.5-5 8-5s6.5 2 8 5" />
    </svg>
  ),
  sms: (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M4 6h16v9H7l-3 3V6z" />
    </svg>
  ),
  reporting: (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M4 19h16" />
      <path d="M7 16V8M12 16v-4M17 16v-7" />
    </svg>
  ),
  settings: (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a7.7 7.7 0 000-6M4.6 9a7.7 7.7 0 000 6" />
      <path d="M14.5 4.5l-1 2M10.5 17.5l-1 2M4.5 14.5l2-1M17.5 10.5l2-1" />
    </svg>
  ),
};

function Sidebar() {
  return (
    <aside className="hidden lg:flex lg:flex-col lg:w-64 lg:shrink-0 bg-white border-r border-slate-200">
      <div className="px-6 py-6">
        <Logo size={36} />
      </div>
      <nav className="flex-1 px-3 pb-6 space-y-1">
        {navItems.map((item) => (
          <NavLink
            key={item.path}
            to={item.path}
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2 rounded-xl text-sm font-medium transition ${
                isActive
                  ? 'bg-brandYellow text-ink shadow-soft'
                  : 'text-slate-600 hover:bg-slate-100'
              }`
            }
          >
            <span className="text-inherit">{iconMap[item.icon]}</span>
            <span>{item.label}</span>
          </NavLink>
        ))}
      </nav>
      <div className="px-6 pb-6 text-xs text-slate-400">Orderly POS Admin</div>
    </aside>
  );
}

export default Sidebar;
