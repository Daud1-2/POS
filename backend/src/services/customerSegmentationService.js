const db = require('./db');

const SEGMENTS = new Set([
  'champions',
  'loyal_customers',
  'need_attention',
  'at_risk',
  'hibernating',
  'all',
]);
const SEGMENT_GROUPS = new Set(['risk', 'loyal']);
const RISK_AFTER_DAYS = 30;

const SORT_FIELDS = {
  customer_name: 's.customer_name',
  phone: 's.phone',
  total_orders: 's.total_orders',
  total_revenue: 's.total_revenue',
  first_ordered_at: 's.first_ordered_at',
  last_ordered_at: 's.last_ordered_at',
  clv_90d: 's.clv_90d',
  churn_risk_score: 's.churn_risk_score',
  spend_potential_score: 's.spend_potential_score',
  segment: 's.segment',
};

const DEFAULT_SORT = 'last_ordered_at';

const SEGMENT_BASE_CTE = `
WITH scoped_orders AS (
  SELECT
    o.id,
    o.customer_id,
    o.total,
    o.created_at,
    NULLIF(TRIM(COALESCE(
      o.customer_name_snapshot,
      o.metadata->>'customer_name',
      o.metadata->>'customerName',
      o.metadata->>'name'
    )), '') AS snapshot_name,
    NULLIF(TRIM(COALESCE(
      o.customer_phone_snapshot,
      o.metadata->>'customer_phone',
      o.metadata->>'customerPhone',
      o.metadata->>'phone'
    )), '') AS snapshot_phone,
    LOWER(NULLIF(TRIM(COALESCE(
      o.customer_email_snapshot,
      o.metadata->>'customer_email',
      o.metadata->>'customerEmail',
      o.metadata->>'email'
    )), '')) AS snapshot_email
  FROM orders o
  WHERE o.outlet_id = $1
    AND o.deleted_at IS NULL
    AND o.status = 'completed'
),
aggregated AS (
  SELECT
    COALESCE(so.customer_id, 0) AS customer_key,
    NULLIF(MAX(so.customer_id), 0) AS customer_id,
    COUNT(*)::int AS total_orders,
    COALESCE(SUM(so.total), 0)::numeric(12,2) AS total_revenue,
    MIN(so.created_at) AS first_ordered_at,
    MAX(so.created_at) AS last_ordered_at,
    COUNT(*) FILTER (WHERE so.created_at >= now() - interval '180 day')::int AS orders_180d,
    COALESCE(SUM(so.total) FILTER (WHERE so.created_at >= now() - interval '180 day'), 0)::numeric(12,2) AS revenue_180d,
    MAX(so.snapshot_name) AS fallback_name,
    MAX(so.snapshot_phone) AS fallback_phone,
    MAX(so.snapshot_email) AS fallback_email
  FROM scoped_orders so
  GROUP BY COALESCE(so.customer_id, 0)
),
joined AS (
  SELECT
    a.customer_key,
    a.customer_id,
    COALESCE(c.full_name, a.fallback_name, CASE WHEN a.customer_id IS NULL THEN 'Unidentified Guests' ELSE 'Unknown Customer' END) AS customer_name,
    COALESCE(c.phone_e164, a.fallback_phone) AS phone,
    COALESCE(c.email, a.fallback_email) AS email,
    COALESCE(c.customer_type, CASE WHEN a.customer_id IS NULL THEN 'unidentified' ELSE 'guest' END) AS customer_type,
    a.total_orders,
    a.total_revenue,
    a.first_ordered_at,
    a.last_ordered_at,
    a.orders_180d,
    a.revenue_180d,
    GREATEST(EXTRACT(EPOCH FROM (now() - a.last_ordered_at)) / 86400.0, 0) AS recency_days
  FROM aggregated a
  LEFT JOIN customers c
    ON c.id = a.customer_id
    AND c.outlet_id = $1
    AND c.deleted_at IS NULL
),
rfm AS (
  SELECT
    j.*,
    (6 - ntile(5) OVER (ORDER BY j.recency_days ASC, j.last_ordered_at DESC))::int AS r_score,
    ntile(5) OVER (ORDER BY j.orders_180d ASC, j.total_orders ASC)::int AS f_score,
    ntile(5) OVER (ORDER BY j.revenue_180d ASC, j.total_revenue ASC)::int AS m_score
  FROM joined j
),
scored AS (
  SELECT
    r.customer_key,
    r.customer_id,
    r.customer_name,
    r.phone,
    r.email,
    r.customer_type,
    r.total_orders,
    r.total_revenue,
    r.first_ordered_at,
    r.last_ordered_at,
    r.orders_180d,
    r.revenue_180d,
    r.recency_days,
    r.r_score,
    r.f_score,
    r.m_score,
    CASE
      WHEN r.r_score >= 4 AND r.f_score >= 4 AND r.m_score >= 4 THEN 'champions'
      WHEN r.r_score >= 3 AND r.f_score >= 4 AND r.m_score >= 3 THEN 'loyal_customers'
      WHEN r.r_score IN (2, 3) AND (r.f_score >= 2 OR r.m_score >= 2) THEN 'need_attention'
      WHEN r.r_score = 1 AND (r.f_score >= 3 OR r.m_score >= 3) THEN 'at_risk'
      ELSE 'hibernating'
    END AS segment,
    ROUND((
      (r.total_revenue / GREATEST(r.total_orders, 1))
      * (r.total_orders / GREATEST((EXTRACT(EPOCH FROM (r.last_ordered_at - r.first_ordered_at)) / 86400.0) / 30.0, 1))
      * 3
      * EXP(-(r.recency_days / 90.0))
    )::numeric, 2) AS clv_90d
  FROM rfm r
),
normalized AS (
  SELECT
    s.*,
    LEAST(100, GREATEST(0, ROUND(
      (LEAST(s.recency_days, 180) / 180.0) * 60
      + (1 - LEAST(s.total_orders, 20) / 20.0) * 20
      + (1 - LEAST(s.revenue_180d, 20000) / 20000.0) * 20
    )))::int AS churn_risk_score,
    LEAST(100, GREATEST(0, ROUND(
      (LEAST(s.clv_90d, 5000) / 5000.0) * 70
      + (s.r_score / 5.0) * 30
    )))::int AS spend_potential_score,
    CASE
      WHEN s.total_revenue >= 10000 OR s.segment = 'champions' THEN TRUE
      ELSE FALSE
    END AS is_high_value
  FROM scored s
)
`;

