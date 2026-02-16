
const db = require('./db');

const ALLOWED_BUCKETS = new Set(['hour', 'day', 'week', 'month']);
const ALLOWED_ORDER_CHANNELS = new Set(['pos', 'online', 'whatsapp', 'delivery_platform']);
const ONLINE_CHANNELS = ['online', 'whatsapp', 'delivery_platform'];
const MAX_RANGE_DAYS = 366;
const DEFAULT_TIMEZONE = 'Asia/Karachi';

class ReportingValidationError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.name = 'ReportingValidationError';
    this.statusCode = statusCode;
  }
}

const toNumber = (value) => Number(value || 0);
const roundTwo = (value) => Number(Number(value || 0).toFixed(2));
const roundPercent = (value) => Number(Number(value || 0).toFixed(2));
const safeDivide = (numerator, denominator) => (denominator === 0 ? 0 : numerator / denominator);

const normalizeTimezone = (timezone) => {
  if (typeof timezone !== 'string' || !timezone.trim()) return DEFAULT_TIMEZONE;
  try {
    Intl.DateTimeFormat('en-US', { timeZone: timezone.trim() });
    return timezone.trim();
  } catch (err) {
    return DEFAULT_TIMEZONE;
  }
};

const normalizeBucket = (value, fallback = 'day') => {
  const normalized = String(value || fallback).trim().toLowerCase();
  if (!ALLOWED_BUCKETS.has(normalized)) return fallback;
  return normalized;
};

const parseDate = (value, fieldName) => {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new ReportingValidationError(`${fieldName} must be a valid ISO date/time`);
  }
  return parsed;
};

const parseDateRange = (query = {}) => {
  const now = new Date();
  const defaultFrom = new Date(now);
  defaultFrom.setDate(defaultFrom.getDate() - 30);

  const from = query.date_from ? parseDate(query.date_from, 'date_from') : defaultFrom;
  const to = query.date_to ? parseDate(query.date_to, 'date_to') : now;

  if (from >= to) {
    throw new ReportingValidationError('date_from must be earlier than date_to');
  }

  const diffMs = to.getTime() - from.getTime();
  const diffDays = diffMs / (1000 * 60 * 60 * 24);
  if (diffDays > MAX_RANGE_DAYS) {
    throw new ReportingValidationError(`date range cannot exceed ${MAX_RANGE_DAYS} days`);
  }

  const prevTo = new Date(from);
  const prevFrom = new Date(from.getTime() - diffMs);

  return {
    date_from: from.toISOString(),
    date_to: to.toISOString(),
    prev_date_from: prevFrom.toISOString(),
    prev_date_to: prevTo.toISOString(),
  };
};

const parseChannelFilter = (query = {}) => {
  const raw = String(query.order_channel || query.channel || '')
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
  if (!raw.length) return [];
  const invalid = raw.filter((entry) => !ALLOWED_ORDER_CHANNELS.has(entry));
  if (invalid.length) {
    throw new ReportingValidationError(`Invalid channel filter: ${invalid.join(', ')}`);
  }
  return Array.from(new Set(raw));
};

const ensureBranchIds = (branchIds) => {
  if (!Array.isArray(branchIds) || branchIds.length === 0) {
    throw new ReportingValidationError('At least one scoped branch is required', 400);
  }
  const normalized = branchIds
    .map((value) => Number(value))
    .filter((value) => Number.isInteger(value) && value > 0);

  if (!normalized.length) {
    throw new ReportingValidationError('At least one valid branch id is required', 400);
  }

  return Array.from(new Set(normalized));
};

const buildGrowthPct = (current, previous) => {
  if (previous === 0) return current > 0 ? 100 : 0;
  return roundPercent(((current - previous) / previous) * 100);
};

const buildRoiPct = (discountCost, generatedRevenue) => {
  if (discountCost === 0) return 0;
  return roundPercent(((generatedRevenue - discountCost) / discountCost) * 100);
};

const hasBranchesTable = async () => {
  const result = await db.query(
    `SELECT to_regclass('public.branches') IS NOT NULL AS exists_flag`
  );
  return Boolean(result.rows[0]?.exists_flag);
};

const BUCKET_SQL = {
  hour: "date_trunc('hour', timezone($4, o.created_at))",
  day: "date_trunc('day', timezone($4, o.created_at))",
  week: "date_trunc('week', timezone($4, o.created_at))",
  month: "date_trunc('month', timezone($4, o.created_at))",
};

const queryRevenueAggregate = async ({ branchIds, dateFrom, dateTo, channels = [] }) => {
  const channelClause = channels.length ? 'AND o.order_channel = ANY($4::text[])' : '';
  const baseParams = channels.length ? [branchIds, dateFrom, dateTo, channels] : [branchIds, dateFrom, dateTo];

  const completedResult = await db.query(
    `
    SELECT
      COALESCE(SUM(o.total), 0) AS total_collected,
      COALESCE(SUM(o.subtotal + o.tax), 0) AS gross_revenue,
      COALESCE(SUM(o.discount), 0) AS discount_amount,
      COUNT(*) AS order_count
    FROM orders o
    WHERE o.outlet_id = ANY($1::int[])
      AND o.deleted_at IS NULL
      AND o.status = 'completed'
      AND o.created_at >= $2
      AND o.created_at < $3
      ${channelClause}
    `,
    baseParams
  );

  const refundResult = await db.query(
    `
    SELECT
      COALESCE(SUM(o.total), 0) AS refunded_amount
    FROM orders o
    WHERE o.outlet_id = ANY($1::int[])
      AND o.deleted_at IS NULL
      AND o.status = 'refunded'
      AND COALESCE(o.refunded_at, o.updated_at, o.created_at) >= $2
      AND COALESCE(o.refunded_at, o.updated_at, o.created_at) < $3
      ${channelClause}
    `,
    baseParams
  );

  const row = completedResult.rows[0] || {};
  const refundedAmount = roundTwo(refundResult.rows[0]?.refunded_amount);
  const grossRevenue = roundTwo(row.gross_revenue);
  return {
    total_collected: roundTwo(row.total_collected),
    gross_revenue: grossRevenue,
    net_revenue: roundTwo(grossRevenue - refundedAmount),
    discount_amount: roundTwo(row.discount_amount),
    order_count: toNumber(row.order_count),
    refund_amount: refundedAmount,
  };
};

