const db = require('./db');
const {
  CustomerSegmentationError,
  parsePagination,
  toPositiveInt,
  getAudienceRows,
  getInsights,
} = require('./customerSegmentationService');

const SEGMENTS = new Set([
  'champions',
  'loyal_customers',
  'need_attention',
  'at_risk',
  'hibernating',
  'all',
]);

const AUDIENCE_PLATFORMS = new Set(['meta', 'google', 'both']);
const DEFAULT_TIMEZONE = 'Asia/Karachi';

class CustomerCampaignError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.name = 'CustomerCampaignError';
    this.statusCode = statusCode;
  }
}

const toBool = (value, fallback = false) => {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  if (value === 'true' || value === '1' || value === 1) return true;
  if (value === 'false' || value === '0' || value === 0) return false;
  return fallback;
};

const normalizeText = (value, fieldName, { required = false, max = 255 } = {}) => {
  if (value === undefined || value === null) {
    if (required) throw new CustomerCampaignError(`${fieldName} is required`);
    return null;
  }
  const text = String(value).trim();
  if (!text) {
    if (required) throw new CustomerCampaignError(`${fieldName} is required`);
    return null;
  }
  if (text.length > max) {
    throw new CustomerCampaignError(`${fieldName} must be <= ${max} characters`);
  }
  return text;
};

const normalizeSegment = (segment) => {
  const normalized = normalizeText(segment || 'all', 'segment', { required: true, max: 40 }).toLowerCase();
  if (!SEGMENTS.has(normalized)) {
    throw new CustomerCampaignError('segment is invalid');
  }
  return normalized;
};

const normalizePlatform = (value, fallback = 'both') => {
  const platform = normalizeText(value || fallback, 'platform', { required: true, max: 20 }).toLowerCase();
  if (!AUDIENCE_PLATFORMS.has(platform)) {
    throw new CustomerCampaignError('platform must be meta, google, or both');
  }
  return platform;
};

const splitName = (fullName) => {
  const normalized = String(fullName || '').trim();
  if (!normalized) return { first_name: '', last_name: '' };
  const [firstName, ...rest] = normalized.split(/\s+/);
  return {
    first_name: firstName || '',
    last_name: rest.join(' '),
  };
};