class CustomerSegmentationError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.name = 'CustomerSegmentationError';
    this.statusCode = statusCode;
  }
}

const toPositiveInt = (value, fieldName, { required = false } = {}) => {
  if (value === undefined || value === null || value === '') {
    if (required) throw new CustomerSegmentationError(`${fieldName} is required`);
    return null;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new CustomerSegmentationError(`${fieldName} must be a positive integer`);
  }
  return parsed;
};

const toBool = (value, fallback = false) => {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  if (value === 'true' || value === '1' || value === 1) return true;
  if (value === 'false' || value === '0' || value === 0) return false;
  return fallback;
};

const toNumber = (value, fieldName, { min = null, max = null } = {}) => {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new CustomerSegmentationError(`${fieldName} must be a valid number`);
  }
  if (min !== null && parsed < min) {
    throw new CustomerSegmentationError(`${fieldName} must be >= ${min}`);
  }
  if (max !== null && parsed > max) {
    throw new CustomerSegmentationError(`${fieldName} must be <= ${max}`);
  }
  return parsed;
};

const toDate = (value, fieldName) => {
  if (value === undefined || value === null || value === '') return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new CustomerSegmentationError(`${fieldName} must be a valid date`);
  }
  return parsed.toISOString();
};

const parsePagination = (query = {}) => {
  const page = toPositiveInt(query.page, 'page') || 1;
  const pageSizeRaw = toPositiveInt(query.page_size ?? query.pageSize, 'page_size') || 25;
  const pageSize = Math.min(pageSizeRaw, 100);
  return {
    page,
    page_size: pageSize,
    offset: (page - 1) * pageSize,
  };
};

const normalizeSort = (query = {}) => {
  const sortByRaw = String(query.sort_by || DEFAULT_SORT).trim().toLowerCase();
  const sortBy = SORT_FIELDS[sortByRaw] ? sortByRaw : DEFAULT_SORT;
  const orderRaw = String(query.sort_order || 'desc').trim().toLowerCase();
  const sortOrder = orderRaw === 'asc' ? 'ASC' : 'DESC';
  return {
    sortBy,
    sortOrder,
  };
};