const getRevenueOverview = async ({ branchIds, query = {}, timezone = DEFAULT_TIMEZONE }) => {
  const scopedBranchIds = ensureBranchIds(branchIds);
  const range = parseDateRange(query);
  const channels = parseChannelFilter(query);
  const current = await queryRevenueAggregate({
    branchIds: scopedBranchIds,
    dateFrom: range.date_from,
    dateTo: range.date_to,
    channels,
  });
  const previous = await queryRevenueAggregate({
    branchIds: scopedBranchIds,
    dateFrom: range.prev_date_from,
    dateTo: range.prev_date_to,
    channels,
  });

  const discountImpactPct = roundPercent(safeDivide(current.discount_amount, current.gross_revenue) * 100);
  const aov = roundTwo(safeDivide(current.total_collected, current.order_count));

  return {
    branch_ids: scopedBranchIds,
    timezone: normalizeTimezone(timezone),
    period: {
      date_from: range.date_from,
      date_to: range.date_to,
      previous_date_from: range.prev_date_from,
      previous_date_to: range.prev_date_to,
    },
    total_collected: current.total_collected,
    gross_revenue: current.gross_revenue,
    net_revenue: current.net_revenue,
    refund_amount: current.refund_amount,
    discount_amount: current.discount_amount,
    discount_impact_pct: discountImpactPct,
    aov,
    revenue_growth_pct: buildGrowthPct(current.total_collected, previous.total_collected),
    previous_total_collected: previous.total_collected,
  };
};

const queryRevenueTrendByRange = async ({ branchIds, dateFrom, dateTo, bucket, timezone, channels = [] }) => {
  const bucketSql = BUCKET_SQL[bucket];
  const channelClause = channels.length ? 'AND o.order_channel = ANY($5::text[])' : '';
  const completedParams = channels.length
    ? [branchIds, dateFrom, dateTo, timezone, channels]
    : [branchIds, dateFrom, dateTo, timezone];
  const refundedBucketSql = bucketSql.replace(/o\.created_at/g, 'COALESCE(o.refunded_at, o.updated_at, o.created_at)');
  const refundedParams = completedParams;

  const completedResult = await db.query(
    `
    SELECT
      ${bucketSql} AS bucket_ts,
      COALESCE(SUM(o.total), 0) AS gross_revenue,
      COUNT(*) AS orders_count,
      COALESCE(SUM(o.discount), 0) AS discount_amount
    FROM orders o
    WHERE o.outlet_id = ANY($1::int[])
      AND o.deleted_at IS NULL
      AND o.status = 'completed'
      AND o.created_at >= $2
      AND o.created_at < $3
      ${channelClause}
    GROUP BY bucket_ts
    ORDER BY bucket_ts ASC
    `,
    completedParams
  );

  const refundedResult = await db.query(
    `
    SELECT
      ${refundedBucketSql} AS bucket_ts,
      COALESCE(SUM(o.total), 0) AS refund_amount
    FROM orders o
    WHERE o.outlet_id = ANY($1::int[])
      AND o.deleted_at IS NULL
      AND o.status = 'refunded'
      AND COALESCE(o.refunded_at, o.updated_at, o.created_at) >= $2
      AND COALESCE(o.refunded_at, o.updated_at, o.created_at) < $3
      ${channelClause}
    GROUP BY bucket_ts
    ORDER BY bucket_ts ASC
    `,
    refundedParams
  );

  const refundByBucket = new Map(
    refundedResult.rows.map((row) => [new Date(row.bucket_ts).toISOString(), roundTwo(row.refund_amount)])
  );

  return completedResult.rows.map((row) => {
    const key = new Date(row.bucket_ts).toISOString();
    const refundAmount = roundTwo(refundByBucket.get(key) || 0);
    const grossRevenue = roundTwo(row.gross_revenue);
    return {
      bucket_ts: row.bucket_ts,
      revenue: roundTwo(grossRevenue - refundAmount),
      gross_revenue: grossRevenue,
      refund_amount: refundAmount,
      orders_count: toNumber(row.orders_count),
      discount_amount: roundTwo(row.discount_amount),
    };
  });
};

