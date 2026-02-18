const db = require('./db');
const { applyRounding, ROUNDING_RULES, roundToTwo } = require('./moneyRounding');

const TIME_RE = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;
const DEFAULT_TIMEZONE = 'Asia/Karachi';
const WEEK_DAYS = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
];

const DEFAULT_WORKING_HOURS = Object.freeze({
  monday: { open: '09:00', close: '22:00' },
  tuesday: { open: '09:00', close: '22:00' },
  wednesday: { open: '09:00', close: '22:00' },
  thursday: { open: '09:00', close: '22:00' },
  friday: { open: '09:00', close: '22:00' },
  saturday: { open: '09:00', close: '22:00' },
  sunday: { open: '09:00', close: '22:00' },
});

const DEFAULT_BUSINESS_SETTINGS = Object.freeze({
  id: null,
  uuid: null,
  default_currency: 'PKR',
  tax_enabled: false,
  default_tax_percent: 0,
  rounding_rule: 'none',
  discount_stacking_enabled: true,
  admin_switch_pin: '0000',
  created_at: null,
  updated_at: null,
});

const DEFAULT_BRANCH_SETTINGS = Object.freeze({
  is_open: true,
  accepting_orders: true,
  maintenance_mode: false,
  temporary_closed: false,
  working_hours: DEFAULT_WORKING_HOURS,
  enforce_working_hours: true,
  feature_flags: {
    offline_v2_enabled: false,
    edge_enabled: false,
  },
  created_at: null,
  updated_at: null,
});

class SettingsValidationError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.name = 'SettingsValidationError';
    this.statusCode = statusCode;
  }
}

const isObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const clone = (value) => JSON.parse(JSON.stringify(value));

const runQuery = (client, sql, params = []) => {
  if (client && typeof client.query === 'function') {
    return client.query(sql, params);
  }
  return db.query(sql, params);
};

const toPositiveInt = (value, fieldName = 'value') => {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new SettingsValidationError(`${fieldName} must be a positive integer`);
  }
  return parsed;
};

const toBoolean = (value, fieldName = 'value') => {
  if (typeof value !== 'boolean') {
    throw new SettingsValidationError(`${fieldName} must be a boolean`);
  }
  return value;
};

const toTaxPercent = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100) {
    throw new SettingsValidationError('default_tax_percent must be between 0 and 100');
  }
  return roundToTwo(parsed);
};

const toCurrencyCode = (value) => {
  if (typeof value !== 'string' || !value.trim()) {
    throw new SettingsValidationError('default_currency is required');
  }
  const code = value.trim().toUpperCase();
  if (!/^[A-Z0-9]{1,10}$/.test(code)) {
    throw new SettingsValidationError('default_currency must be alphanumeric and <= 10 chars');
  }
  return code;
};

const normalizeTimezone = (value) => {
  if (typeof value !== 'string' || !value.trim()) return DEFAULT_TIMEZONE;
  try {
    Intl.DateTimeFormat('en-US', { timeZone: value.trim() });
    return value.trim();
  } catch (err) {
    return DEFAULT_TIMEZONE;
  }
};

const normalizeRoundingRule = (value) => {
  if (typeof value !== 'string' || !value.trim()) {
    throw new SettingsValidationError('rounding_rule is required');
  }
  const rule = value.trim().toLowerCase();
  if (!ROUNDING_RULES.has(rule)) {
    throw new SettingsValidationError('rounding_rule must be none, round_up, round_down, or bankers_rounding');
  }
  return rule;
};

const normalizeAdminSwitchPin = (value) => {
  const pin = String(value ?? '').trim();
  if (!/^\d{4}$/.test(pin)) {
    throw new SettingsValidationError('admin_switch_pin must be exactly 4 digits');
  }
  return pin;
};

const normalizeBranchName = (value) => {
  if (typeof value !== 'string' || !value.trim()) {
    throw new SettingsValidationError('branch name is required');
  }
  const name = value.trim();
  if (name.length > 120) {
    throw new SettingsValidationError('branch name must be <= 120 characters');
  }
  return name;
};