const normalizeSegment = (value) => {
  if (!value) return null;
  const normalized = String(value).trim().toLowerCase();
  if (!SEGMENTS.has(normalized)) {
    throw new CustomerSegmentationError('segment filter is invalid');
  }
  if (normalized === 'all') return null;
  return normalized;
};

const normalizeSegmentGroup = (value) => {
  if (!value) return null;
  const normalized = String(value).trim().toLowerCase();
  if (!SEGMENT_GROUPS.has(normalized)) {
    return null;
  }
  return normalized;
};

const normalizeFilters = (query = {}) => ({
  // `segment` accepts both legacy values and simplified groups (`risk|loyal`).
  // Group filters are resolved server-side to avoid frontend-derived segmentation.
  segment_group: normalizeSegmentGroup(query.segment_group || query.segment),
  search: query.search ? String(query.search).trim().toLowerCase() : '',
  segment: normalizeSegmentGroup(query.segment) ? null : normalizeSegment(query.segment),
  last_order_from: toDate(query.last_order_from, 'last_order_from'),
  last_order_to: toDate(query.last_order_to, 'last_order_to'),
  total_orders_min: toNumber(query.total_orders_min, 'total_orders_min', { min: 0 }),
  total_orders_max: toNumber(query.total_orders_max, 'total_orders_max', { min: 0 }),
  total_revenue_min: toNumber(query.total_revenue_min, 'total_revenue_min', { min: 0 }),
  total_revenue_max: toNumber(query.total_revenue_max, 'total_revenue_max', { min: 0 }),
  rfm_r_min: toNumber(query.rfm_r_min, 'rfm_r_min', { min: 1, max: 5 }),
  rfm_f_min: toNumber(query.rfm_f_min, 'rfm_f_min', { min: 1, max: 5 }),
  rfm_m_min: toNumber(query.rfm_m_min, 'rfm_m_min', { min: 1, max: 5 }),
  include_guests: toBool(query.include_guests, true),
});

const buildWhereClause = (filters, params) => {
  const where = ['1=1'];

  if (!filters.include_guests) {
    where.push('s.customer_id IS NOT NULL');
  }

  if (filters.segment_group === 'loyal') {
    where.push(`s.recency_days < ${RISK_AFTER_DAYS}`);
  }

  if (filters.segment_group === 'risk') {
    where.push(`s.recency_days >= ${RISK_AFTER_DAYS}`);
  }

  if (filters.segment) {
    params.push(filters.segment);
    where.push(`s.segment = $${params.length}`);
  }

  if (filters.search) {
    params.push(`%${filters.search}%`);
    where.push(`(
      LOWER(COALESCE(s.customer_name, '')) LIKE $${params.length}
      OR LOWER(COALESCE(s.phone, '')) LIKE $${params.length}
      OR LOWER(COALESCE(s.email, '')) LIKE $${params.length}
    )`);
  }

  if (filters.last_order_from) {
    params.push(filters.last_order_from);
    where.push(`s.last_ordered_at >= $${params.length}`);
  }
  if (filters.last_order_to) {
    params.push(filters.last_order_to);
    where.push(`s.last_ordered_at <= $${params.length}`);
  }
  if (filters.total_orders_min !== null) {
    params.push(filters.total_orders_min);
    where.push(`s.total_orders >= $${params.length}`);
  }
  if (filters.total_orders_max !== null) {
    params.push(filters.total_orders_max);
    where.push(`s.total_orders <= $${params.length}`);
  }
  if (filters.total_revenue_min !== null) {
    params.push(filters.total_revenue_min);
    where.push(`s.total_revenue >= $${params.length}`);
  }
  if (filters.total_revenue_max !== null) {
    params.push(filters.total_revenue_max);
    where.push(`s.total_revenue <= $${params.length}`);
  }
  if (filters.rfm_r_min !== null) {
    params.push(filters.rfm_r_min);
    where.push(`s.r_score >= $${params.length}`);
  }
  if (filters.rfm_f_min !== null) {
    params.push(filters.rfm_f_min);
    where.push(`s.f_score >= $${params.length}`);
  }
  if (filters.rfm_m_min !== null) {
    params.push(filters.rfm_m_min);
    where.push(`s.m_score >= $${params.length}`);
  }

  return where.join(' AND ');
};

