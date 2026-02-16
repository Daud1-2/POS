import React, { useEffect, useMemo, useState } from 'react';

const roundMoney = (value) => Number(Number(value || 0).toFixed(2));
const formatMoney = (value) => `PKR ${Number(value || 0).toLocaleString()}`;

const normalizeAddonGroups = (value) => {
  if (!Array.isArray(value)) return [];
  return value
    .map((group, groupIndex) => {
      const label = String(group?.label || group?.name || '').trim();
      const id = String(group?.id || '').trim() || `group_${groupIndex + 1}`;
      if (!label) return null;

      const options = Array.isArray(group?.options)
        ? group.options
            .map((option, optionIndex) => {
              const optionLabel = String(option?.label || option?.name || '').trim();
              if (!optionLabel) return null;
              const optionId =
                String(option?.id || '').trim() || `option_${groupIndex + 1}_${optionIndex + 1}`;
              const parsedPrice = Number(option?.price_delta ?? option?.price ?? 0);
              return {
                id: optionId,
                label: optionLabel,
                price_delta: Number.isFinite(parsedPrice) ? Number(parsedPrice.toFixed(2)) : 0,
                is_default: Boolean(option?.is_default),
              };
            })
            .filter(Boolean)
        : [];

      if (!options.length) return null;

      const minSelectRaw = Number(group?.min_select);
      const minSelect = Number.isInteger(minSelectRaw) && minSelectRaw >= 0 ? minSelectRaw : 0;
      const maxSelectRaw = Number(group?.max_select);
      const maxSelect = Number.isInteger(maxSelectRaw) && maxSelectRaw > 0 ? maxSelectRaw : null;

      return {
        id,
        label,
        required: Boolean(group?.required),
        multi: Boolean(group?.multi),
        min_select: minSelect,
        max_select: maxSelect,
        options,
      };
    })
    .filter(Boolean);
};

const buildInitialSelections = (groups) => {
  const selected = {};
  groups.forEach((group) => {
    const defaults = group.options.filter((option) => option.is_default).map((option) => option.id);
    if (defaults.length) {
      selected[group.id] = group.multi ? defaults : [defaults[0]];
      return;
    }
    if (group.required && !group.multi && group.options.length > 0) {
      selected[group.id] = [group.options[0].id];
    }
  });
  return selected;
};

