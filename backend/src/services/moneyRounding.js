const ROUNDING_RULES = new Set(['none', 'round_up', 'round_down', 'bankers_rounding']);

const toNumber = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return parsed;
};

const roundToTwo = (value) => Number(toNumber(value).toFixed(2));

const roundUpToTwo = (value) => {
  const scaled = Math.ceil((toNumber(value) + Number.EPSILON) * 100);
  return Number((scaled / 100).toFixed(2));
};

const roundDownToTwo = (value) => {
  const scaled = Math.floor((toNumber(value) + Number.EPSILON) * 100);
  return Number((scaled / 100).toFixed(2));
};

const bankersRoundToTwo = (value) => {
  const numeric = toNumber(value);
  const sign = numeric < 0 ? -1 : 1;
  const absolute = Math.abs(numeric);
  const scaled = absolute * 100;
  const floor = Math.floor(scaled);
  const diff = scaled - floor;
  const epsilon = 1e-8;

  let roundedInt;
  if (diff > 0.5 + epsilon) {
    roundedInt = floor + 1;
  } else if (diff < 0.5 - epsilon) {
    roundedInt = floor;
  } else {
    roundedInt = floor % 2 === 0 ? floor : floor + 1;
  }

  return Number(((roundedInt / 100) * sign).toFixed(2));
};

const applyRounding = (value, rule = 'none') => {
  if (!ROUNDING_RULES.has(rule)) return roundToTwo(value);
  if (rule === 'round_up') return roundUpToTwo(value);
  if (rule === 'round_down') return roundDownToTwo(value);
  if (rule === 'bankers_rounding') return bankersRoundToTwo(value);
  return roundToTwo(value);
};

module.exports = {
  ROUNDING_RULES,
  applyRounding,
  roundToTwo,
};