const mapRow = (row) => ({
  customer_id: row.customer_id ? Number(row.customer_id) : null,
  customer_name: row.customer_name,
  phone: row.phone,
  email: row.email,
  customer_type: row.customer_type,
  total_orders: Number(row.total_orders || 0),
  total_revenue: Number(row.total_revenue || 0),
  first_ordered_at: row.first_ordered_at,
  last_ordered_at: row.last_ordered_at,
  rfm: {
    r: Number(row.r_score || 0),
    f: Number(row.f_score || 0),
    m: Number(row.m_score || 0),
  },
  segment: row.segment,
  segment_group: Number(row.recency_days || 0) >= RISK_AFTER_DAYS ? 'risk' : 'loyal',
  recency_days: Number(row.recency_days || 0),
  clv_90d: Number(row.clv_90d || 0),
  churn_risk_score: Number(row.churn_risk_score || 0),
  spend_potential_score: Number(row.spend_potential_score || 0),
  is_high_value: Boolean(row.is_high_value),
});

const buildRecommendations = (summary = {}) => {
  const recommendations = [];

  if (Number(summary.risk_count || 0) > 0) {
    recommendations.push({
      id: 'reactivation-30d',
      title: 'Reactivate dormant users',
      rationale: `Customers who have not ordered in ${RISK_AFTER_DAYS}+ days should be reactivated.`,
      suggested_filters: {
        segment: 'risk',
        last_order_to: 'now-30d',
      },
      suggested_action: 'customer_followup',
    });
  }

  if (Number(summary.champions_count || 0) > 0) {
    recommendations.push({
      id: 'champion-lookalike',
      title: 'Build champion lookalike audience',
      rationale: 'Champion customers provide the strongest seed quality for lookalike expansion.',
      suggested_filters: {
        segment: 'champions',
      },
      suggested_action: 'custom_audience_template',
    });
  }

  if (Number(summary.high_potential_count || 0) > 0) {
    recommendations.push({
      id: 'upsell-high-potential',
      title: 'Upsell high-potential customers',
      rationale: 'High spend_potential_score suggests likely revenue lift with targeted promotions.',
      suggested_filters: {
        rfm_r_min: 3,
        segment: 'loyal_customers',
      },
      suggested_action: 'customer_followup',
    });
  }

  return recommendations;
};

const fetchSummary = async ({ params, whereClause }) => {
  const result = await db.query(
    `
    ${SEGMENT_BASE_CTE}
    SELECT
      COUNT(*)::int AS total_customers,
      SUM(CASE WHEN s.recency_days >= ${RISK_AFTER_DAYS} THEN 1 ELSE 0 END)::int AS risk_count,
      SUM(CASE WHEN s.recency_days < ${RISK_AFTER_DAYS} THEN 1 ELSE 0 END)::int AS loyal_count,
      SUM(CASE WHEN s.segment = 'champions' THEN 1 ELSE 0 END)::int AS champions_count,
      SUM(CASE WHEN s.segment = 'loyal_customers' THEN 1 ELSE 0 END)::int AS loyal_customers_count,
      SUM(CASE WHEN s.segment = 'need_attention' THEN 1 ELSE 0 END)::int AS need_attention_count,
      SUM(CASE WHEN s.segment = 'at_risk' THEN 1 ELSE 0 END)::int AS at_risk_count,
      SUM(CASE WHEN s.segment = 'hibernating' THEN 1 ELSE 0 END)::int AS hibernating_count,
      SUM(CASE WHEN s.is_high_value THEN 1 ELSE 0 END)::int AS high_value_count,
      SUM(CASE WHEN s.spend_potential_score >= 70 THEN 1 ELSE 0 END)::int AS high_potential_count,
      ROUND(COALESCE(AVG(s.clv_90d), 0)::numeric, 2) AS avg_clv_90d,
      ROUND(COALESCE(AVG(s.churn_risk_score), 0)::numeric, 2) AS avg_churn_risk_score
    FROM normalized s
    WHERE ${whereClause}
    `,
    params
  );

  return result.rows[0] || {};
};

