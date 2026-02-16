import React from 'react';
import { Outlet } from 'react-router-dom';
import Sidebar from '../components/Sidebar';
import Topbar from '../components/Topbar';

function AdminLayout() {
  return (
    <div className="h-screen overflow-hidden bg-surface text-ink flex">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0 lg:ml-64 h-screen overflow-y-auto">
        <Topbar />
        <main className="flex-1 px-6 py-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

export default AdminLayout;
