import React from 'react';
import coverBg from '../assets/pos_bg/cover_bg.png';

const stats = [
  { label: 'Total Orders', value: '0', caption: 'Today' },
  { label: 'Total Sales', value: 'PKR 0', caption: 'Today' },
  { label: 'Total Orders', value: '17', caption: 'Last 30 Days' },
  { label: 'Total Sales', value: 'PKR 9,133', caption: 'Last 30 Days' },
  { label: 'Order (New)', value: '25%', caption: 'Last 30 Days' },
  { label: 'Order (Old)', value: '75%', caption: 'Last 30 Days' },
  { label: 'Average Order', value: 'PKR 151', caption: 'Overall' },
  { label: 'Highest Order', value: 'PKR 7,332', caption: 'Overall' },
];

const products = [
  { name: 'Margherita', price: 'PKR 600', unit: '12', total: 'PKR 7,200' },
  { name: 'Lemonade', price: 'PKR 200', unit: '20', total: 'PKR 4,000' },
  { name: 'Apple Crumble', price: 'PKR 450', unit: '9', total: 'PKR 4,050' },
  { name: 'Box of Blessings', price: 'PKR 900', unit: '3', total: 'PKR 2,700' },
];

function Dashboard() {
  return (
    <div className="space-y-6">
      <div
        className="rounded-2xl p-6 text-ink shadow-card bg-white border border-slate-100"
        style={{
          backgroundImage: `url(${coverBg})`,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
        }}
      >
        <div className="backdrop-blur-sm bg-white/80 rounded-xl p-5 max-w-2xl">
          <h1 className="text-2xl font-semibold">Sales Statistics</h1>
          <p className="text-sm text-muted mt-2">
            This is your sales summary. Track orders and revenue at a glance.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        {stats.map((item) => (
          <div key={`${item.label}-${item.caption}`} className="bg-white rounded-2xl shadow-card border border-slate-100 p-4">
            <div className="text-xs text-muted">{item.label}</div>
            <div className="text-lg font-semibold text-ink mt-2">{item.value}</div>
            <div className="text-xs text-muted mt-1">{item.caption}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {['Order Trend', 'Rejected Order Trend', 'Order Heatmap'].map((title) => (
          <div key={title} className="bg-white rounded-2xl shadow-card border border-slate-100 p-4">
            <div className="flex items-center justify-between">
              <div className="text-sm font-semibold">{title}</div>
              <span className="text-xs text-muted">March 2022</span>
            </div>
            <div className="mt-4 h-36 flex items-center justify-center border border-dashed border-slate-200 rounded-xl text-sm text-muted">
              Click to Load
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <div className="xl:col-span-2 bg-white rounded-2xl shadow-card border border-slate-100 p-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">Best Selling Products</h2>
            <button className="text-xs text-ink bg-brandYellow px-3 py-1 rounded-full">
              View All
            </button>
          </div>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-muted border-b">
                <tr>
                  <th className="text-left py-2">Product</th>
                  <th className="text-left py-2">Price</th>
                  <th className="text-left py-2">Unit Sold</th>
                  <th className="text-left py-2">Total Sales</th>
                </tr>
              </thead>
              <tbody>
                {products.map((row) => (
                  <tr key={row.name} className="border-b last:border-0">
                    <td className="py-3 font-medium">{row.name}</td>
                    <td className="py-3">{row.price}</td>
                    <td className="py-3">{row.unit}</td>
                    <td className="py-3">{row.total}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <div className="bg-white rounded-2xl shadow-card border border-slate-100 p-4">
          <h2 className="text-sm font-semibold">Channel Contribution</h2>
          <div className="mt-4 h-48 flex items-center justify-center border border-dashed border-slate-200 rounded-xl text-sm text-muted">
            Click to Load
          </div>
          <div className="mt-4 space-y-2 text-xs text-muted">
            <div className="flex items-center justify-between">
              <span>Delivery</span>
              <span>48%</span>
            </div>
            <div className="flex items-center justify-between">
              <span>Dine-in</span>
              <span>32%</span>
            </div>
            <div className="flex items-center justify-between">
              <span>Takeaway</span>
              <span>20%</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default Dashboard;
