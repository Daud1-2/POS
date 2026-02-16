const roundMoney = (value) => Number(Number(value || 0).toFixed(2));

const toBool = (value, fallback = false) => {
  if (value === undefined || value === null) return fallback;
  if (typeof value === 'boolean') return value;
  if (value === 'true' || value === '1' || value === 1) return true;
  if (value === 'false' || value === '0' || value === 0) return false;
  return fallback;
};

const toObject = (value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value;
};

const toText = (value, fallback = '') => {
  if (value === undefined || value === null) return fallback;
  const text = String(value).trim();
  return text || fallback;
};

const toInt = (value, { min = 0, fallback = null } = {}) => {
  if (value === undefined || value === null || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min) return fallback;
  return parsed;
};

const toMoney = (value, fallback = 0) => {
  if (value === undefined || value === null || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return roundMoney(parsed);
};

const parseAddonGroups = (value) => {
  if (value === undefined || value === null) return [];
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    const raw = value.trim();
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch (_) {
      return [];
    }
  }
  return [];
};

const normalizeAddonGroups = (value) => {
  const seenGroupIds = new Set();
  const groups = [];

  parseAddonGroups(value).forEach((rawGroup, groupIndex) => {
    const group = toObject(rawGroup);
    const label = toText(group.label || group.name);
    const id = toText(group.id, `group_${groupIndex + 1}`);
    if (!label || !id || seenGroupIds.has(id)) return;
    seenGroupIds.add(id);

    const required = toBool(group.required, false);
    const multi = toBool(group.multi, false);
    const minSelect = toInt(group.min_select, { min: 0, fallback: required ? 1 : 0 });
    const maxSelect = toInt(group.max_select, { min: 1, fallback: null });

    const rawOptions = Array.isArray(group.options) ? group.options : [];
    const seenOptionIds = new Set();
    const options = [];

    rawOptions.forEach((rawOption, optionIndex) => {
      const option = toObject(rawOption);
      const optionLabel = toText(option.label || option.name);
      const optionId = toText(option.id, `option_${groupIndex + 1}_${optionIndex + 1}`);
      if (!optionLabel || !optionId || seenOptionIds.has(optionId)) return;
      seenOptionIds.add(optionId);
      options.push({
        id: optionId,
        label: optionLabel,
        price_delta: toMoney(option.price_delta ?? option.price ?? option.price_delta_amount, 0),
        is_default: toBool(option.is_default, false),
      });
    });

    if (!options.length) return;

    groups.push({
      id,
      label,
      required,
      multi,
      min_select: minSelect,
      max_select: maxSelect,
      options,
    });
  });

  return groups;
};

const normalizeSelectionInput = (modifiers) => {
  const rawModifiers = toObject(modifiers);
  const rawAddons = rawModifiers.addons ?? rawModifiers.add_ons ?? rawModifiers.variants ?? [];
  if (!Array.isArray(rawAddons)) return [];

  return rawAddons
    .map((rawEntry) => {
      const entry = toObject(rawEntry);
      const groupId = toText(entry.group_id ?? entry.groupId ?? entry.id);
      if (!groupId) return null;

      let optionValues = [];
      if (Array.isArray(entry.option_ids)) {
        optionValues = entry.option_ids;
      } else if (entry.option_id !== undefined && entry.option_id !== null && entry.option_id !== '') {
        optionValues = [entry.option_id];
      } else if (Array.isArray(entry.options)) {
        optionValues = entry.options.map((value) => {
          if (value === undefined || value === null) return '';
          if (typeof value === 'string' || typeof value === 'number') return value;
          if (typeof value === 'object' && !Array.isArray(value)) {
            return value.option_id ?? value.optionId ?? value.id ?? '';
          }
          return '';
        });
      }

      const uniqueOptionIds = Array.from(
        new Set(
          optionValues
            .map((value) => toText(value))
            .filter(Boolean)
        )
      );

      return {
        group_id: groupId,
        option_ids: uniqueOptionIds,
      };
    })
    .filter(Boolean);
};

const resolveAddonSelections = ({
  addonGroups,
  modifiers,
  createError = (message) => new Error(message),
  fieldPath = 'modifiers.addons',
}) => {
  const groups = normalizeAddonGroups(addonGroups);
  const requestedSelections = normalizeSelectionInput(modifiers);

  if (!groups.length) {
    if (requestedSelections.length) {
      throw createError(`${fieldPath} is not allowed for this item`);
    }
    return {
      addons: [],
      unit_price_delta: 0,
    };
  }

  const groupById = new Map(groups.map((group) => [group.id, group]));
  const requestedByGroup = new Map();

  requestedSelections.forEach((entry) => {
    const group = groupById.get(entry.group_id);
    if (!group) {
      throw createError(`${fieldPath} includes unknown group_id ${entry.group_id}`);
    }
    const existing = requestedByGroup.get(entry.group_id) || [];
    requestedByGroup.set(entry.group_id, Array.from(new Set([...existing, ...entry.option_ids])));
  });

  const resolvedAddons = [];
  let unitPriceDelta = 0;

  groups.forEach((group) => {
    const optionMap = new Map(group.options.map((option) => [option.id, option]));
    let selectedOptionIds = requestedByGroup.get(group.id) || [];
    if (!selectedOptionIds.length) {
      const defaults = group.options.filter((option) => option.is_default);
      if (defaults.length) {
        selectedOptionIds = defaults.map((option) => option.id);
      }
    }

    const effectiveMin = Number.isInteger(group.min_select)
      ? group.min_select
      : group.required
        ? 1
        : 0;
    const effectiveMax =
      Number.isInteger(group.max_select) && group.max_select > 0
        ? group.max_select
        : group.multi
          ? null
          : 1;

    if (!group.multi && selectedOptionIds.length > 1) {
      throw createError(`${fieldPath} group ${group.id} allows only one option`);
    }
    if (effectiveMax !== null && selectedOptionIds.length > effectiveMax) {
      throw createError(`${fieldPath} group ${group.id} allows up to ${effectiveMax} option(s)`);
    }
    if (selectedOptionIds.length < effectiveMin) {
      throw createError(`${fieldPath} group ${group.id} requires at least ${effectiveMin} option(s)`);
    }

    if (!selectedOptionIds.length) return;

    const selectedOptions = selectedOptionIds.map((optionId) => {
      const option = optionMap.get(optionId);
      if (!option) {
        throw createError(`${fieldPath} group ${group.id} includes unknown option_id ${optionId}`);
      }
      unitPriceDelta = roundMoney(unitPriceDelta + Number(option.price_delta || 0));
      return {
        option_id: option.id,
        label: option.label,
        price_delta: roundMoney(option.price_delta || 0),
      };
    });

    resolvedAddons.push({
      group_id: group.id,
      group_label: group.label,
      required: group.required,
      multi: group.multi,
      options: selectedOptions,
    });
  });

  return {
    addons: resolvedAddons,
    unit_price_delta: roundMoney(unitPriceDelta),
  };
};

module.exports = {
  roundMoney,
  normalizeAddonGroups,
  resolveAddonSelections,
};
