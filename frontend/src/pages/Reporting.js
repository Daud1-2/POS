import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  Bar,
  BarChart,
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
import {
  getBranchComparison,
  getBranchOptions,
  getPaymentOverview,
  getPaymentTrend,
  getProductsIntelligence,
  getRevenueOverview,
  getRevenueTrend,
  getTimeAnalysis,
  getUserRole,
} from '../services/reporting';

const DEFAULT_TIMEZONE = 'Asia/Karachi';

const TABS = [
  { key: 'revenue', label: 'Revenue Analytics' },
  { key: 'payments', label: 'Payment Analytics' },
  { key: 'products', label: 'Product Intelligence' },
  { key: 'time', label: 'Time & Trend Analysis' },
  { key: 'branches', label: 'Branch Comparison' },
];

const MONTH_OPTIONS = [
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

const PAYMENT_COLORS = { cash: '#f59e0b', card: '#0ea5e9', online: '#10b981' };
const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const fmtMoney = (value) => `PKR ${Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
const fmtPct = (value) => `${Number(value || 0).toFixed(2)}%`;
const validTab = (value) => TABS.some((tab) => tab.key === value);
const toNumber = (value) => Number(value || 0);
const toPaymentLabel = (paymentMethod) => {
  if (paymentMethod === 'cash') return 'Cash';
  if (paymentMethod === 'card') return 'Card';
  return 'Online';
};

const bucketLabel = (value, bucket) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';

  if (bucket === 'hour') return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
  if (bucket === 'week') return date.toLocaleDateString([], { day: '2-digit', month: 'short' });
  if (bucket === 'month') return date.toLocaleDateString([], { month: 'short', year: '2-digit' });
  return date.toLocaleDateString([], { day: '2-digit', month: 'short' });
};

const bucketPrettyLabel = (value) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString([], {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
};

const noDataClass = 'h-full flex items-center justify-center border border-dashed border-slate-200 rounded-xl text-sm text-slate-500';

const NoChartData = ({ text = 'No data yet' }) => <div className={noDataClass}>{text}</div>;

const MoneyTooltip = ({ active, payload, formatter = fmtMoney, titleFromPayload = (row) => row?.label || '' }) => {
  if (!active || !payload || payload.length === 0) return null;
  const row = payload[0]?.payload;

  return (
    <div className="bg-white border border-slate-200 rounded-lg px-3 py-2 shadow-xl min-w-[210px]">
      <div className="text-[11px] text-slate-700 font-semibold mb-2">{titleFromPayload(row)}</div>
      <div className="space-y-1">
        {payload.map((entry) => (
          <div key={entry.dataKey} className="flex items-center justify-between text-[11px] text-slate-700 gap-3">
            <div className="flex items-center gap-2">
              <span className="inline-block w-2 h-2 rounded-full" style={{ backgroundColor: entry.color || entry.fill || entry.stroke }} />
              <span>{entry.name || entry.dataKey}</span>
            </div>
            <span className="text-slate-900 font-medium">{formatter(entry.value)}</span>
          </div>
        ))}
      </div>
    </div>
  );
};

const PercentPieTooltip = ({ active, payload }) => {
  if (!active || !payload || payload.length === 0) return null;
  const item = payload[0]?.payload;
  if (!item) return null;
  return (
    <div className="bg-white border border-slate-200 rounded-lg px-3 py-2 shadow-xl min-w-[160px]">
      <div className="text-[11px] text-slate-700 font-semibold">{item.name}</div>
      <div className="text-[11px] text-slate-700 mt-1">Share: <span className="font-medium text-slate-900">{fmtPct(item.value)}</span></div>
      <div className="text-[11px] text-slate-700">Amount: <span className="font-medium text-slate-900">{fmtMoney(item.amount)}</span></div>
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

function Reporting() {
  const navigate = useNavigate();
  const location = useLocation();
  const searchParams = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const tab = searchParams.get('tab');
  const activeTab = validTab(tab) ? tab : 'revenue';
  const now = useMemo(() => new Date(), []);

  const [periodMode, setPeriodMode] = useState('month');
  const [selectedMonth, setSelectedMonth] = useState(now.getMonth());
  const [selectedYear, setSelectedYear] = useState(now.getFullYear());
  const [branchId, setBranchId] = useState(() => {
    const raw = localStorage.getItem('branchId');
    const parsed = Number(raw);
    if (Number.isInteger(parsed) && parsed > 0) return parsed;
    const options = getBranchOptions();
    return Number(options[0]?.id || 1);
  });
  const [channelFilter, setChannelFilter] = useState('all');
  const [branchIds, setBranchBranchIds] = useState(() =>
    getBranchOptions().map((item) => item.id)
  );
  const [data, setData] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [lastUpdated, setLastUpdated] = useState(null);

  const role = getUserRole();
  const branchOptions = useMemo(() => getBranchOptions(), []);

  useEffect(() => {
    if (validTab(tab)) return;
    navigate('/reporting?tab=revenue', { replace: true });
  }, [navigate, tab]);

  const bucket = periodMode === 'month' ? 'day' : 'month';
  const rangeParams = useMemo(() => {
    if (periodMode === 'month') {
      const from = new Date(selectedYear, selectedMonth, 1, 0, 0, 0, 0);
      const to = new Date(selectedYear, selectedMonth + 1, 1, 0, 0, 0, 0);
      return {
        date_from: from.toISOString(),
        date_to: to.toISOString(),
      };
    }

    const from = new Date(selectedYear, 0, 1, 0, 0, 0, 0);
    const to = new Date(selectedYear + 1, 0, 1, 0, 0, 0, 0);
    return {
      date_from: from.toISOString(),
      date_to: to.toISOString(),
    };
  }, [periodMode, selectedMonth, selectedYear]);

  const baseParams = useMemo(() => ({
    date_from: rangeParams.date_from,
    date_to: rangeParams.date_to,
    bucket,
    branch_id: branchId,
    channel: channelFilter === 'all' ? undefined : channelFilter,
  }), [bucket, branchId, channelFilter, rangeParams.date_from, rangeParams.date_to]);

  const fetchData = useCallback(async (mode = 'full') => {
    try {
      if (mode === 'full') setLoading(true);

      if (activeTab === 'revenue') {
        if (mode === 'full') {
          const [overview, trend] = await Promise.all([
            getRevenueOverview(baseParams),
            getRevenueTrend(baseParams),
          ]);
          setData((prev) => ({ ...prev, revenueOverview: overview, revenueTrend: trend }));
        } else {
          const overview = await getRevenueOverview(baseParams);
          setData((prev) => ({ ...prev, revenueOverview: overview }));
        }
      } else if (activeTab === 'payments') {
        if (mode === 'full') {
          const [overview, trend] = await Promise.all([
            getPaymentOverview(baseParams),
            getPaymentTrend(baseParams),
          ]);
          setData((prev) => ({ ...prev, paymentOverview: overview, paymentTrend: trend }));
        } else {
          const overview = await getPaymentOverview(baseParams);
          setData((prev) => ({ ...prev, paymentOverview: overview }));
        }
      } else if (activeTab === 'products') {
        if (mode === 'fast') return;
        const intelligence = await getProductsIntelligence(baseParams);
        setData((prev) => ({ ...prev, products: intelligence }));
      } else if (activeTab === 'time') {
        if (mode === 'fast') return;
        const analysis = await getTimeAnalysis(baseParams);
        setData((prev) => ({ ...prev, time: analysis }));
      } else if (activeTab === 'branches') {
        if (role !== 'admin') {
          setError('Branch comparison is available for admin users only.');
          return;
        }
        if (mode === 'fast') return;
        const branches = await getBranchComparison({
          ...baseParams,
          branch_ids: branchIds,
        });
        setData((prev) => ({ ...prev, branches }));
      }

      setError('');
      setLastUpdated(new Date());
    } catch (err) {
      setError(err?.response?.data?.error || 'Failed to load reporting analytics');
    } finally {
      if (mode === 'full') setLoading(false);
    }
  }, [activeTab, baseParams, branchIds, role]);

  useEffect(() => {
    fetchData('full');
    const fastTimer = setInterval(() => fetchData('fast'), 15000);
    const slowTimer = setInterval(() => fetchData('full'), 60000);
    return () => {
      clearInterval(fastTimer);
      clearInterval(slowTimer);
    };
  }, [fetchData]);

  const revenueTrendRows = useMemo(() => {
    const current = data.revenueTrend?.current || [];
    const currentMap = new Map();
    const trendTimezone = data.revenueTrend?.timezone || localStorage.getItem('userTimezone') || DEFAULT_TIMEZONE;

    let formatter;
    try {
      formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: trendTimezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      });
    } catch (err) {
      formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: DEFAULT_TIMEZONE,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      });
    }

    const getDateParts = (value) => {
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) return null;

      const parts = formatter.formatToParts(date);
      const year = Number(parts.find((part) => part.type === 'year')?.value || 0);
      const month = Number(parts.find((part) => part.type === 'month')?.value || 0);
      const day = Number(parts.find((part) => part.type === 'day')?.value || 0);
      if (!year || !month || !day) return null;

      return {
        year,
        month,
        day,
      };
    };

    const getMonthSlot = (value) => {
      const parts = getDateParts(value);
      return parts ? parts.day : null;
    };

    const getYearSlot = (value) => {
      const parts = getDateParts(value);
      return parts ? parts.month : null;
    };

    current.forEach((row) => {
      const slot = periodMode === 'month' ? getMonthSlot(row.bucket_ts) : getYearSlot(row.bucket_ts);
      if (!slot) return;
      currentMap.set(slot, toNumber(row.revenue));
    });

    if (periodMode === 'month') {
      const daysInMonth = new Date(selectedYear, selectedMonth + 1, 0).getDate();
      return Array.from({ length: daysInMonth }, (_, index) => {
        const day = index + 1;
        return {
          label: String(day),
          prettyLabel: `${MONTH_OPTIONS[selectedMonth]} ${day}, ${selectedYear}`,
          current: currentMap.get(day) || 0,
        };
      });
    }

    return MONTH_OPTIONS.map((monthName, index) => {
      const slot = index + 1;
      return {
        label: monthName.slice(0, 3),
        prettyLabel: `${monthName} ${selectedYear}`,
        current: currentMap.get(slot) || 0,
      };
    });
  }, [data.revenueTrend, periodMode, selectedMonth, selectedYear]);

  const paymentSplitRows = useMemo(() => {
    const byMethod = new Map((data.paymentOverview?.payment_split || []).map((row) => [row.payment_method, row]));
    return ['cash', 'card', 'online'].map((method) => {
      const row = byMethod.get(method);
      return {
        name: toPaymentLabel(method),
        method,
        value: toNumber(row?.amount_pct),
        amount: toNumber(row?.amount),
        count: toNumber(row?.count),
        color: PAYMENT_COLORS[method],
      };
    });
  }, [data.paymentOverview]);

  const paymentTrendRows = useMemo(
    () => (data.paymentTrend?.data || []).map((row) => ({
      ...row,
      label: bucketLabel(row.bucket_ts, bucket),
      prettyLabel: bucketPrettyLabel(row.bucket_ts),
    })),
    [bucket, data.paymentTrend]
  );

  const categoryShare = useMemo(
    () => (data.products?.category_revenue_share || []).map((row) => ({
      ...row,
      label: row.category_name,
    })),
    [data.products]
  );
  const hourlyRows = useMemo(
    () => (data.time?.hourly_sales || []).map((row) => ({
      ...row,
      label: `${String(row.hour_of_day).padStart(2, '0')}:00`,
      prettyLabel: `${String(row.hour_of_day).padStart(2, '0')}:00`,
    })),
    [data.time]
  );
  const weekdayRows = useMemo(
    () => (data.time?.weekday_sales || []).map((row) => ({
      ...row,
      label: WEEKDAY_LABELS[toNumber(row.day_of_week)] || String(row.day_of_week),
      prettyLabel: WEEKDAY_LABELS[toNumber(row.day_of_week)] || String(row.day_of_week),
    })),
    [data.time]
  );
  const yearOptions = useMemo(() => {
    const currentYear = new Date().getFullYear();
    return Array.from({ length: 12 }, (_, index) => currentYear - index);
  }, []);
  const rangeCaption = periodMode === 'month'
    ? `${MONTH_OPTIONS[selectedMonth]} ${selectedYear}`
    : `Year ${selectedYear}`;
  const branchRows = data.branches?.branches || [];
  const productsSummary = useMemo(() => ({
    totalCash: toNumber(data.products?.summary?.total_cash ?? data.products?.total_cash),
    totalProfit: toNumber(data.products?.summary?.total_profit ?? data.products?.total_profit),
    mostRunning: data.products?.summary?.most_running_product ?? data.products?.most_running_product ?? null,
  }), [data.products]);
  const revenueStats = useMemo(() => ([
    {
      label: 'Total Collected',
      value: fmtMoney(data.revenueOverview?.total_collected),
      caption: rangeCaption,
    },
    {
      label: 'Gross Revenue',
      value: fmtMoney(data.revenueOverview?.gross_revenue),
      caption: rangeCaption,
    },
    {
      label: 'Net Revenue',
      value: fmtMoney(data.revenueOverview?.net_revenue),
      caption: rangeCaption,
    },
    {
      label: 'Refund Amount',
      value: fmtMoney(data.revenueOverview?.refund_amount),
      caption: rangeCaption,
    },
    {
      label: 'Discount Impact',
      value: fmtPct(data.revenueOverview?.discount_impact_pct),
      caption: 'Of gross revenue',
    },
    {
      label: 'Average Order Value',
      value: fmtMoney(data.revenueOverview?.aov),
      caption: rangeCaption,
    },
  ]), [data.revenueOverview, rangeCaption]);

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-card">
        <h1 className="text-2xl font-semibold">Business Intelligence Reporting</h1>
        <p className="mt-1 text-sm text-slate-500">Decision-ready analytics from PostgreSQL authority data.</p>
        {lastUpdated && <p className="mt-2 text-xs text-slate-400">Last updated: {lastUpdated.toLocaleTimeString()}</p>}
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-3 shadow-soft">
        <div className="flex flex-wrap gap-2">
          {TABS.map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => navigate(`/reporting?tab=${item.key}`)}
              className={`rounded-lg px-3 py-2 text-xs font-medium transition ${
                activeTab === item.key ? 'bg-brandYellow text-ink' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-soft">
        <div className="grid gap-3 md:grid-cols-4">
          <label className="text-xs">
            Period
            <select value={periodMode} onChange={(event) => setPeriodMode(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-2 text-sm">
              <option value="month">Month</option>
              <option value="year">Year</option>
            </select>
          </label>
          {periodMode === 'month' && (
            <label className="text-xs">
              Month
              <select value={selectedMonth} onChange={(event) => setSelectedMonth(Number(event.target.value))} className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-2 text-sm">
                {MONTH_OPTIONS.map((name, idx) => (
                  <option key={name} value={idx}>{name}</option>
                ))}
              </select>
            </label>
          )}
          <label className="text-xs">
            Year
            <select value={selectedYear} onChange={(event) => setSelectedYear(Number(event.target.value))} className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-2 text-sm">
              {yearOptions.map((year) => (
                <option key={year} value={year}>{year}</option>
              ))}
            </select>
          </label>
          <label className="text-xs">
            Branch
            <select value={branchId} onChange={(event) => setBranchId(Number(event.target.value))} className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-2 text-sm">
              {branchOptions.map((item) => (
                <option key={item.id} value={item.id}>{item.name}</option>
              ))}
            </select>
          </label>
          <label className="text-xs">
            Channel
            <select
              value={channelFilter}
              onChange={(event) => setChannelFilter(event.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-2 text-sm"
            >
              <option value="all">All Channels</option>
              <option value="pos">POS</option>
              <option value="online">Online</option>
              <option value="whatsapp">WhatsApp</option>
              <option value="delivery_platform">Delivery Platform</option>
            </select>
          </label>
          <button type="button" onClick={() => fetchData('full')} className="self-end rounded-lg bg-brandYellow px-3 py-2 text-sm font-medium text-ink">
            Refresh
          </button>
        </div>
        {activeTab === 'branches' && role === 'admin' && (
          <label className="mt-3 block text-xs">
            Branch Comparison Branchs
            <select
              multiple
              value={branchIds.map(String)}
              onChange={(event) => {
                const selected = Array.from(event.target.selectedOptions).map((opt) => Number(opt.value));
                setBranchBranchIds(selected);
              }}
              className="mt-1 h-24 w-full rounded-lg border border-slate-200 px-2 py-2 text-sm"
            >
              {branchOptions.map((item) => (
                <option key={item.id} value={item.id}>{item.name}</option>
              ))}
            </select>
          </label>
        )}
      </div>

      {error && <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div>}
      {loading && <div className="rounded-lg border border-slate-200 bg-white px-3 py-4 text-sm text-slate-500">Loading analytics...</div>}

      {!loading && activeTab === 'revenue' && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
            {revenueStats.map((item) => (
              <div
                key={item.label}
                className="bg-white rounded-2xl shadow-card border border-slate-100 p-4"
              >
                <div className="text-xs text-slate-500">{item.label}</div>
                <div className="text-lg font-semibold text-slate-900 mt-2">{item.value}</div>
                <div className="text-xs text-slate-500 mt-1">{item.caption}</div>
              </div>
            ))}
          </div>
          <div className="rounded-2xl border border-slate-100 bg-white p-4 shadow-card h-72">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">Revenue Trend</h3>
              <div className="flex items-center gap-3 text-xs text-slate-600">
                <span className="flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-full bg-[#4f46a5]" />Current</span>
              </div>
            </div>
            <div className="mt-3 h-56">
              {revenueTrendRows.length === 0 ? (
                <NoChartData />
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={revenueTrendRows} margin={{ top: 8, right: 8, left: 8, bottom: 28 }}>
                    <CartesianGrid strokeDasharray="0" stroke="#e5e7eb" />
                    <XAxis
                      dataKey="label"
                      tick={{ fontSize: 10, fill: '#6b7280' }}
                      interval={periodMode === 'month' ? 0 : 0}
                      height={26}
                    />
                    <YAxis
                      allowDecimals={false}
                      tick={{ fontSize: 10, fill: '#6b7280' }}
                      tickFormatter={(value) => `PKR ${Number(value).toLocaleString()}`}
                    />
                    <Tooltip
                      cursor={{ stroke: '#94a3b8', strokeWidth: 1, strokeDasharray: '4 4' }}
                      content={(
                        <MoneyTooltip
                          formatter={fmtMoney}
                          titleFromPayload={(row) => row?.prettyLabel || row?.label}
                        />
                      )}
                    />
                    <Line
                      type="linear"
                      dataKey="current"
                      stroke="#4c46a6"
                      strokeWidth={2.2}
                      dot={{ r: 4, fill: '#4c46a6' }}
                      activeDot={{ r: 6, fill: '#4c46a6' }}
                      name="Current"
                      isAnimationActive={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>
        </div>
      )}

      {!loading && activeTab === 'payments' && (
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="rounded-2xl border border-slate-100 bg-white p-4 shadow-card h-72">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">Payment Split</h3>
            </div>
            <div className="mt-3 h-56">
              {paymentSplitRows.every((row) => row.value === 0) ? (
                <NoChartData />
              ) : (
                <div className="h-full flex items-center gap-3">
                  <div className="w-1/2 flex flex-col justify-center gap-2">
                    {paymentSplitRows.map((row) => (
                      <div key={row.method} className="flex items-center gap-2 text-xs text-slate-600">
                        <span className="inline-block w-3 h-3 rounded-sm" style={{ backgroundColor: row.color }} />
                        <span>{row.name} - {fmtPct(row.value)} ({row.count})</span>
                      </div>
                    ))}
                  </div>
                  <div className="w-1/2 h-full flex items-center justify-center">
                    <div className="w-[172px] h-[172px]">
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Tooltip content={<PercentPieTooltip />} />
                          <Pie
                            data={paymentSplitRows}
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
                            {paymentSplitRows.map((entry) => (
                              <Cell key={entry.method} fill={entry.color} />
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
          <div className="rounded-2xl border border-slate-100 bg-white p-4 shadow-card h-72">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">Payment Trend</h3>
            </div>
            <div className="mt-3 h-56">
              {paymentTrendRows.length === 0 ? (
                <NoChartData />
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={paymentTrendRows} margin={{ top: 8, right: 8, left: 8, bottom: 28 }}>
                    <CartesianGrid strokeDasharray="0" stroke="#e5e7eb" />
                    <XAxis
                      dataKey="label"
                      tick={{ fontSize: 10, fill: '#6b7280' }}
                      angle={-40}
                      textAnchor="end"
                      height={48}
                    />
                    <YAxis tick={{ fontSize: 10, fill: '#6b7280' }} tickFormatter={(value) => Number(value).toLocaleString()} />
                    <Tooltip
                      content={(
                        <MoneyTooltip
                          formatter={fmtMoney}
                          titleFromPayload={(row) => row?.prettyLabel || row?.label}
                        />
                      )}
                    />
                    <Bar dataKey="cash_amount" stackId="a" fill={PAYMENT_COLORS.cash} name="Cash" />
                    <Bar dataKey="card_amount" stackId="a" fill={PAYMENT_COLORS.card} name="Card" />
                    <Bar dataKey="online_amount" stackId="a" fill={PAYMENT_COLORS.online} name="Online" />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>
        </div>
      )}

      {!loading && activeTab === 'products' && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
            <div className="bg-white rounded-2xl shadow-card border border-slate-100 p-4">
              <div className="text-xs text-slate-500">Total Cash</div>
              <div className="text-lg font-semibold text-slate-900 mt-2">{fmtMoney(productsSummary.totalCash)}</div>
              <div className="text-xs text-slate-500 mt-1">Product sales in selected period</div>
            </div>
            <div className="bg-white rounded-2xl shadow-card border border-slate-100 p-4">
              <div className="text-xs text-slate-500">Total Profit</div>
              <div className="text-lg font-semibold text-slate-900 mt-2">{fmtMoney(productsSummary.totalProfit)}</div>
              <div className="text-xs text-slate-500 mt-1">Based on per-item profit values</div>
            </div>
            <div className="bg-white rounded-2xl shadow-card border border-slate-100 p-4">
              <div className="text-xs text-slate-500">Most Running Product</div>
              <div className="text-lg font-semibold text-slate-900 mt-2">
                {productsSummary.mostRunning?.product_name || 'No data'}
              </div>
              <div className="text-xs text-slate-500 mt-1">
                Units sold: {toNumber(productsSummary.mostRunning?.units_sold)}
              </div>
            </div>
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="rounded-2xl border border-slate-100 bg-white p-4 shadow-card overflow-x-auto">
              <h3 className="text-sm font-semibold mb-2">Top Products by Revenue</h3>
              <table className="w-full text-sm">
                <thead className="bg-slate-100"><tr><th className="px-2 py-2 text-left">Product</th><th className="px-2 py-2 text-left">Revenue</th><th className="px-2 py-2 text-left">Profit</th></tr></thead>
                <tbody>{(data.products?.top_by_revenue || []).map((row) => <tr key={row.product_id} className="border-b"><td className="px-2 py-2">{row.product_name}</td><td className="px-2 py-2">{fmtMoney(row.revenue)}</td><td className="px-2 py-2">{fmtMoney(row.estimated_profit)}</td></tr>)}</tbody>
              </table>
            </div>
            <div className="rounded-2xl border border-slate-100 bg-white p-4 shadow-card h-72">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold">Category Revenue Share</h3>
              </div>
              <div className="mt-3 h-56">
                {categoryShare.length === 0 ? (
                  <NoChartData />
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={categoryShare}
                      layout="vertical"
                      margin={{ top: 8, right: 12, left: 12, bottom: 8 }}
                    >
                      <CartesianGrid strokeDasharray="0" stroke="#e5e7eb" horizontal={false} />
                      <XAxis
                        type="number"
                        tick={{ fontSize: 10, fill: '#6b7280' }}
                        tickFormatter={(value) => Number(value).toLocaleString()}
                      />
                      <YAxis
                        type="category"
                        dataKey="label"
                        width={120}
                        tick={{ fontSize: 10, fill: '#6b7280' }}
                      />
                      <Tooltip
                        content={(
                          <MoneyTooltip
                            formatter={fmtMoney}
                            titleFromPayload={(row) => row?.label}
                          />
                        )}
                      />
                      <Bar
                        dataKey="revenue"
                        fill="#4f46a5"
                        radius={[0, 4, 4, 0]}
                        name="Revenue"
                        minPointSize={4}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {!loading && activeTab === 'time' && (
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="rounded-2xl border border-slate-100 bg-white p-4 shadow-card h-72">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">Hourly Revenue</h3>
            </div>
            <div className="mt-3 h-56">
              {hourlyRows.every((row) => row.revenue === 0) ? (
                <NoChartData />
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={hourlyRows} margin={{ top: 8, right: 8, left: 8, bottom: 28 }}>
                    <CartesianGrid strokeDasharray="0" stroke="#e5e7eb" />
                    <XAxis
                      dataKey="label"
                      tick={{ fontSize: 10, fill: '#6b7280' }}
                      angle={-40}
                      textAnchor="end"
                      height={48}
                    />
                    <YAxis tick={{ fontSize: 10, fill: '#6b7280' }} tickFormatter={(value) => Number(value).toLocaleString()} />
                    <Tooltip
                      content={(
                        <MoneyTooltip
                          formatter={fmtMoney}
                          titleFromPayload={(row) => row?.prettyLabel}
                        />
                      )}
                    />
                    <Line
                      type="linear"
                      dataKey="revenue"
                      stroke="#4f46a5"
                      strokeWidth={2}
                      dot={{ r: 2, fill: '#4f46a5' }}
                      activeDot={{ r: 4 }}
                      isAnimationActive={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>
          <div className="rounded-2xl border border-slate-100 bg-white p-4 shadow-card h-72">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">Weekday Revenue</h3>
            </div>
            <div className="mt-3 h-56">
              {weekdayRows.every((row) => row.revenue === 0) ? (
                <NoChartData />
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={weekdayRows} margin={{ top: 8, right: 8, left: 8, bottom: 24 }}>
                    <CartesianGrid strokeDasharray="0" stroke="#e5e7eb" />
                    <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#6b7280' }} />
                    <YAxis tick={{ fontSize: 10, fill: '#6b7280' }} />
                    <Tooltip
                      content={(
                        <MoneyTooltip
                          formatter={fmtMoney}
                          titleFromPayload={(row) => row?.prettyLabel}
                        />
                      )}
                    />
                    <Bar dataKey="revenue" fill="#10b981" radius={[4, 4, 0, 0]} name="Revenue" />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>
        </div>
      )}

      {!loading && activeTab === 'branches' && (
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-soft overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-100">
              <tr><th className="px-2 py-2 text-left">Branch</th><th className="px-2 py-2 text-left">Revenue</th><th className="px-2 py-2 text-left">AOV</th><th className="px-2 py-2 text-left">Discount Rate</th><th className="px-2 py-2 text-left">Growth</th></tr>
            </thead>
            <tbody>
              {branchRows.map((row) => (
                <tr key={row.branch_id} className="border-b">
                  <td className="px-2 py-2">{row.branch_name}</td>
                  <td className="px-2 py-2">{fmtMoney(row.revenue)}</td>
                  <td className="px-2 py-2">{fmtMoney(row.aov)}</td>
                  <td className="px-2 py-2">{fmtPct(row.discount_rate_pct)}</td>
                  <td className="px-2 py-2">{fmtPct(row.revenue_growth_pct)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default Reporting;