const escapeCsv = (value) => {
  const text = String(value ?? '');
  if (/[",\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
};

const buildCsv = (rows, headers) => {
  const lines = [headers.join(',')];
  rows.forEach((row) => {
    lines.push(headers.map((key) => escapeCsv(row[key])).join(','));
  });
  return `${lines.join('\n')}\n`;
};

const buildSmsTemplates = ({ segment, goal, tone }) => {
  const toneSuffix = tone ? ` Tone: ${tone}.` : '';
  const segmentLabel = segment.replace(/_/g, ' ');
  const goalLine = goal ? `Goal: ${goal}.` : '';

  return [
    `Hi {{name}}, we miss you at Orderly POS. ${goalLine} Come back today for a special offer tailored for our ${segmentLabel} customers.${toneSuffix}`.trim(),
    `Hello {{name}}, thanks for being with us. ${goalLine} We saved a personalized deal for you. Order now and enjoy it!${toneSuffix}`.trim(),
    `{{name}}, your next favorite order is waiting. ${goalLine} Tap to order now and get your custom customer reward.${toneSuffix}`.trim(),
  ];
};

const computeBestSendHour = async ({ outletId, timezone, customerIds = [] }) => {
  if (!Array.isArray(customerIds) || customerIds.length === 0) {
    const fallbackResult = await db.query(
      `
      SELECT EXTRACT(HOUR FROM timezone($2, o.created_at))::int AS hour_of_day, COUNT(*)::int AS cnt
      FROM orders o
      WHERE o.outlet_id = $1
        AND o.deleted_at IS NULL
        AND o.status = 'completed'
        AND o.created_at >= now() - interval '90 day'
      GROUP BY hour_of_day
      ORDER BY cnt DESC, hour_of_day ASC
      LIMIT 1
      `,
      [outletId, timezone || DEFAULT_TIMEZONE]
    );
    return Number(fallbackResult.rows[0]?.hour_of_day ?? 18);
  }

  const result = await db.query(
    `
    SELECT EXTRACT(HOUR FROM timezone($2, o.created_at))::int AS hour_of_day, COUNT(*)::int AS cnt
    FROM orders o
    WHERE o.outlet_id = $1
      AND o.deleted_at IS NULL
      AND o.status = 'completed'
      AND o.created_at >= now() - interval '90 day'
      AND o.customer_id = ANY($3::bigint[])
    GROUP BY hour_of_day
    ORDER BY cnt DESC, hour_of_day ASC
    LIMIT 1
    `,
    [outletId, timezone || DEFAULT_TIMEZONE, customerIds]
  );
  return Number(result.rows[0]?.hour_of_day ?? 18);
};

const previewSmsCampaign = async ({ outletId, timezone, payload = {} }) => {
  const segment = normalizeSegment(payload.segment || payload.filters?.segment || 'all');
  const goal = normalizeText(payload.goal, 'goal', { required: false, max: 500 }) || 'Increase repeat orders';
  const tone = normalizeText(payload.tone, 'tone', { required: false, max: 120 });
  const filters = {
    ...(payload.filters && typeof payload.filters === 'object' ? payload.filters : {}),
    segment,
    include_guests: true,
  };

  const audience = await getAudienceRows({
    outletId,
    filters,
    limit: 5000,
  });

  const withPhone = audience.filter((row) => row.phone);
  const sendHour = await computeBestSendHour({
    outletId,
    timezone,
    customerIds: withPhone.map((row) => row.customer_id).filter(Boolean),
  });

  return {
    segment,
    goal,
    audience_count: audience.length,
    reachable_sms_count: withPhone.length,
    suggested_send_hour_local: sendHour,
    rationale:
      withPhone.length > 0
        ? `Best send window is ${String(sendHour).padStart(2, '0')}:00 based on the last 90 days of order activity.`
        : 'No reachable phone audience found; using fallback send hour 18:00.',
    message_variants: buildSmsTemplates({ segment, goal, tone }),
  };
};

const createSmsTemplate = async ({ outletId, actorId, payload = {} }) => {
  const preview = await previewSmsCampaign({
    outletId,
    timezone: payload.timezone || DEFAULT_TIMEZONE,
    payload,
  });

  const name = normalizeText(payload.name, 'name', { required: true, max: 180 });
  const messageTemplate = normalizeText(
    payload.message_template || preview.message_variants[0],
    'message_template',
    { required: true, max: 4000 }
  );
  const status = normalizeText(payload.status || 'draft', 'status', { required: true, max: 20 }).toLowerCase();
  if (!['draft', 'approved', 'archived'].includes(status)) {
    throw new CustomerCampaignError('status must be draft, approved, or archived');
  }

  const filtersJson = payload.filters && typeof payload.filters === 'object' ? payload.filters : {};
  const result = await db.query(
    `
    INSERT INTO sms_campaign_templates (
      outlet_id,
      name,
      segment_key,
      filters_json,
      message_template,
      suggested_send_hour_local,
      audience_count,
      status,
      created_by,
      created_at,
      updated_at
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, now(), now())
    RETURNING *
    `,
    [
      outletId,
      name,
      preview.segment,
      filtersJson,
      messageTemplate,
      preview.suggested_send_hour_local,
      preview.reachable_sms_count,
      status,
      actorId || null,
    ]
  );
  return result.rows[0];
};

const listSmsTemplates = async ({ outletId, query = {} }) => {
  const pagination = parsePagination(query);
  const search = query.search ? String(query.search).trim().toLowerCase() : '';
  const params = [outletId];
  const filters = ['outlet_id = $1', 'deleted_at IS NULL'];

  if (search) {
    params.push(`%${search}%`);
    filters.push(`(LOWER(name) LIKE $${params.length} OR LOWER(segment_key) LIKE $${params.length})`);
  }

  const whereClause = filters.join(' AND ');
  const countResult = await db.query(
    `
    SELECT COUNT(*)::int AS count
    FROM sms_campaign_templates
    WHERE ${whereClause}
    `,
    params
  );
  const total = Number(countResult.rows[0]?.count || 0);

  const dataResult = await db.query(
    `
    SELECT *
    FROM sms_campaign_templates
    WHERE ${whereClause}
    ORDER BY created_at DESC
    LIMIT $${params.length + 1}
    OFFSET $${params.length + 2}
    `,
    [...params, pagination.page_size, pagination.offset]
  );

  return {
    data: dataResult.rows,
    meta: {
      page: pagination.page,
      page_size: pagination.page_size,
      total,
      total_pages: total === 0 ? 0 : Math.ceil(total / pagination.page_size),
    },
  };
};

const createAudienceTemplate = async ({ outletId, actorId, payload = {} }) => {
  const name = normalizeText(payload.name, 'name', { required: true, max: 180 });
  const platform = normalizePlatform(payload.platform || 'both');
  const segment = normalizeSegment(payload.segment_key || payload.segment || 'all');
  const lookalikeSeedSegment = normalizeSegment(payload.lookalike_seed_segment || 'champions');
  const filtersJson = payload.filters && typeof payload.filters === 'object' ? payload.filters : {};

  const result = await db.query(
    `
    INSERT INTO audience_templates (
      outlet_id,
      name,
      platform,
      segment_key,
      filters_json,
      lookalike_seed_segment,
      created_by,
      created_at,
      updated_at
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, now(), now())
    RETURNING *
    `,
    [outletId, name, platform, segment, filtersJson, lookalikeSeedSegment, actorId || null]
  );

  return result.rows[0];
};

const listAudienceTemplates = async ({ outletId, query = {} }) => {
  const pagination = parsePagination(query);
  const search = query.search ? String(query.search).trim().toLowerCase() : '';
  const params = [outletId];
  const filters = ['outlet_id = $1', 'deleted_at IS NULL'];

  if (search) {
    params.push(`%${search}%`);
    filters.push(`(LOWER(name) LIKE $${params.length} OR LOWER(segment_key) LIKE $${params.length})`);
  }

  const whereClause = filters.join(' AND ');
  const countResult = await db.query(
    `
    SELECT COUNT(*)::int AS count
    FROM audience_templates
    WHERE ${whereClause}
    `,
    params
  );
  const total = Number(countResult.rows[0]?.count || 0);

  const dataResult = await db.query(
    `
    SELECT *
    FROM audience_templates
    WHERE ${whereClause}
    ORDER BY created_at DESC
    LIMIT $${params.length + 1}
    OFFSET $${params.length + 2}
    `,
    [...params, pagination.page_size, pagination.offset]
  );

  return {
    data: dataResult.rows,
    meta: {
      page: pagination.page,
      page_size: pagination.page_size,
      total,
      total_pages: total === 0 ? 0 : Math.ceil(total / pagination.page_size),
    },
  };
};

const getAudienceTemplate = async ({ outletId, templateUuid }) => {
  const uuid = normalizeText(templateUuid, 'uuid', { required: true, max: 64 });
  const result = await db.query(
    `
    SELECT *
    FROM audience_templates
    WHERE uuid = $1
      AND outlet_id = $2
      AND deleted_at IS NULL
    `,
    [uuid, outletId]
  );
  if (!result.rows[0]) {
    throw new CustomerCampaignError('audience template not found', 404);
  }
  return result.rows[0];
};

const getLookalikeSuggestion = async ({ outletId }) => {
  const insights = await getInsights({ outletId, query: { include_guests: true } });
  const championCount = Number(insights.segment_counts?.champions || 0);
  if (championCount >= 100) {
    return `Champion seed is strong (${championCount}). Create a 1%-3% lookalike audience first.`;
  }
  return `Champion seed is ${championCount}. Grow champions to at least 100 records before launching lookalike expansion.`;
};

const exportAudienceTemplate = async ({ outletId, templateUuid, platform }) => {
  const template = await getAudienceTemplate({ outletId, templateUuid });
  const resolvedPlatform = normalizePlatform(platform || template.platform || 'both');
  const filters = {
    ...(template.filters_json || {}),
    segment: template.segment_key || 'all',
    include_guests: true,
  };

  const audience = await getAudienceRows({
    outletId,
    filters,
    limit: 20000,
  });

  const mappedRows = audience.map((row) => {
    const nameParts = splitName(row.customer_name);
    return {
      customer_id: row.customer_id ?? '',
      full_name: row.customer_name || '',
      email: row.email || '',
      phone: row.phone || '',
      first_name: nameParts.first_name,
      last_name: nameParts.last_name,
      country: '',
      segment: row.segment || '',
      clv_90d: row.clv_90d,
      churn_risk_score: row.churn_risk_score,
      spend_potential_score: row.spend_potential_score,
    };
  });

  const filteredForExport = mappedRows.filter((row) => row.email || row.phone);
  const excluded = mappedRows.length - filteredForExport.length;

  const headers =
    resolvedPlatform === 'google'
      ? ['email', 'phone', 'first_name', 'last_name', 'country']
      : ['email', 'phone', 'first_name', 'last_name', 'country', 'segment', 'clv_90d'];

  const csv = buildCsv(filteredForExport, headers);
  const lookalikeSuggestion = await getLookalikeSuggestion({ outletId });

  return {
    platform: resolvedPlatform,
    matched_count: filteredForExport.length,
    excluded_missing_contact_count: excluded,
    lookalike_suggestion: lookalikeSuggestion,
    file_name: `audience_${template.uuid}_${resolvedPlatform}.csv`,
    csv,
  };
};

module.exports = {
  CustomerCampaignError,
  previewSmsCampaign,
  createSmsTemplate,
  listSmsTemplates,
  createAudienceTemplate,
  listAudienceTemplates,
  exportAudienceTemplate,
};