const normalizeDaySchedule = (day, value) => {
  if (!isObject(value)) {
    throw new SettingsValidationError(`working_hours.${day} must be an object`);
  }
  const open = typeof value.open === 'string' ? value.open.trim() : '';
  const close = typeof value.close === 'string' ? value.close.trim() : '';
  if (!TIME_RE.test(open)) {
    throw new SettingsValidationError(`working_hours.${day}.open must match HH:MM`);
  }
  if (!TIME_RE.test(close)) {
    throw new SettingsValidationError(`working_hours.${day}.close must match HH:MM`);
  }
  if (open === close) {
    throw new SettingsValidationError(`working_hours.${day} open and close times cannot be the same`);
  }
  return { open, close };
};

const normalizeWorkingHours = (value, { required = false } = {}) => {
  if (value === undefined || value === null) {
    if (required) throw new SettingsValidationError('working_hours is required');
    return null;
  }
  if (!isObject(value)) {
    throw new SettingsValidationError('working_hours must be an object');
  }

  const normalized = {};
  for (const day of WEEK_DAYS) {
    normalized[day] = normalizeDaySchedule(day, value[day]);
  }
  return normalized;
};

const parseTimeToMinutes = (timeText) => {
  const [hourText, minuteText] = String(timeText).split(':');
  return Number(hourText) * 60 + Number(minuteText);
};

const isWithinWindow = (currentMinutes, openMinutes, closeMinutes) => {
  if (openMinutes === closeMinutes) return false;
  if (closeMinutes > openMinutes) {
    return currentMinutes >= openMinutes && currentMinutes < closeMinutes;
  }
  return currentMinutes >= openMinutes || currentMinutes < closeMinutes;
};

const formatNowInTimezone = (date, timezone) => {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'long',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  const parts = formatter.formatToParts(date);
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    weekday: String(map.weekday || '').toLowerCase(),
    hour: Number(map.hour || 0),
    minute: Number(map.minute || 0),
  };
};

const SETTINGS_SCHEMA_DDL = [
  'CREATE EXTENSION IF NOT EXISTS pgcrypto',
  `
  DO $$
  BEGIN
    IF NOT EXISTS (
      SELECT 1 FROM pg_type WHERE typname = 'rounding_rule_enum'
    ) THEN
      CREATE TYPE rounding_rule_enum AS ENUM (
        'none',
        'round_up',
        'round_down',
        'bankers_rounding'
      );
    END IF;
  END$$
  `,
  `
  CREATE TABLE IF NOT EXISTS business_settings (
    id BIGSERIAL PRIMARY KEY,
    uuid UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(),
    default_currency VARCHAR(10) NOT NULL DEFAULT 'PKR',
    tax_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    default_tax_percent NUMERIC(5,2) NOT NULL DEFAULT 0,
    rounding_rule rounding_rule_enum NOT NULL DEFAULT 'none',
    discount_stacking_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    admin_switch_pin VARCHAR(12) NOT NULL DEFAULT '0000',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )
  `,
  `ALTER TABLE IF EXISTS business_settings ADD COLUMN IF NOT EXISTS admin_switch_pin VARCHAR(12) NOT NULL DEFAULT '0000'`,
  'CREATE UNIQUE INDEX IF NOT EXISTS idx_business_settings_singleton ON business_settings ((1))',
  `
  CREATE TABLE IF NOT EXISTS branches (
    id BIGINT PRIMARY KEY,
    uuid UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(),
    name VARCHAR(120) NOT NULL,
    timezone VARCHAR(64) NOT NULL DEFAULT 'Asia/Karachi',
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at TIMESTAMPTZ NULL
  )
  `,
  `
  DO $$
  BEGIN
    IF EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'branches'
        AND column_name = 'outlet_id'
    ) THEN
      EXECUTE 'ALTER TABLE branches ALTER COLUMN outlet_id DROP NOT NULL';
    END IF;
  END$$
  `,
  `
  CREATE TABLE IF NOT EXISTS branch_settings (
    id BIGSERIAL PRIMARY KEY,
    uuid UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(),
    branch_id BIGINT NOT NULL REFERENCES branches(id),
    is_open BOOLEAN NOT NULL DEFAULT TRUE,
    accepting_orders BOOLEAN NOT NULL DEFAULT TRUE,
    maintenance_mode BOOLEAN NOT NULL DEFAULT FALSE,
    temporary_closed BOOLEAN NOT NULL DEFAULT FALSE,
    working_hours JSONB NOT NULL,
    enforce_working_hours BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )
  `,
  'CREATE UNIQUE INDEX IF NOT EXISTS idx_branch_settings_branch_unique ON branch_settings(branch_id)',
  `
  CREATE TABLE IF NOT EXISTS branch_feature_flags (
    branch_id BIGINT PRIMARY KEY REFERENCES branches(id),
    offline_v2_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    edge_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )
  `,
];