const getRevenueTrend = async ({ branchIds, query = {}, timezone = DEFAULT_TIMEZONE }) => {
  const scopedBranchIds = ensureBranchIds(branchIds);
  const bucket = normalizeBucket(query.bucket, 'day');
  const range = parseDateRange(query);
  const normalizedTimezone = normalizeTimezone(timezone);
  const channels = parseChannelFilter(query);

  const [current, previous] = await Promise.all([
    queryRevenueTrendByRange({
      branchIds: scopedBranchIds,
      dateFrom: range.date_from,
      dateTo: range.date_to,
      bucket,
      timezone: normalizedTimezone,
      channels,
    }),
    queryRevenueTrendByRange({
      branchIds: scopedBranchIds,
      dateFrom: range.prev_date_from,
      dateTo: range.prev_date_to,
      bucket,
      timezone: normalizedTimezone,
      channels,
    }),
  ]);

  return {
    branch_ids: scopedBranchIds,
    bucket,
    timezone: normalizedTimezone,
    period: {
      date_from: range.date_from,
      date_to: range.date_to,
      previous_date_from: range.prev_date_from,
      previous_date_to: range.prev_date_to,
    },
    current,
    previous,
  };
};
const queryPaymentAggregate = async ({ branchIds, dateFrom, dateTo, channels = [] }) => {
  const channelClause = channels.length ? 'AND o.order_channel = ANY($4::text[])' : '';
  const params = channels.length ? [branchIds, dateFrom, dateTo, channels] : [branchIds, dateFrom, dateTo];
  const result = await db.query(
    `
    SELECT
      COALESCE(SUM(CASE WHEN o.payment_method = 'cash' THEN o.total ELSE 0 END), 0) AS cash_amount,
      COALESCE(SUM(CASE WHEN o.payment_method = 'card' THEN o.total ELSE 0 END), 0) AS card_amount,
      COALESCE(SUM(CASE WHEN o.payment_method = 'online' THEN o.total ELSE 0 END), 0) AS online_amount,
      SUM(CASE WHEN o.payment_method = 'cash' THEN 1 ELSE 0 END) AS cash_count,
      SUM(CASE WHEN o.payment_method = 'card' THEN 1 ELSE 0 END) AS card_count,
      SUM(CASE WHEN o.payment_method = 'online' THEN 1 ELSE 0 END) AS online_count
    FROM orders o
    WHERE o.outlet_id = ANY($1::int[])
      AND o.deleted_at IS NULL
      AND o.status = 'completed'
      AND o.created_at >= $2
      AND o.created_at < $3
      ${channelClause}
    `,
    params
  );
  const row = result.rows[0] || {};
  return {
    cash_amount: roundTwo(row.cash_amount),
    card_amount: roundTwo(row.card_amount),
    online_amount: roundTwo(row.online_amount),
    cash_count: toNumber(row.cash_count),
    card_count: toNumber(row.card_count),
    online_count: toNumber(row.online_count),
  };
};

const getPaymentOverview = async ({ branchIds, query = {}, timezone = DEFAULT_TIMEZONE }) => {
  const scopedBranchIds = ensureBranchIds(branchIds);
  const range = parseDateRange(query);
  const channels = parseChannelFilter(query);
  const current = await queryPaymentAggregate({
    branchIds: scopedBranchIds,
    dateFrom: range.date_from,
    dateTo: range.date_to,
    channels,
  });
  const previous = await queryPaymentAggregate({
    branchIds: scopedBranchIds,
    dateFrom: range.prev_date_from,
    dateTo: range.prev_date_to,
    channels,
  });

  const totalAmount = current.cash_amount + current.card_amount + current.online_amount;
  const payment_split = [
    {
      payment_method: 'cash',
      amount: current.cash_amount,
      count: current.cash_count,
      amount_pct: roundPercent(safeDivide(current.cash_amount, totalAmount) * 100),
    },
    {
      payment_method: 'card',
      amount: current.card_amount,
      count: current.card_count,
      amount_pct: roundPercent(safeDivide(current.card_amount, totalAmount) * 100),
    },
    {
      payment_method: 'online',
      amount: current.online_amount,
      count: current.online_count,
      amount_pct: roundPercent(safeDivide(current.online_amount, totalAmount) * 100),
    },
  ];

  return {
    branch_ids: scopedBranchIds,
    timezone: normalizeTimezone(timezone),
    period: {
      date_from: range.date_from,
      date_to: range.date_to,
      previous_date_from: range.prev_date_from,
      previous_date_to: range.prev_date_to,
    },
    ...current,
    payment_split,
    card_growth_pct: buildGrowthPct(current.card_amount, previous.card_amount),
  };
};

const getPaymentTrend = async ({ branchIds, query = {}, timezone = DEFAULT_TIMEZONE }) => {
  const scopedBranchIds = ensureBranchIds(branchIds);
  const bucket = normalizeBucket(query.bucket, 'day');
  const range = parseDateRange(query);
  const normalizedTimezone = normalizeTimezone(timezone);
  const channels = parseChannelFilter(query);
  const bucketSql = BUCKET_SQL[bucket];
  const channelClause = channels.length ? 'AND o.order_channel = ANY($5::text[])' : '';
  const params = channels.length
    ? [scopedBranchIds, range.date_from, range.date_to, normalizedTimezone, channels]
    : [scopedBranchIds, range.date_from, range.date_to, normalizedTimezone];

  const result = await db.query(
    `
    SELECT
      ${bucketSql} AS bucket_ts,
      o.payment_method,
      COUNT(*) AS orders_count,
      COALESCE(SUM(o.total), 0) AS amount
    FROM orders o
    WHERE o.outlet_id = ANY($1::int[])
      AND o.deleted_at IS NULL
      AND o.status = 'completed'
      AND o.created_at >= $2
      AND o.created_at < $3
      ${channelClause}
    GROUP BY bucket_ts, o.payment_method
    ORDER BY bucket_ts ASC
    `,
    params
  );

  const buckets = new Map();
  result.rows.forEach((row) => {
    const key = new Date(row.bucket_ts).toISOString();
    const current = buckets.get(key) || {
      bucket_ts: row.bucket_ts,
      cash_amount: 0,
      cash_count: 0,
      card_amount: 0,
      card_count: 0,
      online_amount: 0,
      online_count: 0,
    };

    const method = row.payment_method;
    const amount = roundTwo(row.amount);
    const count = toNumber(row.orders_count);

    if (method === 'cash') {
      current.cash_amount += amount;
      current.cash_count += count;
    } else if (method === 'card') {
      current.card_amount += amount;
      current.card_count += count;
    } else {
      current.online_amount += amount;
      current.online_count += count;
    }

    buckets.set(key, current);
  });

  return {
    branch_ids: scopedBranchIds,
    bucket,
    timezone: normalizedTimezone,
    period: {
      date_from: range.date_from,
      date_to: range.date_to,
    },
    data: Array.from(buckets.values()).sort((a, b) => new Date(a.bucket_ts) - new Date(b.bucket_ts)),
  };
};

