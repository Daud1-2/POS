import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import App from './App';
import { account, client } from './services/appwrite';

jest.mock('./services/appwrite', () => ({
  account: { deleteSession: jest.fn(() => Promise.resolve()) },
  client: { ping: jest.fn() },
}));

jest.mock('./pages/Login', () => () => <div>Login Page</div>);
jest.mock('./pages/Dashboard', () => () => <div>Dashboard Page</div>);
jest.mock('./pages/Orders', () => () => <div>Orders Page</div>);
jest.mock('./pages/Products', () => () => <div>Products Page</div>);
jest.mock('./pages/Discounts', () => () => <div>Discounts Page</div>);
jest.mock('./pages/Customers', () => () => <div>Customers Page</div>);
jest.mock('./pages/Reporting', () => () => <div>Reporting Page</div>);
jest.mock('./pages/Settings', () => () => <div>Settings Page</div>);
jest.mock('./pages/Cashier', () => () => <div>Cashier Page</div>);
jest.mock('./layouts/AdminLayout', () => {
  const { Outlet } = require('react-router-dom');

  return function MockAdminLayout() {
    return (
      <div>
        <div>Admin Layout</div>
        <Outlet />
      </div>
    );
  };
});

describe('App routing and auth gate', () => {
  beforeEach(() => {
    sessionStorage.clear();
    jest.clearAllMocks();
    account.deleteSession.mockResolvedValue(null);
    client.ping.mockImplementation(() => {});
  });

  test('renders login route and triggers appwrite ping', async () => {
    window.history.pushState({}, '', '/login');
    render(<App />);

    expect(screen.getByText('Login Page')).toBeInTheDocument();
    expect(client.ping).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(account.deleteSession).toHaveBeenCalledWith('current'));
  });

  test('redirects protected routes to login without web session', () => {
    window.history.pushState({}, '', '/dashboard');
    render(<App />);

    expect(screen.getByText('Login Page')).toBeInTheDocument();
    expect(screen.queryByText('Dashboard Page')).not.toBeInTheDocument();
  });

  test('allows protected routes with active web session', () => {
    sessionStorage.setItem('posWebAuthActive', '1');
    window.history.pushState({}, '', '/dashboard');
    render(<App />);

    expect(screen.getByText('Dashboard Page')).toBeInTheDocument();
    expect(account.deleteSession).not.toHaveBeenCalled();
  });
});