const ensureSettingsSchema = async (client = null) => {
  for (const statement of SETTINGS_SCHEMA_DDL) {
    await runQuery(client, statement);
  }
  await runQuery(
    client,
    `
    INSERT INTO business_settings (
      default_currency,
      tax_enabled,
      default_tax_percent,
      rounding_rule,
      discount_stacking_enabled
    )
    SELECT 'PKR', FALSE, 0, 'none'::rounding_rule_enum, TRUE
    WHERE NOT EXISTS (SELECT 1 FROM business_settings)
    `
  );
};

const ensureBranchRecord = async ({ client, branchId, name, timezone, isActive = true }) => {
  const resolvedName = normalizeBranchName(name || `Branch ${branchId}`);
  const resolvedTimezone = normalizeTimezone(timezone || DEFAULT_TIMEZONE);
  await runQuery(
    client,
    `
    INSERT INTO branches (
      id,
      name,
      timezone,
      is_active,
      created_at,
      updated_at,
      deleted_at
    )
    SELECT $1, $2, $3, $4, now(), now(), NULL
    WHERE NOT EXISTS (
      SELECT 1
      FROM branches
      WHERE id = $1
    )
    `,
    [branchId, resolvedName, resolvedTimezone, Boolean(isActive)]
  );
};

const ensureBranchSettingsRecord = async (client, branchId) => {
  await runQuery(
    client,
    `
    INSERT INTO branch_settings (
      branch_id,
      is_open,
      accepting_orders,
      maintenance_mode,
      temporary_closed,
      working_hours,
      enforce_working_hours,
      created_at,
      updated_at
    )
    SELECT
      $1,
      TRUE,
      TRUE,
      FALSE,
      FALSE,
      $2::jsonb,
      TRUE,
      now(),
      now()
    WHERE NOT EXISTS (
      SELECT 1
      FROM branch_settings
      WHERE branch_id = $1
    )
    `,
    [branchId, JSON.stringify(DEFAULT_WORKING_HOURS)]
  );
};

const ensureBranchFeatureFlagsRecord = async (client, branchId) => {
  await runQuery(
    client,
    `
    INSERT INTO branch_feature_flags (
      branch_id,
      offline_v2_enabled,
      edge_enabled,
      created_at,
      updated_at
    )
    SELECT
      $1,
      FALSE,
      FALSE,
      now(),
      now()
    WHERE NOT EXISTS (
      SELECT 1
      FROM branch_feature_flags
      WHERE branch_id = $1
    )
    `,
    [branchId]
  );
};

const mapBusinessSettings = (row = {}) => ({
  id: row.id ?? null,
  uuid: row.uuid ?? null,
  default_currency: row.default_currency || 'PKR',
  tax_enabled: row.tax_enabled === undefined ? false : Boolean(row.tax_enabled),
  default_tax_percent: row.default_tax_percent === undefined ? 0 : roundToTwo(row.default_tax_percent),
  rounding_rule: row.rounding_rule || 'none',
  discount_stacking_enabled:
    row.discount_stacking_enabled === undefined ? true : Boolean(row.discount_stacking_enabled),
  admin_switch_pin: typeof row.admin_switch_pin === 'string' && row.admin_switch_pin.trim()
    ? row.admin_switch_pin.trim()
    : '0000',
  created_at: row.created_at || null,
  updated_at: row.updated_at || null,
});