const getDiscountOverview = async ({ branchIds, query = {}, timezone = DEFAULT_TIMEZONE }) => {
  const scopedBranchIds = ensureBranchIds(branchIds);
  const range = parseDateRange(query);

  const result = await db.query(
    `
    SELECT
      COALESCE(SUM(CASE WHEN o.promo_code_id IS NOT NULL THEN o.total ELSE 0 END), 0) AS promo_revenue,
      COALESCE(SUM(CASE WHEN o.bulk_discount_amount > 0 THEN o.total ELSE 0 END), 0) AS bulk_discount_revenue,
      COALESCE(SUM(o.discount), 0) AS discount_cost_total,
      COALESCE(SUM(CASE WHEN o.discount > 0 THEN o.total ELSE 0 END), 0) AS discount_generated_revenue
    FROM orders o
    WHERE o.outlet_id = ANY($1::int[])
      AND o.deleted_at IS NULL
      AND o.status = 'completed'
      AND o.created_at >= $2
      AND o.created_at < $3
    `,
    [scopedBranchIds, range.date_from, range.date_to]
  );

  const row = result.rows[0] || {};
  const promoRevenue = roundTwo(row.promo_revenue);
  const bulkRevenue = roundTwo(row.bulk_discount_revenue);
  const discountCost = roundTwo(row.discount_cost_total);
  const generatedRevenue = roundTwo(row.discount_generated_revenue);

  return {
    branch_ids: scopedBranchIds,
    timezone: normalizeTimezone(timezone),
    period: {
      date_from: range.date_from,
      date_to: range.date_to,
    },
    promo_revenue: promoRevenue,
    bulk_discount_revenue: bulkRevenue,
    discount_cost_total: discountCost,
    discount_generated_revenue: generatedRevenue,
    discount_roi_pct: buildRoiPct(discountCost, generatedRevenue),
  };
};

