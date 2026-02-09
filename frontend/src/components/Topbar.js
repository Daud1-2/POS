import React from 'react';
import Logo from './Logo';

function Topbar() {
  return (
    <header className="sticky top-0 z-20 bg-white border-b border-slate-200">
      <div className="flex items-center gap-4 px-6 py-4">
        <div className="flex items-center gap-2 text-xs text-slate-600 bg-slate-100 px-3 py-1.5 rounded-full">
          UTC +05:00 · Asia/Karachi
        </div>

        <div className="flex-1 flex items-center justify-center">
          <div className="w-full max-w-md">
            <input
              type="text"
              placeholder="Select Branch"
              className="w-full border border-slate-200 rounded-xl px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brandYellow"
            />
          </div>
        </div>

        <div className="hidden md:flex items-center gap-3">
          <input
            type="text"
            placeholder="Search"
            className="border border-slate-200 rounded-xl px-4 py-2 text-sm w-48 focus:outline-none focus:ring-2 focus:ring-brandYellow"
          />
          <div className="flex items-center gap-2 bg-slate-100 rounded-full px-3 py-1.5 text-sm text-slate-600">
            Admin
          </div>
          <Logo size={28} showText={false} />
        </div>
      </div>
    </header>
  );
}

export default Topbar;