function AddOnModal({ open, item, addonGroups, onClose, onConfirm }) {
  const [quantity, setQuantity] = useState(1);
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [imageBroken, setImageBroken] = useState(false);
  const [selectedByGroup, setSelectedByGroup] = useState({});

  const groups = useMemo(() => normalizeAddonGroups(addonGroups), [addonGroups]);

  useEffect(() => {
    if (!open) return;
    setQuantity(1);
    setNote('');
    setError('');
    setImageBroken(false);
    setSelectedByGroup(buildInitialSelections(groups));
  }, [groups, open, item?.id]);

  const addonUnitDelta = useMemo(() => {
    return roundMoney(
      groups.reduce((sum, group) => {
        const selectedIds = selectedByGroup[group.id] || [];
        const optionMap = new Map(group.options.map((option) => [option.id, option]));
        return (
          sum
          + selectedIds.reduce((groupSum, optionId) => {
            const option = optionMap.get(optionId);
            return groupSum + Number(option?.price_delta || 0);
          }, 0)
        );
      }, 0)
    );
  }, [groups, selectedByGroup]);

  const unitPrice = useMemo(
    () => roundMoney(Number(item?.effective_price || 0) + addonUnitDelta),
    [addonUnitDelta, item?.effective_price]
  );

  const handleToggleOption = (group, optionId) => {
    setSelectedByGroup((prev) => {
      const current = prev[group.id] || [];
      if (!group.multi) {
        return { ...prev, [group.id]: [optionId] };
      }

      if (current.includes(optionId)) {
        return { ...prev, [group.id]: current.filter((id) => id !== optionId) };
      }

      const next = [...current, optionId];
      const maxAllowed =
        Number.isInteger(group.max_select) && group.max_select > 0 ? group.max_select : null;
      if (maxAllowed !== null && next.length > maxAllowed) {
        return { ...prev, [group.id]: next.slice(0, maxAllowed) };
      }
      return { ...prev, [group.id]: next };
    });
    setError('');
  };

  const validateSelections = () => {
    for (const group of groups) {
      const selectedIds = selectedByGroup[group.id] || [];
      const minRequired = Number.isInteger(group.min_select)
        ? group.min_select
        : group.required
          ? 1
          : 0;
      const maxAllowed =
        Number.isInteger(group.max_select) && group.max_select > 0
          ? group.max_select
          : group.multi
            ? null
            : 1;

      if (!group.multi && selectedIds.length > 1) {
        return `${group.label}: only one option can be selected`;
      }
      if (maxAllowed !== null && selectedIds.length > maxAllowed) {
        return `${group.label}: maximum ${maxAllowed} option(s) allowed`;
      }
      if (selectedIds.length < minRequired) {
        return `${group.label}: minimum ${minRequired} option(s) required`;
      }
    }
    return '';
  };

  const handleConfirm = () => {
    const validationError = validateSelections();
    if (validationError) {
      setError(validationError);
      return;
    }

    const selectedAddons = groups
      .map((group) => {
        const optionMap = new Map(group.options.map((option) => [option.id, option]));
        const selectedIds = selectedByGroup[group.id] || [];
        if (!selectedIds.length) return null;
        return {
          group_id: group.id,
          group_label: group.label,
          required: group.required,
          multi: group.multi,
          options: selectedIds
            .map((optionId) => optionMap.get(optionId))
            .filter(Boolean)
            .map((option) => ({
              option_id: option.id,
              label: option.label,
              price_delta: Number(option.price_delta || 0),
            })),
        };
      })
      .filter(Boolean);

    onConfirm({
      quantity: Math.max(1, Number(quantity || 1)),
      note: String(note || '').trim(),
      selectedAddons,
      addonUnitDelta,
      unitPrice,
    });
  };

  if (!open || !item) return null;

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/65 px-2 py-2 md:px-6 md:py-6">
      <div className="mx-auto flex h-full max-w-7xl flex-col overflow-hidden rounded-2xl border border-slate-300 bg-white shadow-2xl">
        <div className="flex-1 overflow-hidden md:grid md:grid-cols-[minmax(0,1fr)_520px]">
          <section className="relative h-72 overflow-hidden bg-slate-900 text-white md:h-full">
            {item.image_url && !imageBroken ? (
              <img
                src={item.image_url}
                alt={item.name}
                className="h-full w-full object-cover opacity-90"
                onError={() => setImageBroken(true)}
              />
            ) : (
              <div className="flex h-full items-center justify-center bg-gradient-to-br from-slate-700 to-slate-900 text-base font-semibold">
                {item.name}
              </div>
            )}
            <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent" />
            <button
              type="button"
              onClick={onClose}
              className="absolute right-3 top-3 rounded-md bg-black/45 px-2 py-1 text-xs font-semibold text-white"
            >
              Close
            </button>
            <div className="absolute bottom-0 left-0 right-0 p-5">
              <p className="text-3xl font-semibold">{item.name}</p>
              <p className="mt-2 max-w-2xl text-sm text-white/90">{item.description || 'Customize this item before adding to cart.'}</p>
            </div>
          </section>

          <section className="flex flex-col bg-slate-100">
            <div className="flex-1 space-y-3 overflow-y-auto p-3 md:p-4">
              {groups.map((group) => {
                const selectedIds = selectedByGroup[group.id] || [];
                const maxAllowed =
                  Number.isInteger(group.max_select) && group.max_select > 0
                    ? group.max_select
                    : group.multi
                      ? null
                      : 1;
                return (
                  <div key={group.id} className="rounded-xl border border-slate-200 bg-white">
                    <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 bg-slate-50 px-3 py-2">
                      <h3 className="text-base font-semibold text-slate-800">{group.label}</h3>
                      {group.required && (
                        <span className="rounded-md bg-rose-600 px-2 py-0.5 text-xs font-semibold text-white">
                          Required
                        </span>
                      )}
                      <span className="text-xs text-slate-500">
                        {group.multi ? 'Multiple choices' : 'Single choice'}
                        {maxAllowed ? ` (max ${maxAllowed})` : ''}
                      </span>
                    </div>
                    <div className="divide-y divide-slate-100">
                      {group.options.map((option) => {
                        const checked = selectedIds.includes(option.id);
                        return (
                          <button
                            key={option.id}
                            type="button"
                            onClick={() => handleToggleOption(group, option.id)}
                            className={`flex w-full items-center justify-between gap-3 px-3 py-3 text-left transition ${
                              checked ? 'bg-brandYellow/15' : 'hover:bg-slate-50'
                            }`}
                          >
                            <span className="flex items-center gap-3">
                              <span
                                className={`h-5 w-5 rounded-full border-2 ${
                                  checked
                                    ? 'border-slate-800 bg-slate-800'
                                    : 'border-slate-300 bg-white'
                                }`}
                              />
                              <span className="text-lg text-slate-900">{option.label}</span>
                            </span>
                            <span className="text-lg font-medium text-slate-500">
                              {option.price_delta > 0 ? `+ ${formatMoney(option.price_delta)}` : formatMoney(option.price_delta)}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}

              <div className="rounded-xl border border-slate-200 bg-white p-3">
                <h3 className="text-base font-semibold text-slate-800">Instructions</h3>
                <textarea
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  placeholder="Any special requests?"
                  className="mt-2 min-h-[110px] w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                />
              </div>

              {error && (
                <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>
              )}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 bg-white px-3 py-3 md:px-4">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setQuantity((prev) => Math.max(1, Number(prev || 1) - 1))}
                  className="h-11 w-11 rounded-xl bg-rose-600 text-2xl font-semibold text-white"
                >
                  -
                </button>
                <div className="flex h-11 min-w-[64px] items-center justify-center rounded-xl border border-slate-300 bg-white text-lg font-medium text-slate-800">
                  {Math.max(1, Number(quantity || 1))}
                </div>
                <button
                  type="button"
                  onClick={() => setQuantity((prev) => Math.max(1, Number(prev || 1) + 1))}
                  className="h-11 w-11 rounded-xl bg-rose-600 text-2xl font-semibold text-white"
                >
                  +
                </button>
              </div>

              <button
                type="button"
                onClick={handleConfirm}
                className="rounded-xl bg-rose-700 px-5 py-3 text-lg font-semibold text-white hover:bg-rose-800"
              >
                {`from ${formatMoney(unitPrice)}  Add To Cart`}
              </button>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

export default AddOnModal;