const getDiscountDeals = async ({ branchIds, query = {}, timezone = DEFAULT_TIMEZONE }) => {
  const scopedBranchIds = ensureBranchIds(branchIds);
  const range = parseDateRange(query);
  const limit = Math.min(Math.max(Number(query.limit) || 10, 1), 50);

  const promoResult = await db.query(
    `
    SELECT
      pc.code AS deal_name,
      COUNT(*) AS orders_count,
      COALESCE(SUM(o.total), 0) AS revenue,
      COALESCE(SUM(o.promo_discount_amount), 0) AS discount_cost,
      COALESCE(AVG(o.total), 0) AS avg_order_value
    FROM orders o
    JOIN promo_codes pc ON pc.id = o.promo_code_id
    WHERE o.outlet_id = ANY($1::int[])
      AND o.deleted_at IS NULL
      AND o.status = 'completed'
      AND o.created_at >= $2
      AND o.created_at < $3
      AND o.promo_code_id IS NOT NULL
    GROUP BY pc.code
    ORDER BY revenue DESC, orders_count DESC
    LIMIT $4
    `,
    [scopedBranchIds, range.date_from, range.date_to, limit]
  );

  const promo_codes = promoResult.rows.map((row) => {
    const revenue = roundTwo(row.revenue);
    const discountCost = roundTwo(row.discount_cost);
    return {
      deal_name: row.deal_name,
      orders_count: toNumber(row.orders_count),
      revenue,
      discount_cost: discountCost,
      roi_pct: buildRoiPct(discountCost, revenue),
      avg_order_value: roundTwo(row.avg_order_value),
    };
  });

  const bulkResult = await db.query(
    `
    SELECT
      COUNT(*) AS orders_count,
      COALESCE(SUM(o.total), 0) AS revenue,
      COALESCE(SUM(o.bulk_discount_amount), 0) AS discount_cost,
      COALESCE(AVG(o.total), 0) AS avg_order_value
    FROM orders o
    WHERE o.outlet_id = ANY($1::int[])
      AND o.deleted_at IS NULL
      AND o.status = 'completed'
      AND o.created_at >= $2
      AND o.created_at < $3
      AND o.bulk_discount_amount > 0
    `,
    [scopedBranchIds, range.date_from, range.date_to]
  );

  const bulkRow = bulkResult.rows[0] || {};
  const bulkRevenue = roundTwo(bulkRow.revenue);
  const bulkCost = roundTwo(bulkRow.discount_cost);
  const bulk_deals = [
    {
      deal_name: 'Automatic Bulk Discounts',
      orders_count: toNumber(bulkRow.orders_count),
      revenue: bulkRevenue,
      discount_cost: bulkCost,
      roi_pct: buildRoiPct(bulkCost, bulkRevenue),
      avg_order_value: roundTwo(bulkRow.avg_order_value),
    },
  ];

  return {
    branch_ids: scopedBranchIds,
    timezone: normalizeTimezone(timezone),
    period: {
      date_from: range.date_from,
      date_to: range.date_to,
    },
    promo_codes,
    bulk_deals,
    top_promo_code: promo_codes[0] || null,
  };
};
const getProductsIntelligence = async ({ branchIds, query = {}, timezone = DEFAULT_TIMEZONE }) => {
  const scopedBranchIds = ensureBranchIds(branchIds);
  const range = parseDateRange(query);
  const limit = Math.min(Math.max(Number(query.limit) || 10, 1), 50);
  const summaryPromise = db.query(
    `
    SELECT
      COALESCE(SUM(oi.total_price), 0) AS total_cash,
      COALESCE(SUM(oi.quantity * COALESCE(p.profit_value, 0)), 0) AS total_profit
    FROM order_items oi
    JOIN orders o ON o.id = oi.order_id
    LEFT JOIN products p ON p.id = oi.product_id
    WHERE o.outlet_id = ANY($1::int[])
      AND o.deleted_at IS NULL
      AND o.status = 'completed'
      AND o.created_at >= $2
      AND o.created_at < $3
    `,
    [scopedBranchIds, range.date_from, range.date_to]
  );

  const topByRevenuePromise = db.query(
    `
    SELECT
      oi.product_id,
      COALESCE(MAX(oi.product_name), MAX(p.name), 'Unknown') AS product_name,
      COALESCE(MAX(c.name), MAX(s.name), 'Uncategorized') AS category_name,
      SUM(oi.quantity) AS units_sold,
      COALESCE(SUM(oi.total_price), 0) AS revenue,
      COALESCE(SUM(CASE WHEN o.subtotal > 0 THEN (oi.total_price / o.subtotal) * o.discount ELSE 0 END), 0) AS discount_impact,
      COALESCE(SUM(oi.quantity * COALESCE(p.cost_price, 0)), 0) AS estimated_cost,
      COALESCE(SUM(oi.quantity * COALESCE(p.profit_value, 0)), 0) AS estimated_profit
    FROM order_items oi
    JOIN orders o ON o.id = oi.order_id
    LEFT JOIN products p ON p.id = oi.product_id
    LEFT JOIN sections s ON s.id = p.section_id
    LEFT JOIN categories c ON c.id = p.category_id
    WHERE o.outlet_id = ANY($1::int[])
      AND o.deleted_at IS NULL
      AND o.status = 'completed'
      AND o.created_at >= $2
      AND o.created_at < $3
    GROUP BY oi.product_id
    ORDER BY revenue DESC
    LIMIT $4
    `,
    [scopedBranchIds, range.date_from, range.date_to, limit]
  );

  const topByQuantityPromise = db.query(
    `
    SELECT
      oi.product_id,
      COALESCE(MAX(oi.product_name), MAX(p.name), 'Unknown') AS product_name,
      SUM(oi.quantity) AS units_sold,
      COALESCE(SUM(oi.total_price), 0) AS revenue
    FROM order_items oi
    JOIN orders o ON o.id = oi.order_id
    LEFT JOIN products p ON p.id = oi.product_id
    WHERE o.outlet_id = ANY($1::int[])
      AND o.deleted_at IS NULL
      AND o.status = 'completed'
      AND o.created_at >= $2
      AND o.created_at < $3
    GROUP BY oi.product_id
    ORDER BY units_sold DESC
    LIMIT $4
    `,
    [scopedBranchIds, range.date_from, range.date_to, limit]
  );

  const discountImpactPromise = db.query(
    `
    SELECT
      oi.product_id,
      COALESCE(MAX(oi.product_name), MAX(p.name), 'Unknown') AS product_name,
      COALESCE(SUM(CASE WHEN o.subtotal > 0 THEN (oi.total_price / o.subtotal) * o.discount ELSE 0 END), 0) AS discount_impact,
      COALESCE(SUM(oi.total_price), 0) AS revenue
    FROM order_items oi
    JOIN orders o ON o.id = oi.order_id
    LEFT JOIN products p ON p.id = oi.product_id
    WHERE o.outlet_id = ANY($1::int[])
      AND o.deleted_at IS NULL
      AND o.status = 'completed'
      AND o.created_at >= $2
      AND o.created_at < $3
      AND o.discount > 0
    GROUP BY oi.product_id
    ORDER BY discount_impact DESC
    LIMIT $4
    `,
    [scopedBranchIds, range.date_from, range.date_to, limit]
  );

  const decliningMomentumPromise = db.query(
    `
    WITH current_period AS (
      SELECT
        oi.product_id,
        COALESCE(SUM(oi.total_price), 0) AS revenue
      FROM order_items oi
      JOIN orders o ON o.id = oi.order_id
      WHERE o.outlet_id = ANY($1::int[])
        AND o.deleted_at IS NULL
        AND o.status = 'completed'
        AND o.created_at >= $2
        AND o.created_at < $3
      GROUP BY oi.product_id
    ),
    previous_period AS (
      SELECT
        oi.product_id,
        COALESCE(SUM(oi.total_price), 0) AS revenue
      FROM order_items oi
      JOIN orders o ON o.id = oi.order_id
      WHERE o.outlet_id = ANY($1::int[])
        AND o.deleted_at IS NULL
        AND o.status = 'completed'
        AND o.created_at >= $4
        AND o.created_at < $5
      GROUP BY oi.product_id
    )
    SELECT
      COALESCE(c.product_id, p.product_id) AS product_id,
      COALESCE(MAX(pr.name), MAX(oi.product_name), 'Unknown') AS product_name,
      COALESCE(c.revenue, 0) AS current_revenue,
      COALESCE(p.revenue, 0) AS previous_revenue,
      COALESCE(c.revenue, 0) - COALESCE(p.revenue, 0) AS revenue_delta
    FROM current_period c
    FULL OUTER JOIN previous_period p ON p.product_id = c.product_id
    LEFT JOIN products pr ON pr.id = COALESCE(c.product_id, p.product_id)
    LEFT JOIN order_items oi ON oi.product_id = COALESCE(c.product_id, p.product_id)
    GROUP BY COALESCE(c.product_id, p.product_id), c.revenue, p.revenue
    HAVING COALESCE(c.revenue, 0) < COALESCE(p.revenue, 0)
    ORDER BY revenue_delta ASC
    LIMIT $6
    `,
    [
      scopedBranchIds,
      range.date_from,
      range.date_to,
      range.prev_date_from,
      range.prev_date_to,
      limit,
    ]
  );

  const categorySharePromise = db.query(
    `
    SELECT
      COALESCE(c.name, s.name, 'Uncategorized') AS category_name,
      COALESCE(SUM(oi.total_price), 0) AS revenue
    FROM order_items oi
    JOIN orders o ON o.id = oi.order_id
    LEFT JOIN products p ON p.id = oi.product_id
    LEFT JOIN categories c ON c.id = p.category_id
    LEFT JOIN sections s ON s.id = p.section_id
    WHERE o.outlet_id = ANY($1::int[])
      AND o.deleted_at IS NULL
      AND o.status = 'completed'
      AND o.created_at >= $2
      AND o.created_at < $3
    GROUP BY COALESCE(c.name, s.name, 'Uncategorized')
    ORDER BY revenue DESC
    `,
    [scopedBranchIds, range.date_from, range.date_to]
  );

  const [summaryResult, topByRevenueResult, topByQuantityResult, discountImpactResult, decliningMomentumResult, categoryShareResult] =
    await Promise.all([
      summaryPromise,
      topByRevenuePromise,
      topByQuantityPromise,
      discountImpactPromise,
      decliningMomentumPromise,
      categorySharePromise,
    ]);

  const top_by_revenue = topByRevenueResult.rows.map((row) => ({
    product_id: toNumber(row.product_id),
    product_name: row.product_name,
    category_name: row.category_name,
    units_sold: toNumber(row.units_sold),
    revenue: roundTwo(row.revenue),
    discount_impact: roundTwo(row.discount_impact),
    estimated_cost: roundTwo(row.estimated_cost),
    estimated_profit: roundTwo(row.estimated_profit),
  }));

  const top_by_quantity = topByQuantityResult.rows.map((row) => ({
    product_id: toNumber(row.product_id),
    product_name: row.product_name,
    units_sold: toNumber(row.units_sold),
    revenue: roundTwo(row.revenue),
  }));
  const most_running_product = top_by_quantity[0] || null;

  const highest_discount_impact = discountImpactResult.rows.map((row) => ({
    product_id: toNumber(row.product_id),
    product_name: row.product_name,
    discount_impact: roundTwo(row.discount_impact),
    revenue: roundTwo(row.revenue),
  }));

  const declining_momentum = decliningMomentumResult.rows.map((row) => ({
    product_id: toNumber(row.product_id),
    product_name: row.product_name,
    current_revenue: roundTwo(row.current_revenue),
    previous_revenue: roundTwo(row.previous_revenue),
    revenue_delta: roundTwo(row.revenue_delta),
  }));

  const categoryTotalRevenue = categoryShareResult.rows.reduce((sum, row) => sum + toNumber(row.revenue), 0);
  const category_revenue_share = categoryShareResult.rows.map((row) => {
    const revenue = roundTwo(row.revenue);
    return {
      category_name: row.category_name,
      revenue,
      percent: roundPercent(safeDivide(revenue, categoryTotalRevenue) * 100),
    };
  });
  const summaryRow = summaryResult.rows[0] || {};
  const total_cash = roundTwo(summaryRow.total_cash);
  const total_profit = roundTwo(summaryRow.total_profit);

  return {
    branch_ids: scopedBranchIds,
    timezone: normalizeTimezone(timezone),
    period: {
      date_from: range.date_from,
      date_to: range.date_to,
      previous_date_from: range.prev_date_from,
      previous_date_to: range.prev_date_to,
    },
    total_cash,
    total_profit,
    most_running_product,
    top_by_revenue,
    top_by_quantity,
    highest_discount_impact,
    declining_momentum,
    category_revenue_share,
    summary: {
      total_cash,
      total_profit,
      most_running_product,
    },
  };
};