const getSegments = async ({ outletId, query = {} }) => {
  const pagination = parsePagination(query);
  const sorting = normalizeSort(query);
  const filters = normalizeFilters(query);
  const params = [outletId];
  const whereClause = buildWhereClause(filters, params);

  const countResult = await db.query(
    `
    ${SEGMENT_BASE_CTE}
    SELECT COUNT(*)::int AS count
    FROM normalized s
    WHERE ${whereClause}
    `,
    params
  );
  const total = Number(countResult.rows[0]?.count || 0);

  const dataResult = await db.query(
    `
    ${SEGMENT_BASE_CTE}
    SELECT
      s.customer_id,
      s.customer_name,
      s.phone,
      s.email,
      s.customer_type,
      s.total_orders,
      s.total_revenue,
      s.first_ordered_at,
      s.last_ordered_at,
      s.r_score,
      s.f_score,
      s.m_score,
      s.segment,
      s.recency_days,
      s.clv_90d,
      s.churn_risk_score,
      s.spend_potential_score,
      s.is_high_value
    FROM normalized s
    WHERE ${whereClause}
    ORDER BY ${SORT_FIELDS[sorting.sortBy]} ${sorting.sortOrder}, s.customer_key ASC
    LIMIT $${params.length + 1}
    OFFSET $${params.length + 2}
    `,
    [...params, pagination.page_size, pagination.offset]
  );

  const summary = await fetchSummary({ params, whereClause });
  return {
    data: dataResult.rows.map(mapRow),
    meta: {
      page: pagination.page,
      page_size: pagination.page_size,
      total,
      total_pages: total === 0 ? 0 : Math.ceil(total / pagination.page_size),
    },
    ai_recommendations: buildRecommendations(summary),
  };
};

const getInsights = async ({ outletId, query = {} }) => {
  const filters = normalizeFilters(query);
  const params = [outletId];
  const whereClause = buildWhereClause(filters, params);
  const summary = await fetchSummary({ params, whereClause });

  return {
    total_customers: Number(summary.total_customers || 0),
    loyal_count: Number(summary.loyal_count || 0),
    risk_count: Number(summary.risk_count || 0),
    segment_counts: {
      champions: Number(summary.champions_count || 0),
      loyal_customers: Number(summary.loyal_customers_count || 0),
      need_attention: Number(summary.need_attention_count || 0),
      at_risk: Number(summary.at_risk_count || 0),
      hibernating: Number(summary.hibernating_count || 0),
    },
    high_value_count: Number(summary.high_value_count || 0),
    at_risk_count: Number(summary.at_risk_count || 0),
    avg_clv_90d: Number(summary.avg_clv_90d || 0),
    avg_churn_risk_score: Number(summary.avg_churn_risk_score || 0),
    ai_recommendations: buildRecommendations(summary),
  };
};

const getAudienceRows = async ({ outletId, filters = {}, limit = 5000 }) => {
  const normalizedFilters = normalizeFilters(filters);
  const safeLimit = Math.min(toPositiveInt(limit, 'limit') || 5000, 20000);
  const params = [outletId];
  const whereClause = buildWhereClause(normalizedFilters, params);

  const result = await db.query(
    `
    ${SEGMENT_BASE_CTE}
    SELECT
      s.customer_id,
      s.customer_name,
      s.phone,
      s.email,
      s.customer_type,
      s.segment,
      s.clv_90d,
      s.churn_risk_score,
      s.spend_potential_score,
      s.is_high_value,
      s.last_ordered_at,
      s.total_orders,
      s.total_revenue
    FROM normalized s
    WHERE ${whereClause}
    ORDER BY s.last_ordered_at DESC, s.customer_key ASC
    LIMIT $${params.length + 1}
    `,
    [...params, safeLimit]
  );

  return result.rows.map((row) => ({
    customer_id: row.customer_id ? Number(row.customer_id) : null,
    customer_name: row.customer_name,
    phone: row.phone,
    email: row.email,
    customer_type: row.customer_type,
    segment: row.segment,
    clv_90d: Number(row.clv_90d || 0),
    churn_risk_score: Number(row.churn_risk_score || 0),
    spend_potential_score: Number(row.spend_potential_score || 0),
    is_high_value: Boolean(row.is_high_value),
    last_ordered_at: row.last_ordered_at,
    total_orders: Number(row.total_orders || 0),
    total_revenue: Number(row.total_revenue || 0),
  }));
};

module.exports = {
  CustomerSegmentationError,
  parsePagination,
  toPositiveInt,
  toBool,
  normalizeFilters,
  getSegments,
  getInsights,
  getAudienceRows,
};
