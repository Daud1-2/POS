import React, { useEffect, useMemo, useState } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import Logo from './Logo';

const navItems = [
  { label: 'Dashboard', path: '/home', icon: 'home' },
  {
    label: 'Orders',
    path: '/orders',
    icon: 'orders',
    defaultTab: 'live',
    children: [
      { label: 'Live Orders', path: '/orders?tab=live', tab: 'live' },
      { label: 'Pre Orders', path: '/orders?tab=pre', tab: 'pre' },
      { label: 'Call-in/Phone Orders', path: '/orders?tab=phone', tab: 'phone' },
      { label: 'Order Reviews', path: '/orders?tab=reviews', tab: 'reviews' },
    ],
  },
  {
    label: 'Products Catalogue',
    path: '/products',
    icon: 'products',
    defaultTab: 'items',
    children: [
      { label: 'Sections Management', path: '/products?tab=sections', tab: 'sections' },
      { label: 'Items Management', path: '/products?tab=items', tab: 'items' },
      { label: 'Image Gallery', path: '/products?tab=images', tab: 'images' },
      { label: 'Branch-Wise Toggle', path: '/products?tab=outlets', tab: 'outlets' },
    ],
  },
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

const getInitialPinnedState = (location) => ({
  '/orders': location.pathname === '/orders',
  '/products': location.pathname === '/products',
});

function Sidebar() {
  const location = useLocation();
  const navigate = useNavigate();
  const [menuPinnedOpen, setMenuPinnedOpen] = useState(() => getInitialPinnedState(location));
  const [menuHoverOpen, setMenuHoverOpen] = useState({});

  const activeTab = useMemo(() => {
    const tab = new URLSearchParams(location.search).get('tab');
    return tab || null;
  }, [location.search]);

  useEffect(() => {
    setMenuPinnedOpen((prev) => ({
      ...prev,
      '/orders': location.pathname === '/orders' ? prev['/orders'] : false,
      '/products': location.pathname === '/products' ? prev['/products'] : false,
    }));
  }, [location.pathname]);

  const toggleMenu = (item) => {
    if (location.pathname !== item.path) {
      setMenuPinnedOpen((prev) => ({ ...prev, [item.path]: true }));
      navigate(`${item.path}?tab=${item.defaultTab}`);
      return;
    }
    const currentlyPinned = Boolean(menuPinnedOpen[item.path]);
    if (currentlyPinned) {
      setMenuPinnedOpen((prev) => ({ ...prev, [item.path]: false }));
      setMenuHoverOpen((prev) => ({ ...prev, [item.path]: false }));
      return;
    }
    setMenuPinnedOpen((prev) => ({ ...prev, [item.path]: true }));
  };

  const isRouteActive = (item) => location.pathname === item.path;
  const isMenuOpen = (item) => Boolean(menuPinnedOpen[item.path] || menuHoverOpen[item.path]);

  return (
    <aside className="hidden lg:flex lg:flex-col lg:w-64 lg:shrink-0 bg-white border-r border-slate-200">
      <div className="px-6 py-6">
        <Logo size={36} />
      </div>
      <nav className="flex-1 px-3 pb-6 space-y-1">
        {navItems.map((item) => {
          if (!item.children) {
            return (
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
            );
          }

          const open = isMenuOpen(item);
          const routeActive = isRouteActive(item);

          return (
            <div
              key={item.path}
              className="space-y-1"
              onMouseEnter={() => setMenuHoverOpen((prev) => ({ ...prev, [item.path]: true }))}
              onMouseLeave={() => setMenuHoverOpen((prev) => ({ ...prev, [item.path]: false }))}
            >
              <button
                type="button"
                onClick={() => toggleMenu(item)}
                aria-expanded={open}
                className={`w-full flex items-center gap-3 px-3 py-2 rounded-xl text-sm font-medium transition ${
                  routeActive
                    ? 'bg-brandYellow text-ink shadow-soft'
                    : 'text-slate-600 hover:bg-slate-100'
                }`}
              >
                <span className="text-inherit">{iconMap[item.icon]}</span>
                <span className="flex-1 text-left">{item.label}</span>
                <svg
                  viewBox="0 0 20 20"
                  fill="currentColor"
                  className={`h-4 w-4 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
                >
                  <path
                    fillRule="evenodd"
                    d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.94a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z"
                    clipRule="evenodd"
                  />
                </svg>
              </button>

              <div
                className={`ml-10 overflow-hidden transition-all duration-200 ease-out ${
                  open ? 'max-h-72 opacity-100' : 'max-h-0 opacity-0'
                }`}
              >
                <div className="flex flex-col gap-1 py-1">
                  {item.children.map((child) => {
                    const activeTabKey = activeTab || item.defaultTab;
                    const childActive = routeActive && activeTabKey === child.tab;
                    return (
                      <NavLink
                        key={child.path}
                        to={child.path}
                        onClick={() =>
                          setMenuPinnedOpen((prev) => ({
                            ...prev,
                            [item.path]: true,
                          }))
                        }
                        className={`flex items-center gap-2 text-xs px-2 py-1.5 rounded-md transition ${
                          childActive
                            ? 'bg-brandYellow/30 text-ink font-medium'
                            : 'text-slate-600 hover:bg-brandYellow/20 hover:text-ink'
                        }`}
                      >
                        <span className="inline-block w-1.5 h-1.5 rounded-full border border-slate-400" />
                        <span>{child.label}</span>
                      </NavLink>
                    );
                  })}
                </div>
              </div>
            </div>
          );
        })}
      </nav>
      <div className="px-6 pb-6 text-xs text-slate-400">Orderly POS Admin</div>
    </aside>
  );
}

export default Sidebar;