const getTimeAnalysis = async ({ branchIds, query = {}, timezone = DEFAULT_TIMEZONE }) => {
  const scopedBranchIds = ensureBranchIds(branchIds);
  const range = parseDateRange(query);
  const normalizedTimezone = normalizeTimezone(timezone);

  const hourlyPromise = db.query(
    `
    SELECT
      EXTRACT(HOUR FROM timezone($4, o.created_at))::int AS hour_of_day,
      COUNT(*) AS orders_count,
      COALESCE(SUM(o.total), 0) AS revenue
    FROM orders o
    WHERE o.outlet_id = ANY($1::int[])
      AND o.deleted_at IS NULL
      AND o.status = 'completed'
      AND o.created_at >= $2
      AND o.created_at < $3
    GROUP BY hour_of_day
    ORDER BY hour_of_day ASC
    `,
    [scopedBranchIds, range.date_from, range.date_to, normalizedTimezone]
  );

  const weekdayPromise = db.query(
    `
    SELECT
      EXTRACT(DOW FROM timezone($4, o.created_at))::int AS day_of_week,
      COUNT(*) AS orders_count,
      COALESCE(SUM(o.total), 0) AS revenue
    FROM orders o
    WHERE o.outlet_id = ANY($1::int[])
      AND o.deleted_at IS NULL
      AND o.status = 'completed'
      AND o.created_at >= $2
      AND o.created_at < $3
    GROUP BY day_of_week
    ORDER BY day_of_week ASC
    `,
    [scopedBranchIds, range.date_from, range.date_to, normalizedTimezone]
  );

  const heatmapPromise = db.query(
    `
    SELECT
      EXTRACT(DOW FROM timezone($4, o.created_at))::int AS day_of_week,
      EXTRACT(HOUR FROM timezone($4, o.created_at))::int AS hour_of_day,
      COUNT(*) AS orders_count,
      COALESCE(SUM(o.total), 0) AS revenue
    FROM orders o
    WHERE o.outlet_id = ANY($1::int[])
      AND o.deleted_at IS NULL
      AND o.status = 'completed'
      AND o.created_at >= $2
      AND o.created_at < $3
    GROUP BY day_of_week, hour_of_day
    ORDER BY day_of_week ASC, hour_of_day ASC
    `,
    [scopedBranchIds, range.date_from, range.date_to, normalizedTimezone]
  );

  const monthlyPromise = db.query(
    `
    SELECT
      date_trunc('month', timezone($4, o.created_at)) AS month_bucket,
      COUNT(*) AS orders_count,
      COALESCE(SUM(o.total), 0) AS revenue
    FROM orders o
    WHERE o.outlet_id = ANY($1::int[])
      AND o.deleted_at IS NULL
      AND o.status = 'completed'
      AND o.created_at >= $2
      AND o.created_at < $3
    GROUP BY month_bucket
    ORDER BY month_bucket ASC
    `,
    [scopedBranchIds, range.date_from, range.date_to, normalizedTimezone]
  );

  const [hourlyResult, weekdayResult, heatmapResult, monthlyResult] = await Promise.all([
    hourlyPromise,
    weekdayPromise,
    heatmapPromise,
    monthlyPromise,
  ]);

  const hourly_sales = Array.from({ length: 24 }, (_, hour) => {
    const row = hourlyResult.rows.find((entry) => toNumber(entry.hour_of_day) === hour);
    return {
      hour_of_day: hour,
      orders_count: row ? toNumber(row.orders_count) : 0,
      revenue: row ? roundTwo(row.revenue) : 0,
    };
  });

  const weekday_sales = Array.from({ length: 7 }, (_, day) => {
    const row = weekdayResult.rows.find((entry) => toNumber(entry.day_of_week) === day);
    return {
      day_of_week: day,
      orders_count: row ? toNumber(row.orders_count) : 0,
      revenue: row ? roundTwo(row.revenue) : 0,
    };
  });

  const heatmap = heatmapResult.rows.map((row) => ({
    day_of_week: toNumber(row.day_of_week),
    hour_of_day: toNumber(row.hour_of_day),
    orders_count: toNumber(row.orders_count),
    revenue: roundTwo(row.revenue),
  }));

  const monthly_growth = monthlyResult.rows.map((row, index) => {
    const revenue = roundTwo(row.revenue);
    const previous = index > 0 ? roundTwo(monthlyResult.rows[index - 1].revenue) : 0;
    return {
      month_bucket: row.month_bucket,
      orders_count: toNumber(row.orders_count),
      revenue,
      growth_pct: index > 0 ? buildGrowthPct(revenue, previous) : 0,
    };
  });

  return {
    branch_ids: scopedBranchIds,
    timezone: normalizedTimezone,
    period: {
      date_from: range.date_from,
      date_to: range.date_to,
    },
    hourly_sales,
    weekday_sales,
    heatmap,
    monthly_growth,
  };
};
const getBranchComparison = async ({ branchIds, query = {}, timezone = DEFAULT_TIMEZONE }) => {
  const scopedBranchIds = ensureBranchIds(branchIds);
  if (scopedBranchIds.length < 2) {
    throw new ReportingValidationError('At least two branches are required for branch comparison');
  }

  const range = parseDateRange(query);
  const normalizedTimezone = normalizeTimezone(timezone);

  const branchTableExists = await hasBranchesTable();
  const summaryPromise = branchTableExists
    ? db.query(
        `
        SELECT
          o.outlet_id,
          COALESCE(br.name, format('Branch %s', o.outlet_id)) AS branch_name,
          COUNT(*) AS orders_count,
          COALESCE(SUM(o.total), 0) AS revenue,
          COALESCE(SUM(o.discount), 0) AS discount_amount,
          COALESCE(AVG(o.total), 0) AS aov
        FROM orders o
        LEFT JOIN branches br
          ON br.id = o.outlet_id
          AND br.deleted_at IS NULL
        WHERE o.outlet_id = ANY($1::int[])
          AND o.deleted_at IS NULL
          AND o.status = 'completed'
          AND o.created_at >= $2
          AND o.created_at < $3
        GROUP BY o.outlet_id, COALESCE(br.name, format('Branch %s', o.outlet_id))
        ORDER BY revenue DESC
        `,
        [scopedBranchIds, range.date_from, range.date_to]
      )
    : db.query(
        `
        SELECT
          o.outlet_id,
          format('Branch %s', o.outlet_id) AS branch_name,
          COUNT(*) AS orders_count,
          COALESCE(SUM(o.total), 0) AS revenue,
          COALESCE(SUM(o.discount), 0) AS discount_amount,
          COALESCE(AVG(o.total), 0) AS aov
        FROM orders o
        WHERE o.outlet_id = ANY($1::int[])
          AND o.deleted_at IS NULL
          AND o.status = 'completed'
          AND o.created_at >= $2
          AND o.created_at < $3
        GROUP BY o.outlet_id
        ORDER BY revenue DESC
        `,
        [scopedBranchIds, range.date_from, range.date_to]
      );

  const paymentPromise = db.query(
    `
    SELECT
      o.outlet_id,
      o.payment_method,
      COUNT(*) AS orders_count,
      COALESCE(SUM(o.total), 0) AS revenue
    FROM orders o
    WHERE o.outlet_id = ANY($1::int[])
      AND o.deleted_at IS NULL
      AND o.status = 'completed'
      AND o.created_at >= $2
      AND o.created_at < $3
    GROUP BY o.outlet_id, o.payment_method
    `,
    [scopedBranchIds, range.date_from, range.date_to]
  );

  const previousRevenuePromise = db.query(
    `
    SELECT
      o.outlet_id,
      COALESCE(SUM(o.total), 0) AS revenue
    FROM orders o
    WHERE o.outlet_id = ANY($1::int[])
      AND o.deleted_at IS NULL
      AND o.status = 'completed'
      AND o.created_at >= $2
      AND o.created_at < $3
    GROUP BY o.outlet_id
    `,
    [scopedBranchIds, range.prev_date_from, range.prev_date_to]
  );

  const [summaryResult, paymentResult, previousResult] = await Promise.all([
    summaryPromise,
    paymentPromise,
    previousRevenuePromise,
  ]);

  const previousRevenueMap = new Map(
    previousResult.rows.map((row) => [toNumber(row.outlet_id), roundTwo(row.revenue)])
  );

  const paymentsByBranch = new Map();
  paymentResult.rows.forEach((row) => {
    const branchId = toNumber(row.outlet_id);
    const existing = paymentsByBranch.get(branchId) || {
      cash_amount: 0,
      card_amount: 0,
      online_amount: 0,
      cash_count: 0,
      card_count: 0,
      online_count: 0,
    };

    const amount = roundTwo(row.revenue);
    const count = toNumber(row.orders_count);

    if (row.payment_method === 'cash') {
      existing.cash_amount += amount;
      existing.cash_count += count;
    } else if (row.payment_method === 'card') {
      existing.card_amount += amount;
      existing.card_count += count;
    } else {
      existing.online_amount += amount;
      existing.online_count += count;
    }

    paymentsByBranch.set(branchId, existing);
  });

  const branches = summaryResult.rows.map((row) => {
    const branchId = toNumber(row.outlet_id);
    const revenue = roundTwo(row.revenue);
    const discountAmount = roundTwo(row.discount_amount);
    const payment = paymentsByBranch.get(branchId) || {
      cash_amount: 0,
      card_amount: 0,
      online_amount: 0,
      cash_count: 0,
      card_count: 0,
      online_count: 0,
    };

    const totalPaymentAmount = payment.cash_amount + payment.card_amount + payment.online_amount;

    return {
      branch_id: branchId,
      branch_name: row.branch_name,
      orders_count: toNumber(row.orders_count),
      revenue,
      discount_rate_pct: roundPercent(safeDivide(discountAmount, revenue + discountAmount) * 100),
      aov: roundTwo(row.aov),
      revenue_growth_pct: buildGrowthPct(revenue, previousRevenueMap.get(branchId) || 0),
      payment_distribution: {
        cash_amount: payment.cash_amount,
        card_amount: payment.card_amount,
        online_amount: payment.online_amount,
        cash_count: payment.cash_count,
        card_count: payment.card_count,
        online_count: payment.online_count,
        cash_pct: roundPercent(safeDivide(payment.cash_amount, totalPaymentAmount) * 100),
        card_pct: roundPercent(safeDivide(payment.card_amount, totalPaymentAmount) * 100),
        online_pct: roundPercent(safeDivide(payment.online_amount, totalPaymentAmount) * 100),
      },
    };
  });

  return {
    branch_ids: scopedBranchIds,
    timezone: normalizedTimezone,
    period: {
      date_from: range.date_from,
      date_to: range.date_to,
      previous_date_from: range.prev_date_from,
      previous_date_to: range.prev_date_to,
    },
    branches,
  };
};

module.exports = {
  ReportingValidationError,
  normalizeBucket,
  normalizeTimezone,
  parseDateRange,
  getRevenueOverview,
  getRevenueTrend,
  getPaymentOverview,
  getPaymentTrend,
  getDiscountOverview,
  getDiscountDeals,
  getProductsIntelligence,
  getTimeAnalysis,
  getBranchComparison,
};