const mapBranchRow = (row = {}) => ({
  branch_id: Number(row.branch_id ?? row.id),
  name: row.branch_name || row.name || `Branch ${row.id || row.branch_id}`,
  timezone: normalizeTimezone(row.branch_timezone || row.timezone || DEFAULT_TIMEZONE),
  is_active: row.branch_is_active === undefined ? true : Boolean(row.branch_is_active),
  created_at: row.branch_created_at || row.created_at || null,
  updated_at: row.branch_updated_at || row.updated_at || null,
  deleted_at: row.branch_deleted_at || row.deleted_at || null,
});

const mapBranchSettingsRow = (row = {}) => ({
  is_open: row.is_open === undefined ? true : Boolean(row.is_open),
  accepting_orders: row.accepting_orders === undefined ? true : Boolean(row.accepting_orders),
  maintenance_mode: row.maintenance_mode === undefined ? false : Boolean(row.maintenance_mode),
  temporary_closed: row.temporary_closed === undefined ? false : Boolean(row.temporary_closed),
  working_hours: row.working_hours
    ? normalizeWorkingHours(row.working_hours, { required: true })
    : clone(DEFAULT_WORKING_HOURS),
  enforce_working_hours: row.enforce_working_hours === undefined ? true : Boolean(row.enforce_working_hours),
  feature_flags: {
    offline_v2_enabled: row.offline_v2_enabled === undefined ? false : Boolean(row.offline_v2_enabled),
    edge_enabled: row.edge_enabled === undefined ? false : Boolean(row.edge_enabled),
  },
  created_at: row.settings_created_at || row.created_at || null,
  updated_at: row.settings_updated_at || row.updated_at || null,
});

const buildDefaultBranchContext = (branchId) => ({
  branch: {
    branch_id: Number(branchId),
    name: `Branch ${branchId}`,
    timezone: DEFAULT_TIMEZONE,
    is_active: true,
    created_at: null,
    updated_at: null,
    deleted_at: null,
  },
  settings: {
    ...DEFAULT_BRANCH_SETTINGS,
    working_hours: clone(DEFAULT_WORKING_HOURS),
  },
});

const getBusinessSettings = async (client = null) => {
  await ensureSettingsSchema(client);
  const result = await runQuery(
    client,
    `
    SELECT
      id,
      uuid,
      default_currency,
      tax_enabled,
      default_tax_percent,
      rounding_rule::text AS rounding_rule,
      discount_stacking_enabled,
      admin_switch_pin,
      created_at,
      updated_at
    FROM business_settings
    ORDER BY id ASC
    LIMIT 1
    `
  );
  const row = result.rows[0];
  if (!row) return { ...DEFAULT_BUSINESS_SETTINGS };
  return mapBusinessSettings(row);
};

