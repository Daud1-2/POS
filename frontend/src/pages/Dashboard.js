import React, { useEffect, useMemo, useState } from 'react';
import {
  AreaChart,
  Area,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import coverBg from '../assets/pos_bg/cover_bg.png';
import {
  getSummary,
  getSalesTrend,
  getRejectedTrend,
  getTopProducts,
  getPaymentType,
  getChannelContribution,
} from '../services/dashboard';

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

const toNumber = (value) => Number(value || 0);
const formatCurrency = (value) => `PKR ${toNumber(value).toLocaleString()}`;
const pad = (value) => String(value).padStart(2, '0');

const toPaymentLabel = (paymentMethod) => {
  if (paymentMethod === 'cash') return 'COD';
  if (paymentMethod === 'card') return 'CARD';
  return 'ONLINE';
};

const PAYMENT_COLORS = {
  COD: '#e79ab2',
  CARD: '#9fbde3',
  ONLINE: '#9ad7a7',
};

const DELIVERY_COLORS = {
  Delivery: '#e79ab2',
  Pickup: '#9fbde3',
};

const buildSeriesByRange = (range, rows, valueKeys) => {
  const grouped = new Map();

  rows.forEach((row) => {
    const date = new Date(row.bucket);
    if (Number.isNaN(date.getTime())) return;

    const key = range === 'day' ? date.getHours() : date.getDate();
    const current = grouped.get(key) || {};
    valueKeys.forEach((field) => {
      current[field] = toNumber(current[field]) + toNumber(row[field]);
    });
    grouped.set(key, current);
  });

  if (range === 'day') {
    const points = [];
    for (let hour = 0; hour < 24; hour += 1) {
      const source = grouped.get(hour) || {};
      points.push({
        key: `h-${hour}`,
        label: `${pad(hour)}:00`,
        prettyLabel: `Today ${pad(hour)}:00`,
        ...Object.fromEntries(valueKeys.map((field) => [field, toNumber(source[field])])),
      });
    }
    return points;
  }

  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const points = [];
  for (let day = 1; day <= daysInMonth; day += 1) {
    const source = grouped.get(day) || {};
    const date = new Date(year, month, day);
    const weekday = date.toLocaleDateString('en-US', { weekday: 'long' });
    points.push({
      key: `d-${day}`,
      label: String(day),
      prettyLabel: `${weekday} ${day} ${MONTH_NAMES[month]}, ${year}`,
      ...Object.fromEntries(valueKeys.map((field) => [field, toNumber(source[field])])),
    });
  }
  return points;
};

const OrderTrendTooltip = ({ active, payload }) => {
  if (!active || !payload || payload.length === 0) return null;
  const point = payload[0]?.payload;
  if (!point) return null;

  const totalOrders = toNumber(point.order_count);
  const totalSales = toNumber(point.sales_total);
  const webOrders = toNumber(point.web_order_count);
  const webSales = toNumber(point.web_sales_total);

  return (
    <div className="bg-white border border-slate-200 rounded-lg px-3 py-2 shadow-xl min-w-[220px]">
      <div className="text-[11px] text-slate-700 font-semibold mb-2">{point.prettyLabel}</div>
      <div className="space-y-1">
        <div className="flex items-center justify-between text-[11px]">
          <div className="flex items-center gap-2 text-slate-700">
            <span className="w-2 h-2 rounded-full bg-[#4f46a5]" />
            <span>Total Orders: {totalOrders}</span>
          </div>
          <span className="text-slate-800">{formatCurrency(totalSales)}</span>
        </div>
        <div className="flex items-center justify-between text-[11px]">
          <div className="flex items-center gap-2 text-slate-700">
            <span className="w-2 h-2 rounded-full bg-[#e11d48]" />
            <span>Web Orders: {webOrders}</span>
          </div>
          <span className="text-slate-800">{formatCurrency(webSales)}</span>
        </div>
      </div>
    </div>
  );
};

const RejectedTrendTooltip = ({ active, payload }) => {
  if (!active || !payload || payload.length === 0) return null;
  const point = payload[0]?.payload;
  if (!point) return null;

  return (
    <div className="bg-slate-900 text-white rounded-md px-3 py-2 shadow-xl text-[11px]">
      <span className="font-semibold">Total Orders:</span> {toNumber(point.rejected_count)}
      <span className="mx-1">|</span>
      <span className="font-semibold">Loss of Business:</span> {formatCurrency(point.loss_of_business)}
    </div>
  );
};

const renderInsidePieLabel = ({ cx, cy, midAngle, innerRadius, outerRadius, percent }) => {
  const share = Number((toNumber(percent) * 100).toFixed(2));
  if (share <= 0) return null;

  const RADIAN = Math.PI / 180;
  const radius = innerRadius + (outerRadius - innerRadius) * 0.62;
  const x = cx + radius * Math.cos(-midAngle * RADIAN);
  const y = cy + radius * Math.sin(-midAngle * RADIAN);

  return (
    <text
      x={x}
      y={y}
      fill="#ffffff"
      textAnchor="middle"
      dominantBaseline="central"
      fontSize="11"
      fontWeight="600"
    >
      {`${share}%`}
    </text>
  );
};

const RangeToggle = ({ range, onChange }) => (
  <div className="inline-flex rounded-md border border-slate-200 overflow-hidden text-[10px]">
    <button
      type="button"
      onClick={() => onChange('day')}
      className={`px-2 py-1 ${range === 'day' ? 'bg-brandYellow/20 text-ink' : 'bg-white text-muted'}`}
    >
      Day
    </button>
    <button
      type="button"
      onClick={() => onChange('month')}
      className={`px-2 py-1 border-l border-slate-200 ${range === 'month' ? 'bg-brandYellow/20 text-ink' : 'bg-white text-muted'}`}
    >
      Month
    </button>
  </div>
);

function Dashboard() {
  const [range, setRange] = useState('day');
  const [summary, setSummary] = useState(null);
  const [salesTrend, setSalesTrend] = useState([]);
  const [rejectedTrend, setRejectedTrend] = useState([]);
  const [topProducts, setTopProducts] = useState([]);
  const [paymentType, setPaymentType] = useState([]);
  const [channelContribution, setChannelContribution] = useState([]);
  const [loadingFast, setLoadingFast] = useState(true);
  const [loadingSlow, setLoadingSlow] = useState(true);
  const [error, setError] = useState('');
  const [lastUpdated, setLastUpdated] = useState(null);

  useEffect(() => {
    let mounted = true;
    let fastTimer;
    let slowTimer;

    const fetchFast = async () => {
      try {
        const [summaryResponse, top, payment, channels] = await Promise.all([
          getSummary(range),
          getTopProducts(range, 10),
          getPaymentType(range),
          getChannelContribution(range),
        ]);

        if (!mounted) return;
        setSummary(summaryResponse);
        setTopProducts(top);
        setPaymentType(payment);
        setChannelContribution(channels);
        setError('');
        setLastUpdated(new Date());
      } catch (err) {
        if (!mounted) return;
        setError('Failed to refresh summary data');
      } finally {
        if (mounted) setLoadingFast(false);
      }
    };

    const fetchSlow = async () => {
      try {
        const [sales, rejected] = await Promise.all([
          getSalesTrend(range),
          getRejectedTrend(range),
        ]);

        if (!mounted) return;
        setSalesTrend(sales);
        setRejectedTrend(rejected);
        setError('');
        setLastUpdated(new Date());
      } catch (err) {
        if (!mounted) return;
        setError('Failed to refresh chart data');
      } finally {
        if (mounted) setLoadingSlow(false);
      }
    };

    fetchFast();
    fetchSlow();
    fastTimer = setInterval(fetchFast, 15000);
    slowTimer = setInterval(fetchSlow, 60000);

    return () => {
      mounted = false;
      clearInterval(fastTimer);
      clearInterval(slowTimer);
    };
  }, [range]);

  const rangeCaption = range === 'day' ? 'Today' : 'This Month';
  const stats = [
    { label: 'Total Orders', value: summary?.total_orders ?? 0, caption: rangeCaption },
    { label: 'Total Sales', value: formatCurrency(summary?.total_sales), caption: rangeCaption },
    {
      label: 'Order (New)',
      value: summary?.new_vs_old ? `${summary.new_vs_old.new_pct}%` : '-',
      caption: rangeCaption,
    },
    {
      label: 'Order (Old)',
      value: summary?.new_vs_old ? `${summary.new_vs_old.old_pct}%` : '-',
      caption: rangeCaption,
    },
    { label: 'Average Order', value: formatCurrency(summary?.avg_order_value), caption: rangeCaption },
    { label: 'Highest Order', value: formatCurrency(summary?.highest_order_value), caption: rangeCaption },
  ];

  const salesSeries = useMemo(
    () => buildSeriesByRange(range, salesTrend, ['order_count', 'sales_total', 'web_order_count', 'web_sales_total']),
    [range, salesTrend]
  );

  const rejectedSeries = useMemo(
    () => buildSeriesByRange(range, rejectedTrend, ['rejected_count', 'loss_of_business']),
    [range, rejectedTrend]
  );

  const salesTrendData = useMemo(
    () =>
      salesSeries.map((row) => ({
        ...row,
        baseline: 0,
      })),
    [salesSeries]
  );

  const rejectedTrendData = useMemo(
    () =>
      rejectedSeries.map((row) => ({
        ...row,
        rejected_baseline: 0,
      })),
    [rejectedSeries]
  );

  const paymentTypeData = useMemo(() => {
    const byLabel = new Map(
      paymentType.map((row) => {
        const label = toPaymentLabel(row.payment_method);
        return [label, {
          name: label,
          value: toNumber(row.percent),
          count: toNumber(row.order_count),
          total_sales: toNumber(row.total_sales),
          color: PAYMENT_COLORS[label] || '#cbd5e1',
        }];
      })
    );
    const cod = byLabel.get('COD') || { name: 'COD', value: 0, count: 0, total_sales: 0, color: PAYMENT_COLORS.COD };
    const card = byLabel.get('CARD') || { name: 'CARD', value: 0, count: 0, total_sales: 0, color: PAYMENT_COLORS.CARD };
    const online = byLabel.get('ONLINE') || { name: 'ONLINE', value: 0, count: 0, total_sales: 0, color: PAYMENT_COLORS.ONLINE };
    if (online.value > 0 || online.count > 0) {
      return [cod, card, online];
    }
    return [cod, card];
  }, [paymentType]);

  const deliveryPickupData = useMemo(() => {
    const totals = channelContribution.reduce(
      (acc, row) => {
        const bucket = row.order_type === 'delivery' ? 'Delivery' : 'Pickup';
        acc[bucket].sales += toNumber(row.total_sales);
        acc[bucket].percent += toNumber(row.percent);
        return acc;
      },
      {
        Delivery: { sales: 0, percent: 0 },
        Pickup: { sales: 0, percent: 0 },
      }
    );

    const totalOrders = toNumber(summary?.total_orders);
    return ['Delivery', 'Pickup'].map((name) => ({
      name,
      value: Number(totals[name].percent.toFixed(2)),
      count: totalOrders > 0 ? Math.round((totals[name].percent / 100) * totalOrders) : 0,
      total_sales: Number(totals[name].sales.toFixed(2)),
      color: DELIVERY_COLORS[name],
    }));
  }, [channelContribution, summary]);

  const slowSectionLoading = loadingSlow && salesTrend.length === 0 && rejectedTrend.length === 0;
  const rangeBadge = range === 'day'
    ? `${MONTH_NAMES[new Date().getMonth()]} ${new Date().getDate()}, ${new Date().getFullYear()}`
    : `${MONTH_NAMES[new Date().getMonth()]} ${new Date().getFullYear()}`;

  return (
    <div className="space-y-6">
      {error && (
        <div className="bg-yellow-100 text-ink text-sm rounded-xl px-4 py-3">
          {error}
        </div>
      )}

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
            This is your sales summary. Track orders and revenue from real order records.
          </p>
          {lastUpdated && (
            <p className="text-xs text-muted mt-2">
              Last updated: {lastUpdated.toLocaleTimeString()}
            </p>
          )}
        </div>
      </div>

      <div className="flex justify-end">
        <RangeToggle range={range} onChange={setRange} />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
        {stats.map((item) => (
          <div
            key={`${item.label}-${item.caption}`}
            className="bg-white rounded-2xl shadow-card border border-slate-100 p-4"
          >
            <div className="text-xs text-muted">{item.label}</div>
            <div className="text-lg font-semibold text-ink mt-2">
              {loadingFast ? 'Loading...' : item.value}
            </div>
            <div className="text-xs text-muted mt-1">{item.caption}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="bg-white rounded-2xl shadow-card border border-slate-100 p-4">
          <div className="flex items-center justify-between">
            <div className="text-sm font-semibold">Order Trend</div>
            <RangeToggle range={range} onChange={setRange} />
          </div>
          <div className="mt-4 h-56">
            {salesTrendData.length === 0 ? (
              <div className="h-full flex items-center justify-center border border-dashed border-slate-200 rounded-xl text-sm text-muted">
                {slowSectionLoading ? 'Loading...' : 'No data yet'}
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={salesTrendData} margin={{ top: 8, right: 8, left: 8, bottom: 28 }}>
                  <CartesianGrid strokeDasharray="0" stroke="#e5e7eb" />
                  <XAxis
                    dataKey="label"
                    tick={{ fontSize: 10, fill: '#6b7280' }}
                    angle={-40}
                    textAnchor="end"
                    height={48}
                    label={{ value: range === 'day' ? 'HOURS' : 'DATES', position: 'insideBottom', offset: -2, style: { fontSize: 10 } }}
                  />
                  <YAxis
                    allowDecimals={false}
                    tick={{ fontSize: 10, fill: '#6b7280' }}
                    label={{ value: 'ORDERS', angle: -90, position: 'insideLeft', style: { fontSize: 10 } }}
                  />
                  <Tooltip
                    cursor={{ stroke: '#94a3b8', strokeWidth: 1, strokeDasharray: '4 4' }}
                    content={<OrderTrendTooltip />}
                  />
                  <Line
                    type="linear"
                    dataKey="baseline"
                    stroke="transparent"
                    strokeWidth={0}
                    dot={{ r: 2, fill: '#2f9e44' }}
                    activeDot={false}
                    isAnimationActive={false}
                  />
                  <Line
                    type="linear"
                    dataKey="web_order_count"
                    stroke="#e11d48"
                    strokeWidth={1.6}
                    strokeDasharray="4 3"
                    dot={{ r: 2, fill: '#e11d48' }}
                    isAnimationActive={false}
                  />
                  <Line
                    type="linear"
                    dataKey="order_count"
                    stroke="#4f46a5"
                    strokeWidth={2}
                    dot={{ r: 3, fill: '#4f46a5' }}
                    activeDot={{ r: 4 }}
                    isAnimationActive={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        <div className="bg-white rounded-2xl shadow-card border border-slate-100 p-4">
          <div className="flex items-center justify-between">
            <div className="text-sm font-semibold">Rejected Order Trend</div>
            <RangeToggle range={range} onChange={setRange} />
          </div>
          <div className="mt-4 h-56">
            {rejectedTrendData.length === 0 ? (
              <div className="h-full flex items-center justify-center border border-dashed border-slate-200 rounded-xl text-sm text-muted">
                {slowSectionLoading ? 'Loading...' : 'No data yet'}
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={rejectedTrendData} margin={{ top: 8, right: 8, left: 8, bottom: 28 }}>
                  <CartesianGrid strokeDasharray="0" stroke="#e5e7eb" />
                  <defs>
                    <linearGradient id="rejectedFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#f43f5e" stopOpacity={0.8} />
                      <stop offset="100%" stopColor="#f43f5e" stopOpacity={0.08} />
                    </linearGradient>
                  </defs>
                  <XAxis
                    dataKey="label"
                    tick={{ fontSize: 10, fill: '#6b7280' }}
                    angle={-40}
                    textAnchor="end"
                    height={48}
                    label={{ value: range === 'day' ? 'HOURS' : 'DATES', position: 'insideBottom', offset: -2, style: { fontSize: 10 } }}
                  />
                  <YAxis
                    allowDecimals={false}
                    tick={{ fontSize: 10, fill: '#6b7280' }}
                    label={{ value: 'ORDERS', angle: -90, position: 'insideLeft', style: { fontSize: 10 } }}
                  />
                  <Tooltip
                    cursor={{ stroke: '#111827', strokeWidth: 1.2 }}
                    content={<RejectedTrendTooltip />}
                  />
                  <Line
                    type="linear"
                    dataKey="rejected_baseline"
                    stroke="transparent"
                    strokeWidth={0}
                    dot={{ r: 2, fill: '#e11d48' }}
                    activeDot={false}
                    isAnimationActive={false}
                  />
                  <Area
                    type="linear"
                    dataKey="rejected_count"
                    stroke="#e11d48"
                    fill="url(#rejectedFill)"
                    strokeWidth={2}
                    dot={{ r: 2, fill: '#e11d48' }}
                    activeDot={{ r: 4 }}
                    isAnimationActive={false}
                  />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        <div className="bg-white rounded-2xl shadow-card border border-slate-100 p-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">Trending Items</h2>
          </div>
          <div className="mt-3 flex items-center gap-2 text-[10px]">
            <span className="px-3 py-1 rounded border border-slate-200 text-slate-700">{rangeBadge}</span>
          </div>
          <div className="mt-3 overflow-x-auto max-h-[240px]">
            <table className="w-full text-xs">
              <thead className="bg-brandYellow text-slate-900">
                <tr>
                  <th className="text-left py-2 px-2">ITEM NAME</th>
                  <th className="text-center py-2 px-2">NO. OF TIME ORDERED</th>
                </tr>
              </thead>
              <tbody>
                {topProducts.length === 0 ? (
                  <tr>
                    <td colSpan="2" className="py-5 text-center text-muted">
                      {loadingFast ? 'Loading...' : 'No data yet'}
                    </td>
                  </tr>
                ) : (
                  topProducts.slice(0, 10).map((row) => (
                    <tr key={`${row.product_id}-${row.product_name}`} className="border-b last:border-0">
                      <td className="py-2 px-2 text-slate-700">{row.product_name}</td>
                      <td className="py-2 px-2 text-center text-slate-900 font-semibold">{toNumber(row.unit_sold)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <div className="bg-white rounded-2xl shadow-card border border-slate-100 p-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">Payment Type</h2>
            <RangeToggle range={range} onChange={setRange} />
          </div>
          <div className="mt-3 h-52">
            {paymentTypeData.every((row) => row.value === 0) ? (
              <div className="h-full flex items-center justify-center border border-dashed border-slate-200 rounded-xl text-sm text-muted">
                {loadingFast ? 'Loading...' : 'No data yet'}
              </div>
            ) : (
              <div className="h-full flex items-center gap-3">
                <div className="w-1/2 flex flex-col justify-center gap-2">
                  {paymentTypeData.map((row) => (
                    <div key={row.name} className="flex items-center gap-2 text-xs text-slate-600">
                      <span className="inline-block w-3 h-3 rounded-sm" style={{ backgroundColor: row.color }} />
                      <span>{row.name} - {row.value.toFixed(2)}% ({row.count})</span>
                    </div>
                  ))}
                </div>
                <div className="w-1/2 h-full flex items-center justify-center">
                  <div className="w-[172px] h-[172px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                      <Tooltip formatter={(value) => `${Number(value).toFixed(2)}%`} />
                      <Pie
                        data={paymentTypeData}
                        dataKey="value"
                        nameKey="name"
                        cx="50%"
                        cy="50%"
                        innerRadius={0}
                        outerRadius="88%"
                        label={renderInsidePieLabel}
                        labelLine={false}
                        stroke="none"
                        isAnimationActive={false}
                      >
                        {paymentTypeData.map((entry) => (
                          <Cell key={entry.name} fill={entry.color} />
                        ))}
                      </Pie>
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="bg-white rounded-2xl shadow-card border border-slate-100 p-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">Delivery/Pickup</h2>
            <RangeToggle range={range} onChange={setRange} />
          </div>
          <div className="mt-3 h-52">
            {deliveryPickupData.every((row) => row.value === 0) ? (
              <div className="h-full flex items-center justify-center border border-dashed border-slate-200 rounded-xl text-sm text-muted">
                {loadingFast ? 'Loading...' : 'No data yet'}
              </div>
            ) : (
              <div className="h-full">
                <div className="h-[82%]">
                  <div className="w-full h-full flex items-center justify-center">
                    <div className="w-[190px] h-[190px]">
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                      <Tooltip formatter={(value) => `${Number(value).toFixed(2)}%`} />
                      <Pie
                        data={deliveryPickupData}
                        dataKey="value"
                        nameKey="name"
                        cx="50%"
                        cy="50%"
                        innerRadius={0}
                        outerRadius="88%"
                        label={renderInsidePieLabel}
                        labelLine={false}
                        stroke="none"
                        isAnimationActive={false}
                      >
                        {deliveryPickupData.map((entry) => (
                          <Cell key={entry.name} fill={entry.color} />
                        ))}
                      </Pie>
                        </PieChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                </div>
                <div className="flex flex-wrap gap-3 text-xs text-slate-600">
                  {deliveryPickupData.map((row) => (
                    <div key={row.name} className="flex items-center gap-2">
                      <span className="inline-block w-3 h-3 rounded-sm" style={{ backgroundColor: row.color }} />
                      <span>{row.name} - {row.value.toFixed(2)}% ({row.count})</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default Dashboard;