const updateBusinessSettings = async (payload = {}) => {
  if (!isObject(payload)) {
    throw new SettingsValidationError('payload must be an object');
  }

  const updates = {};
  if (payload.default_currency !== undefined) {
    updates.default_currency = toCurrencyCode(payload.default_currency);
  }
  if (payload.tax_enabled !== undefined) {
    updates.tax_enabled = toBoolean(payload.tax_enabled, 'tax_enabled');
  }
  if (payload.default_tax_percent !== undefined) {
    updates.default_tax_percent = toTaxPercent(payload.default_tax_percent);
  }
  if (payload.rounding_rule !== undefined) {
    updates.rounding_rule = normalizeRoundingRule(payload.rounding_rule);
  }
  if (payload.discount_stacking_enabled !== undefined) {
    updates.discount_stacking_enabled = toBoolean(
      payload.discount_stacking_enabled,
      'discount_stacking_enabled'
    );
  }
  if (payload.admin_switch_pin !== undefined) {
    updates.admin_switch_pin = normalizeAdminSwitchPin(payload.admin_switch_pin);
  }
  if (Object.keys(updates).length === 0) {
    throw new SettingsValidationError('No business settings fields provided');
  }

  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    await ensureSettingsSchema(client);

    const row = (await runQuery(client, 'SELECT id FROM business_settings ORDER BY id ASC LIMIT 1 FOR UPDATE'))
      .rows[0];
    const id = row?.id;
    if (!id) throw new SettingsValidationError('Failed to load business settings', 500);

    const params = [id];
    const setClauses = [];
    let i = 2;
    Object.entries(updates).forEach(([key, value]) => {
      setClauses.push(`${key} = $${i}`);
      params.push(value);
      i += 1;
    });
    setClauses.push('updated_at = now()');

    const result = await runQuery(
      client,
      `
      UPDATE business_settings
      SET ${setClauses.join(', ')}
      WHERE id = $1
      RETURNING
        id,
        uuid,
        default_currency,
        tax_enabled,
        default_tax_percent,
        rounding_rule::text AS rounding_rule,
        discount_stacking_enabled,
        admin_switch_pin,
        created_at,
        updated_at
      `,
      params
    );
    await client.query('COMMIT');
    return mapBusinessSettings(result.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

const resolveScopedBranchIds = ({ user, fallbackBranchId = null }) => {
  if (user?.role === 'admin') {
    const list = (Array.isArray(user.branch_ids) && user.branch_ids) || [];
    const parsed = list.map((value) => Number(value)).filter((value) => Number.isInteger(value) && value > 0);
    if (parsed.length) return Array.from(new Set(parsed));
  } else {
    const own = Number(user?.branch_id || 0);
    if (Number.isInteger(own) && own > 0) return [own];
  }
  if (fallbackBranchId) return [toPositiveInt(fallbackBranchId, 'branch_id')];
  return [];
};

const listBranchesByScope = async ({ user, fallbackBranchId = null, client = null }) => {
  const scoped = resolveScopedBranchIds({ user, fallbackBranchId });
  if (!scoped.length) {
    throw new SettingsValidationError('No branch scope available', 403);
  }

  await ensureSettingsSchema(client);

  const result = await runQuery(
    client,
    `
    SELECT
      b.id AS branch_id,
      b.name,
      b.timezone,
      b.is_active,
      b.created_at,
      b.updated_at,
      b.deleted_at
    FROM branches b
    WHERE b.id = ANY($1::bigint[])
      AND b.deleted_at IS NULL
    ORDER BY b.id ASC
    `,
    [scoped]
  );

  return result.rows.map((row) => {
    const branch = mapBranchRow(row);
    return {
      id: branch.branch_id,
      branch_id: branch.branch_id,
      name: branch.name,
      timezone: branch.timezone,
      is_active: branch.is_active,
      created_at: branch.created_at,
      updated_at: branch.updated_at,
      deleted_at: branch.deleted_at,
    };
  });
};

const createBranch = async ({ payload = {}, user = null }) => {
  if (!user || user.role !== 'admin') {
    throw new SettingsValidationError('Only admin can create branches', 403);
  }
  if (!isObject(payload)) {
    throw new SettingsValidationError('payload must be an object');
  }

  const name = normalizeBranchName(payload.name);
  const timezone = normalizeTimezone(payload.timezone || DEFAULT_TIMEZONE);
  const isActive = payload.is_active === undefined ? true : toBoolean(payload.is_active, 'is_active');

  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    await ensureSettingsSchema(client);

    const nextResult = await runQuery(
      client,
      `
      SELECT GREATEST(
        COALESCE((SELECT MAX(id) FROM branches), 0),
        0
      ) AS max_id
      `
    );
    const branchId = Number(nextResult.rows[0]?.max_id || 0) + 1;

    await runQuery(
      client,
      `
      INSERT INTO branches (
        id,
        name,
        timezone,
        is_active,
        created_at,
        updated_at,
        deleted_at
      )
      VALUES ($1, $2, $3, $4, now(), now(), NULL)
      `,
      [branchId, name, timezone, isActive]
    );

    await ensureBranchSettingsRecord(client, branchId);

    await client.query('COMMIT');
    return getBranchSettingsById(branchId);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

const deleteBranch = async ({ branchId: branchIdInput, user = null }) => {
  if (!user || user.role !== 'admin') {
    throw new SettingsValidationError('Only admin can delete branches', 403);
  }

  const branchId = toPositiveInt(branchIdInput, 'branch_id');
  const allowed = Array.isArray(user.branch_ids) ? user.branch_ids : [];
  if (allowed.length && !allowed.includes(branchId)) {
    throw new SettingsValidationError('Branch is not in admin scope', 403);
  }

  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    await ensureSettingsSchema(client);

    const existing = await runQuery(
      client,
      `
      SELECT id
      FROM branches
      WHERE id = $1
        AND deleted_at IS NULL
      LIMIT 1
      FOR UPDATE
      `,
      [branchId]
    );

    if (!existing.rows[0]) {
      throw new SettingsValidationError('Branch not found', 404);
    }

    const countResult = await runQuery(
      client,
      `
      SELECT COUNT(*)::int AS active_count
      FROM branches
      WHERE deleted_at IS NULL
      `
    );
    const activeCount = Number(countResult.rows[0]?.active_count || 0);
    if (activeCount <= 1) {
      throw new SettingsValidationError('Cannot delete the last active branch', 409);
    }

    await runQuery(
      client,
      `
      UPDATE branches
      SET
        is_active = FALSE,
        deleted_at = now(),
        updated_at = now()
      WHERE id = $1
      `,
      [branchId]
    );

    await client.query('COMMIT');
    return {
      branch_id: branchId,
      deleted: true,
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

const fetchBranchWithSettings = async ({ client, branchId }) => {
  const result = await runQuery(
    client,
    `
    SELECT
      b.id AS branch_id,
      b.name AS branch_name,
      b.timezone AS branch_timezone,
      b.is_active AS branch_is_active,
      b.created_at AS branch_created_at,
      b.updated_at AS branch_updated_at,
      b.deleted_at AS branch_deleted_at,
      bs.id AS settings_id,
      bs.is_open,
      bs.accepting_orders,
      bs.maintenance_mode,
      bs.temporary_closed,
      bs.working_hours,
      bs.enforce_working_hours,
      ff.offline_v2_enabled,
      ff.edge_enabled,
      bs.created_at AS settings_created_at,
      bs.updated_at AS settings_updated_at
    FROM branches b
    LEFT JOIN branch_settings bs
      ON bs.branch_id = b.id
    LEFT JOIN branch_feature_flags ff
      ON ff.branch_id = b.id
    WHERE b.id = $1
      AND b.deleted_at IS NULL
    LIMIT 1
    `,
    [branchId]
  );
  return result.rows[0] || null;
};

const getBranchSettingsById = async (branchIdInput, client = null) => {
  const branchId = toPositiveInt(branchIdInput, 'branch_id');
  await ensureSettingsSchema(client);

  if (client) {
    let row = await fetchBranchWithSettings({ client, branchId });
    if (!row) {
      throw new SettingsValidationError('Branch not found. Add branch name first in Settings.', 404);
    }
    if (!row.settings_id) {
      await ensureBranchSettingsRecord(client, branchId);
      await ensureBranchFeatureFlagsRecord(client, branchId);
      row = await fetchBranchWithSettings({ client, branchId });
    }
    await ensureBranchFeatureFlagsRecord(client, branchId);
    row = await fetchBranchWithSettings({ client, branchId });
    return { branch: mapBranchRow(row), settings: mapBranchSettingsRow(row) };
  }

  if (!db || typeof db.getClient !== 'function') {
    let row = await fetchBranchWithSettings({ client: null, branchId });
    if (!row) {
      throw new SettingsValidationError('Branch not found. Add branch name first in Settings.', 404);
    }
    if (!row.settings_id) {
      await ensureBranchSettingsRecord(null, branchId);
      await ensureBranchFeatureFlagsRecord(null, branchId);
      row = await fetchBranchWithSettings({ client: null, branchId });
    }
    await ensureBranchFeatureFlagsRecord(null, branchId);
    row = await fetchBranchWithSettings({ client: null, branchId });
    return { branch: mapBranchRow(row), settings: mapBranchSettingsRow(row) };
  }

  const ownedClient = await db.getClient();
  try {
    await ownedClient.query('BEGIN');
    await ensureSettingsSchema(ownedClient);
    let row = await fetchBranchWithSettings({ client: ownedClient, branchId });
    if (!row) {
      throw new SettingsValidationError('Branch not found. Add branch name first in Settings.', 404);
    }
    if (!row.settings_id) {
      await ensureBranchSettingsRecord(ownedClient, branchId);
      await ensureBranchFeatureFlagsRecord(ownedClient, branchId);
      row = await fetchBranchWithSettings({ client: ownedClient, branchId });
    }
    await ensureBranchFeatureFlagsRecord(ownedClient, branchId);
    row = await fetchBranchWithSettings({ client: ownedClient, branchId });
    await ownedClient.query('COMMIT');
    return { branch: mapBranchRow(row), settings: mapBranchSettingsRow(row) };
  } catch (err) {
    await ownedClient.query('ROLLBACK');
    throw err;
  } finally {
    if (ownedClient && typeof ownedClient.release === 'function') {
      ownedClient.release();
    }
  }
};

const updateBranchSettings = async (branchIdInput, payload = {}) => {
  if (!isObject(payload)) {
    throw new SettingsValidationError('payload must be an object');
  }
  const branchId = toPositiveInt(branchIdInput, 'branch_id');

  const updates = {};
  if (payload.is_open !== undefined) {
    updates.is_open = toBoolean(payload.is_open, 'is_open');
  }
  if (payload.accepting_orders !== undefined) {
    updates.accepting_orders = toBoolean(payload.accepting_orders, 'accepting_orders');
  }
  if (payload.maintenance_mode !== undefined) {
    updates.maintenance_mode = toBoolean(payload.maintenance_mode, 'maintenance_mode');
  }
  if (payload.temporary_closed !== undefined) {
    updates.temporary_closed = toBoolean(payload.temporary_closed, 'temporary_closed');
  }
  if (payload.enforce_working_hours !== undefined) {
    updates.enforce_working_hours = toBoolean(payload.enforce_working_hours, 'enforce_working_hours');
  }
  if (payload.working_hours !== undefined) {
    updates.working_hours = normalizeWorkingHours(payload.working_hours, { required: true });
  }
  const featureFlags = isObject(payload.feature_flags) ? payload.feature_flags : null;
  const hasFeatureFlagChanges = featureFlags
    && (featureFlags.offline_v2_enabled !== undefined || featureFlags.edge_enabled !== undefined);

  if (Object.keys(updates).length === 0 && !hasFeatureFlagChanges) {
    throw new SettingsValidationError('No branch settings fields provided');
  }

  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    await ensureSettingsSchema(client);

    const branchRow = await runQuery(
      client,
      `
      SELECT id
      FROM branches
      WHERE id = $1
        AND deleted_at IS NULL
      LIMIT 1
      FOR UPDATE
      `,
      [branchId]
    );
    const actualBranchId = Number(branchRow.rows[0]?.id || 0);
    if (!actualBranchId) {
      throw new SettingsValidationError('Branch not found. Add branch name first in Settings.', 404);
    }

    await ensureBranchSettingsRecord(client, actualBranchId);
    await ensureBranchFeatureFlagsRecord(client, actualBranchId);

    const setClauses = [];
    const params = [actualBranchId];
    let i = 2;
    Object.entries(updates).forEach(([key, value]) => {
      if (key === 'working_hours') {
        setClauses.push(`${key} = $${i}::jsonb`);
        params.push(JSON.stringify(value));
      } else {
        setClauses.push(`${key} = $${i}`);
        params.push(value);
      }
      i += 1;
    });
    setClauses.push('updated_at = now()');

    await runQuery(
      client,
      `
      UPDATE branch_settings
      SET ${setClauses.join(', ')}
      WHERE branch_id = $1
      `,
      params
    );

    if (hasFeatureFlagChanges) {
      const updatesFeature = [];
      const featureParams = [actualBranchId];
      let featureParamIdx = 2;

      if (featureFlags.offline_v2_enabled !== undefined) {
        updatesFeature.push(`offline_v2_enabled = $${featureParamIdx}`);
        featureParams.push(toBoolean(featureFlags.offline_v2_enabled, 'feature_flags.offline_v2_enabled'));
        featureParamIdx += 1;
      }
      if (featureFlags.edge_enabled !== undefined) {
        updatesFeature.push(`edge_enabled = $${featureParamIdx}`);
        featureParams.push(toBoolean(featureFlags.edge_enabled, 'feature_flags.edge_enabled'));
        featureParamIdx += 1;
      }
      updatesFeature.push('updated_at = now()');

      await runQuery(
        client,
        `
        UPDATE branch_feature_flags
        SET ${updatesFeature.join(', ')}
        WHERE branch_id = $1
        `,
        featureParams
      );
    }

    await client.query('COMMIT');
    return getBranchSettingsById(actualBranchId);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

const validateWorkingHours = (workingHours, timezone, nowUtc = new Date()) => {
  const normalizedHours = normalizeWorkingHours(workingHours, { required: true });
  const safeTimezone = normalizeTimezone(timezone);
  const nowParts = formatNowInTimezone(nowUtc, safeTimezone);
  const schedule = normalizedHours[nowParts.weekday];
  if (!schedule) {
    return {
      allowed: false,
      weekday: nowParts.weekday,
      current_time: `${String(nowParts.hour).padStart(2, '0')}:${String(nowParts.minute).padStart(2, '0')}`,
      open: null,
      close: null,
    };
  }

  const openMinutes = parseTimeToMinutes(schedule.open);
  const closeMinutes = parseTimeToMinutes(schedule.close);
  const currentMinutes = nowParts.hour * 60 + nowParts.minute;
  const allowed = isWithinWindow(currentMinutes, openMinutes, closeMinutes);

  return {
    allowed,
    weekday: nowParts.weekday,
    current_time: `${String(nowParts.hour).padStart(2, '0')}:${String(nowParts.minute).padStart(2, '0')}`,
    open: schedule.open,
    close: schedule.close,
  };
};

const computeTax = (taxableAmount, businessSettings) => {
  const amount = Math.max(0, Number(taxableAmount) || 0);
  if (!businessSettings || !businessSettings.tax_enabled) return 0;
  const percent = Number(businessSettings.default_tax_percent || 0);
  return applyRounding(amount * (percent / 100), businessSettings.rounding_rule || 'none');
};

const assertBranchOrderAllowed = async ({ branchId, outletId, role, nowUtc = new Date(), client = null }) => {
  const resolvedBranchId = branchId ?? outletId;
  const context = await getBranchSettingsById(resolvedBranchId, client);
  const { branch, settings } = context;

  if (!branch.is_active || branch.deleted_at) {
    throw new SettingsValidationError('Branch is inactive', 409);
  }
  if (settings.maintenance_mode && role !== 'admin') {
    throw new SettingsValidationError('Branch is in maintenance mode', 503);
  }
  if (!settings.is_open) {
    throw new SettingsValidationError('Branch is closed', 409);
  }
  if (!settings.accepting_orders) {
    throw new SettingsValidationError('Branch is not accepting orders', 409);
  }
  if (settings.temporary_closed) {
    throw new SettingsValidationError('Branch is temporarily closed', 409);
  }
  if (settings.enforce_working_hours) {
    const check = validateWorkingHours(settings.working_hours, branch.timezone, nowUtc);
    if (!check.allowed) {
      throw new SettingsValidationError(
        `Branch is outside working hours (${check.open || '--:--'} - ${check.close || '--:--'})`,
        409
      );
    }
  }
  return context;
};

module.exports = {
  WEEK_DAYS,
  DEFAULT_WORKING_HOURS,
  DEFAULT_BUSINESS_SETTINGS,
  DEFAULT_BRANCH_SETTINGS,
  SettingsValidationError,
  getBusinessSettings,
  updateBusinessSettings,
  getBranchSettingsById,
  listBranchesByScope,
  createBranch,
  deleteBranch,
  updateBranchSettings,
  assertBranchOrderAllowed,
  applyRounding,
  computeTax,
  validateWorkingHours,
};
