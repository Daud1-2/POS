import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  getBranchId,
  getSections,
  createSection,
  updateSection,
  deleteSection,
  getItems,
  createItem,
  updateItem,
  toggleItemActive,
  deleteItem,
  getProductImages,
  addProductImageUrl,
  uploadProductImage,
  updateProductImage,
  deleteProductImage,
  getProductBranchSetting,
  upsertProductBranchSetting,
} from '../services/products';
import { getBranchDisplayLabel } from '../services/settings';

const TABS = [
  { key: 'sections', label: 'Sections Management' },
  { key: 'items', label: 'Items Management' },
  { key: 'images', label: 'Image Gallery' },
  { key: 'branches', label: 'Branch-Wise Toggle' },
];

const ITEM_FORM = {
  name: '',
  sku: '',
  section_id: '',
  base_price: '',
  profit_value: '',
  stock_quantity: '',
  description: '',
  track_inventory: true,
  is_active: true,
};

const createSectionForm = () => ({
  name: '',
  description: '',
  display_order: 0,
  is_active: true,
  addon_groups: [],
});

const normalizeSectionAddonGroups = (value) => {
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

const mapSectionToForm = (section = {}) => ({
  name: section.name || '',
  description: section.description || '',
  display_order: Number(section.display_order || 0),
  is_active: Boolean(section.is_active),
  addon_groups: normalizeSectionAddonGroups(section.addon_groups || []),
});

const createEmptyAddonOption = () => ({
  id: '',
  label: '',
  price_delta: 0,
  is_default: false,
});

const createEmptyAddonGroup = () => ({
  id: '',
  label: '',
  required: false,
  multi: false,
  min_select: 0,
  max_select: '',
  options: [createEmptyAddonOption()],
});

const formatMoney = (v) => `PKR ${Number(v || 0).toLocaleString()}`;

function Products() {
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = searchParams.get('tab');
  const activeTab = TABS.some((entry) => entry.key === tab) ? tab : 'items';
  const branchId = getBranchId();
  const branchLabel = getBranchDisplayLabel(branchId);

  const [flash, setFlash] = useState('');
  const [busy, setBusy] = useState(false);

  const [sections, setSections] = useState([]);
  const [sectionForm, setSectionForm] = useState(() => createSectionForm());
  const [editingSectionId, setEditingSectionId] = useState('');

  const [itemsResponse, setItemsResponse] = useState({
    data: [],
    meta: { page: 1, page_size: 10, total: 0, total_pages: 0 },
  });
  const [itemForm, setItemForm] = useState(ITEM_FORM);
  const [editingItemUid, setEditingItemUid] = useState('');
  const [search, setSearch] = useState('');

  const [selectedProductUid, setSelectedProductUid] = useState('');
  const [images, setImages] = useState([]);
  const [imageUrl, setImageUrl] = useState('');
  const [imageFile, setImageFile] = useState(null);

  const [branchForm, setBranchForm] = useState({
    is_available: true,
    price_override: '',
    stock_override: '',
  });

  const loadSections = useCallback(async () => {
    const data = await getSections();
    setSections(data);
  }, []);

  const loadItems = useCallback(
    async (page = 1, { includeUnavailable = false } = {}) => {
      const response = await getItems({
        page,
        pageSize: 10,
        search,
        includeUnavailable,
      });
      setItemsResponse(response);
      if (!selectedProductUid && response.data?.length) {
        setSelectedProductUid(response.data[0].product_uid);
      }
    },
    [search, selectedProductUid]
  );

  const loadImages = useCallback(async () => {
    if (!selectedProductUid) return setImages([]);
    const data = await getProductImages(selectedProductUid);
    setImages(data);
  }, [selectedProductUid]);

  const loadBranch = useCallback(async () => {
    if (!selectedProductUid) return;
    const data = await getProductBranchSetting(selectedProductUid, branchId);
    setBranchForm({
      is_available: data?.is_available ?? true,
      price_override: data?.price_override ?? '',
      stock_override: data?.stock_override ?? '',
    });
  }, [branchId, selectedProductUid]);

  useEffect(() => {
    if (!tab || !TABS.some((entry) => entry.key === tab)) {
      setSearchParams({ tab: 'items' }, { replace: true });
    }
  }, [tab, setSearchParams]);

  useEffect(() => {
    setBusy(true);
    Promise.all([loadSections(), loadItems(1, { includeUnavailable: activeTab === 'branches' })])
      .catch(() => setFlash('Failed to fetch product catalogue data'))
      .finally(() => setBusy(false));
  }, [activeTab, loadItems, loadSections]);

  useEffect(() => {
    if (activeTab === 'images') loadImages().catch(() => setFlash('Failed to load images'));
    if (activeTab === 'branches') loadBranch().catch(() => setFlash('Failed to load branch settings'));
  }, [activeTab, loadImages, loadBranch]);

  useEffect(() => {
    if (!['items', 'branches'].includes(activeTab)) return undefined;
    const timer = setInterval(() => {
      loadItems(itemsResponse.meta.page || 1, {
        includeUnavailable: activeTab === 'branches',
      }).catch(() => {});
      if (activeTab === 'branches') loadBranch().catch(() => {});
    }, 15000);
    return () => clearInterval(timer);
  }, [activeTab, itemsResponse.meta.page, loadItems, loadBranch]);

  const sectionOptions = useMemo(() => sections.filter((section) => section.is_active), [sections]);
  const selectedItem = useMemo(
    () => itemsResponse.data.find((item) => item.product_uid === selectedProductUid) || null,
    [itemsResponse.data, selectedProductUid]
  );

  const resetItemForm = () => {
    setEditingItemUid('');
    setItemForm(ITEM_FORM);
  };

  const resetSectionForm = () => {
    setEditingSectionId('');
    setSectionForm(createSectionForm());
  };

  const addAddonGroup = () => {
    setSectionForm((prev) => ({
      ...prev,
      addon_groups: [...(prev.addon_groups || []), createEmptyAddonGroup()],
    }));
  };

  const removeAddonGroup = (groupIndex) => {
    setSectionForm((prev) => ({
      ...prev,
      addon_groups: (prev.addon_groups || []).filter((_, index) => index !== groupIndex),
    }));
  };

  const updateAddonGroupField = (groupIndex, field, value) => {
    setSectionForm((prev) => ({
      ...prev,
      addon_groups: (prev.addon_groups || []).map((group, index) =>
        index === groupIndex ? { ...group, [field]: value } : group
      ),
    }));
  };

  const addAddonOption = (groupIndex) => {
    setSectionForm((prev) => ({
      ...prev,
      addon_groups: (prev.addon_groups || []).map((group, index) =>
        index === groupIndex
          ? { ...group, options: [...(group.options || []), createEmptyAddonOption()] }
          : group
      ),
    }));
  };

  const removeAddonOption = (groupIndex, optionIndex) => {
    setSectionForm((prev) => ({
      ...prev,
      addon_groups: (prev.addon_groups || []).map((group, index) => {
        if (index !== groupIndex) return group;
        const filtered = (group.options || []).filter((_, itemIndex) => itemIndex !== optionIndex);
        return {
          ...group,
          options: filtered.length ? filtered : [createEmptyAddonOption()],
        };
      }),
    }));
  };

  const updateAddonOptionField = (groupIndex, optionIndex, field, value) => {
    setSectionForm((prev) => ({
      ...prev,
      addon_groups: (prev.addon_groups || []).map((group, index) => {
        if (index !== groupIndex) return group;
        return {
          ...group,
          options: (group.options || []).map((option, itemIndex) =>
            itemIndex === optionIndex ? { ...option, [field]: value } : option
          ),
        };
      }),
    }));
  };

  const submitSection = async (event) => {
    event.preventDefault();
    setBusy(true);
    try {
      const payload = {
        ...sectionForm,
        display_order: Number(sectionForm.display_order || 0),
        addon_groups: normalizeSectionAddonGroups(sectionForm.addon_groups || []),
      };
      if (editingSectionId) await updateSection(editingSectionId, payload);
      else await createSection(payload);
      resetSectionForm();
      await loadSections();
      setFlash('Section saved');
    } catch (err) {
      const message = err?.response?.data?.error || 'Failed to save section';
      if (message.toLowerCase().includes('section not found')) {
        resetSectionForm();
        await loadSections();
      }
      setFlash(message);
    } finally {
      setBusy(false);
    }
  };

  const submitItem = async (event) => {
    event.preventDefault();
    setBusy(true);
    try {
      const payload = {
        ...itemForm,
        base_price: Number(itemForm.base_price),
        profit_value: Number(itemForm.profit_value || 0),
        stock_quantity: Number(itemForm.stock_quantity || 0),
      };
      if (editingItemUid) await updateItem(editingItemUid, payload);
      else await createItem(payload);
      resetItemForm();
      await loadItems(1);
      setFlash('Product saved');
    } catch (err) {
      setFlash(err?.response?.data?.error || 'Failed to save product');
    } finally {
      setBusy(false);
    }
  };

  const removeSection = async (sectionId) => {
    try {
      await deleteSection(sectionId);
      await loadSections();
      setFlash('Section deleted');
    } catch (err) {
      setFlash(err?.response?.data?.error || 'Failed to delete section');
    }
  };

  const removeItem = async (productUid) => {
    try {
      await deleteItem(productUid);
      await loadItems(1);
      setFlash('Product deleted');
    } catch (err) {
      setFlash(err?.response?.data?.error || 'Failed to delete product');
    }
  };

  const saveImageUrl = async (event) => {
    event.preventDefault();
    if (!selectedProductUid) return;
    try {
      await addProductImageUrl(selectedProductUid, { image_url: imageUrl });
      setImageUrl('');
      await loadImages();
      await loadItems(itemsResponse.meta.page || 1);
      setFlash('Image URL added');
    } catch (err) {
      setFlash(err?.response?.data?.error || 'Failed to add image');
    }
  };

  const uploadImageFile = async (event) => {
    event.preventDefault();
    if (!selectedProductUid || !imageFile) return;
    try {
      await uploadProductImage(selectedProductUid, imageFile, {});
      setImageFile(null);
      event.target.reset();
      await loadImages();
      await loadItems(itemsResponse.meta.page || 1);
      setFlash('Image uploaded');
    } catch (err) {
      setFlash(err?.response?.data?.error || 'Failed to upload image');
    }
  };

  const saveBranchSettings = async (event) => {
    event.preventDefault();
    if (!selectedProductUid) return;
    try {
      await upsertProductBranchSetting(selectedProductUid, branchId, {
        is_available: branchForm.is_available,
        price_override: branchForm.price_override === '' ? null : Number(branchForm.price_override),
        stock_override: branchForm.stock_override === '' ? null : Number(branchForm.stock_override),
      });
      await loadItems(itemsResponse.meta.page || 1, { includeUnavailable: activeTab === 'branches' });
      setFlash('Branch settings saved');
    } catch (err) {
      setFlash(err?.response?.data?.error || 'Failed to save branch settings');
    }
  };

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-card">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold">Products Catalogue</h1>
            <p className="text-sm text-slate-500">{branchLabel}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {TABS.map((entry) => (
              <button
                key={entry.key}
                type="button"
                onClick={() => setSearchParams({ tab: entry.key })}
                className={`px-3 py-2 rounded-lg text-xs border ${
                  activeTab === entry.key
                    ? 'bg-brandYellow border-brandYellow text-ink'
                    : 'border-slate-200 text-slate-600 hover:border-brandYellow/60'
                }`}
              >
                {entry.label}
              </button>
            ))}
          </div>
        </div>
        {flash && <div className="mt-3 rounded-lg bg-slate-100 text-slate-700 text-sm px-3 py-2">{flash}</div>}
      </div>

      {activeTab === 'sections' && (
        <div className="grid gap-4 lg:grid-cols-[520px_1fr]">
          <form
            onSubmit={submitSection}
            className="rounded-2xl border border-slate-200 bg-white p-4 shadow-soft space-y-3"
          >
            <h2 className="font-semibold">{editingSectionId ? 'Edit Section' : 'Create Section'}</h2>
            <input
              value={sectionForm.name}
              onChange={(e) => setSectionForm((p) => ({ ...p, name: e.target.value }))}
              placeholder="Name"
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            />
            <textarea
              value={sectionForm.description}
              onChange={(e) => setSectionForm((p) => ({ ...p, description: e.target.value }))}
              placeholder="Description"
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm min-h-[70px]"
            />
            <input
              type="number"
              value={sectionForm.display_order}
              onChange={(e) => setSectionForm((p) => ({ ...p, display_order: Number(e.target.value) }))}
              placeholder="Display order"
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            />

            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-sm font-semibold text-slate-800">Section Add-ons</h3>
                <button
                  type="button"
                  onClick={addAddonGroup}
                  className="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs font-medium text-slate-700"
                >
                  Add Group
                </button>
              </div>
              <p className="text-xs text-slate-500">
                Configure choices for products in this section. Example: burger cheese/sauce, pizza size.
              </p>

              {(!sectionForm.addon_groups || sectionForm.addon_groups.length === 0) && (
                <div className="rounded-lg border border-dashed border-slate-300 bg-white p-3 text-xs text-slate-500">
                  No add-on groups. Click "Add Group" to create one.
                </div>
              )}

              {(sectionForm.addon_groups || []).map((group, groupIndex) => (
                <div key={`${group.id || 'group'}-${groupIndex}`} className="rounded-lg border border-slate-200 bg-white p-3 space-y-2">
                  <div className="grid gap-2 sm:grid-cols-2">
                    <input
                      value={group.label || ''}
                      onChange={(e) => updateAddonGroupField(groupIndex, 'label', e.target.value)}
                      placeholder="Group label (e.g. Size)"
                      className="w-full rounded-md border border-slate-200 px-2 py-1.5 text-xs"
                    />
                    <input
                      value={group.id || ''}
                      onChange={(e) => updateAddonGroupField(groupIndex, 'id', e.target.value)}
                      placeholder="Group ID (optional)"
                      className="w-full rounded-md border border-slate-200 px-2 py-1.5 text-xs"
                    />
                  </div>

                  <div className="grid gap-2 sm:grid-cols-2 md:grid-cols-4">
                    <label className="text-xs flex items-center gap-1.5 text-slate-600">
                      <input
                        type="checkbox"
                        checked={Boolean(group.required)}
                        onChange={(e) => updateAddonGroupField(groupIndex, 'required', e.target.checked)}
                      />
                      Required
                    </label>
                    <label className="text-xs flex items-center gap-1.5 text-slate-600">
                      <input
                        type="checkbox"
                        checked={Boolean(group.multi)}
                        onChange={(e) => updateAddonGroupField(groupIndex, 'multi', e.target.checked)}
                      />
                      Multi select
                    </label>
                    <input
                      type="number"
                      min="0"
                      value={group.min_select ?? 0}
                      onChange={(e) => {
                        const value = e.target.value === '' ? 0 : Number(e.target.value);
                        updateAddonGroupField(groupIndex, 'min_select', Number.isFinite(value) ? value : 0);
                      }}
                      placeholder="Min select"
                      className="w-full rounded-md border border-slate-200 px-2 py-1.5 text-xs"
                    />
                    <input
                      type="number"
                      min="1"
                      value={group.max_select ?? ''}
                      onChange={(e) => updateAddonGroupField(groupIndex, 'max_select', e.target.value)}
                      placeholder="Max select (optional)"
                      className="w-full rounded-md border border-slate-200 px-2 py-1.5 text-xs"
                    />
                  </div>

                  <div className="space-y-1">
                    {(group.options || []).map((option, optionIndex) => (
                      <div
                        key={`${option.id || 'option'}-${optionIndex}`}
                        className="grid gap-2 sm:grid-cols-[1fr_1fr_120px_auto_auto]"
                      >
                        <input
                          value={option.label || ''}
                          onChange={(e) => updateAddonOptionField(groupIndex, optionIndex, 'label', e.target.value)}
                          placeholder="Option label"
                          className="w-full rounded-md border border-slate-200 px-2 py-1.5 text-xs"
                        />
                        <input
                          value={option.id || ''}
                          onChange={(e) => updateAddonOptionField(groupIndex, optionIndex, 'id', e.target.value)}
                          placeholder="Option ID"
                          className="w-full rounded-md border border-slate-200 px-2 py-1.5 text-xs"
                        />
                        <input
                          type="number"
                          step="0.01"
                          value={option.price_delta ?? 0}
                          onChange={(e) =>
                            updateAddonOptionField(
                              groupIndex,
                              optionIndex,
                              'price_delta',
                              e.target.value === '' ? 0 : Number(e.target.value)
                            )
                          }
                          placeholder="Price +/-"
                          className="w-full rounded-md border border-slate-200 px-2 py-1.5 text-xs"
                        />
                        <label className="text-xs flex items-center gap-1 text-slate-600">
                          <input
                            type="checkbox"
                            checked={Boolean(option.is_default)}
                            onChange={(e) =>
                              updateAddonOptionField(groupIndex, optionIndex, 'is_default', e.target.checked)
                            }
                          />
                          Default
                        </label>
                        <button
                          type="button"
                          onClick={() => removeAddonOption(groupIndex, optionIndex)}
                          className="rounded-md border border-rose-200 px-2 py-1 text-[11px] font-medium text-rose-600"
                        >
                          Remove
                        </button>
                      </div>
                    ))}
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => addAddonOption(groupIndex)}
                      className="rounded-md border border-slate-200 px-2 py-1 text-xs font-medium text-slate-700"
                    >
                      Add Option
                    </button>
                    <button
                      type="button"
                      onClick={() => removeAddonGroup(groupIndex)}
                      className="rounded-md border border-rose-200 px-2 py-1 text-xs font-medium text-rose-600"
                    >
                      Remove Group
                    </button>
                  </div>
                </div>
              ))}
            </div>

            <button type="submit" disabled={busy} className="w-full rounded-lg bg-brandYellow py-2 text-sm font-medium">
              Save Section
            </button>
            {editingSectionId && (
              <button type="button" onClick={resetSectionForm} className="w-full rounded-lg border border-slate-200 py-2 text-sm">
                Cancel Edit
              </button>
            )}
          </form>
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-soft space-y-2">
            {sections.length === 0 ? (
              <div className="text-sm text-slate-500">No sections yet</div>
            ) : (
              sections.map((section) => (
                <div key={section.id} className="flex items-center gap-2 border border-slate-100 rounded-lg p-2">
                  <div className="flex-1">
                    <div className="text-sm font-medium">{section.name}</div>
                    <div className="text-xs text-slate-500">
                      Display #{section.display_order} | Add-on groups {Array.isArray(section.addon_groups) ? section.addon_groups.length : 0}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setEditingSectionId(section.id);
                      setSectionForm(mapSectionToForm(section));
                    }}
                    className="px-2 py-1 border rounded text-xs"
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => removeSection(section.id)}
                    className="px-2 py-1 border border-rose-200 text-rose-600 rounded text-xs"
                  >
                    Delete
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {activeTab === 'items' && (
        <div className="space-y-4">
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-soft flex flex-wrap gap-2">
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search products" className="rounded-lg border border-slate-200 px-3 py-2 text-sm min-w-[220px]" />
            <button type="button" onClick={() => loadItems(1)} className="rounded-lg bg-slate-900 text-white px-3 py-2 text-sm">Search</button>
          </div>
          <div className="grid gap-4 lg:grid-cols-[340px_1fr]">
            <form onSubmit={submitItem} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-soft space-y-2">
              <h2 className="font-semibold">{editingItemUid ? 'Edit Item' : 'Add Item'}</h2>
              <input value={itemForm.name} onChange={(e) => setItemForm((p) => ({ ...p, name: e.target.value }))} placeholder="Name" className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" />
              <input value={itemForm.sku} onChange={(e) => setItemForm((p) => ({ ...p, sku: e.target.value }))} placeholder="SKU" className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" />
              <div className="grid grid-cols-3 gap-2">
                <input type="number" step="0.01" value={itemForm.base_price} onChange={(e) => setItemForm((p) => ({ ...p, base_price: e.target.value }))} placeholder="Base Price" className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" />
                <input type="number" step="0.01" value={itemForm.profit_value} onChange={(e) => setItemForm((p) => ({ ...p, profit_value: e.target.value }))} placeholder="Profit" className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" />
                <input type="number" value={itemForm.stock_quantity} onChange={(e) => setItemForm((p) => ({ ...p, stock_quantity: e.target.value }))} placeholder="Stock" className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" />
              </div>
              <select value={itemForm.section_id} onChange={(e) => setItemForm((p) => ({ ...p, section_id: e.target.value }))} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm">
                <option value="">Select section</option>
                {sectionOptions.map((section) => <option key={section.id} value={section.id}>{section.name}</option>)}
              </select>
              <textarea value={itemForm.description} onChange={(e) => setItemForm((p) => ({ ...p, description: e.target.value }))} placeholder="Description" className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm min-h-[70px]" />
              <button type="submit" disabled={busy} className="w-full rounded-lg bg-brandYellow py-2 text-sm font-medium">Save Item</button>
              {editingItemUid && <button type="button" onClick={resetItemForm} className="w-full rounded-lg border border-slate-200 py-2 text-sm">Cancel Edit</button>}
            </form>
            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-soft overflow-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-100 text-slate-700">
                  <tr>
                    <th className="text-left p-2">Image</th>
                    <th className="text-left p-2">Details</th>
                    <th className="text-left p-2">Price</th>
                    <th className="text-left p-2">Profit</th>
                    <th className="text-left p-2">Stock</th>
                    <th className="text-right p-2">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {itemsResponse.data.length === 0 ? (
                    <tr><td colSpan={6} className="text-center p-6 text-slate-500">{busy ? 'Loading...' : 'No items found'}</td></tr>
                  ) : itemsResponse.data.map((item) => (
                    <tr key={item.product_uid} className="border-b border-slate-100">
                      <td className="p-2">
                        {item.image_url ? <img src={item.image_url} alt={item.name} className="h-10 w-10 rounded-lg object-cover border border-slate-200" /> : <div className="h-10 w-10 rounded-lg border border-dashed border-slate-300" />}
                      </td>
                      <td className="p-2">
                        <div className="font-medium">{item.name}</div>
                        <div className="text-xs text-slate-500">{item.sku}</div>
                      </td>
                      <td className="p-2">{formatMoney(item.effective_price)}</td>
                      <td className="p-2">{formatMoney(item.profit_value)}</td>
                      <td className="p-2">{item.effective_stock}</td>
                      <td className="p-2">
                        <div className="flex justify-end gap-1">
                          <button type="button" onClick={() => { setEditingItemUid(item.product_uid); setItemForm({ ...ITEM_FORM, ...item }); }} className="px-2 py-1 border rounded text-xs">Edit</button>
                          <button type="button" onClick={() => toggleItemActive(item.product_uid, !item.is_active).then(() => loadItems(itemsResponse.meta.page || 1))} className="px-2 py-1 border rounded text-xs">Toggle</button>
                          <button type="button" onClick={() => { setSelectedProductUid(item.product_uid); setSearchParams({ tab: 'images' }); }} className="px-2 py-1 border rounded text-xs">Image</button>
                          <button type="button" onClick={() => removeItem(item.product_uid)} className="px-2 py-1 border border-rose-200 text-rose-600 rounded text-xs">Delete</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'images' && (
        <div className="grid gap-4 lg:grid-cols-[340px_1fr]">
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-soft space-y-2">
            <h2 className="font-semibold">Primary Image Slot</h2>
            <select value={selectedProductUid} onChange={(e) => setSelectedProductUid(e.target.value)} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm">
              <option value="">Select product</option>
              {itemsResponse.data.map((item) => <option key={item.product_uid} value={item.product_uid}>{item.name}</option>)}
            </select>
            <form onSubmit={saveImageUrl} className="space-y-2">
              <input value={imageUrl} onChange={(e) => setImageUrl(e.target.value)} placeholder="Image URL" className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" />
              <button type="submit" className="w-full rounded-lg bg-slate-900 text-white py-2 text-sm">Save URL</button>
            </form>
            <form onSubmit={uploadImageFile} className="space-y-2">
              <input type="file" accept="image/*" onChange={(e) => setImageFile(e.target.files?.[0] || null)} className="w-full text-sm" />
              <button type="submit" className="w-full rounded-lg bg-brandYellow text-ink py-2 text-sm">Upload Local File</button>
            </form>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-soft space-y-2">
            {images.length === 0 ? <div className="text-sm text-slate-500">No images yet</div> : images.map((image) => (
              <div key={image.id} className="flex items-center gap-3 border border-slate-100 rounded-lg p-2">
                <img src={image.image_url} alt="img" className="h-12 w-12 rounded-lg object-cover border border-slate-200" />
                <div className="flex-1">
                  <div className="text-xs text-slate-600 break-all">{image.image_url}</div>
                  <div className="text-[11px] text-slate-400">{image.is_primary ? 'Primary' : 'Secondary'}</div>
                </div>
                {!image.is_primary && <button type="button" onClick={() => updateProductImage(selectedProductUid, image.id, { is_primary: true }).then(() => loadImages())} className="px-2 py-1 border rounded text-xs">Primary</button>}
                <button type="button" onClick={() => deleteProductImage(selectedProductUid, image.id).then(() => loadImages())} className="px-2 py-1 border border-rose-200 text-rose-600 rounded text-xs">Delete</button>
              </div>
            ))}
          </div>
        </div>
      )}

      {activeTab === 'branches' && (
        <div className="grid gap-4 lg:grid-cols-[340px_1fr]">
          <form onSubmit={saveBranchSettings} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-soft space-y-2">
            <h2 className="font-semibold">Branch Controls</h2>
            <select value={selectedProductUid} onChange={(e) => setSelectedProductUid(e.target.value)} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm">
              <option value="">Select product</option>
              {itemsResponse.data.map((item) => <option key={item.product_uid} value={item.product_uid}>{item.name}</option>)}
            </select>
            <label className="text-sm flex items-center gap-2">
              <input type="checkbox" checked={branchForm.is_available} onChange={(e) => setBranchForm((p) => ({ ...p, is_available: e.target.checked }))} />
              Available for this branch
            </label>
            <input type="number" step="0.01" value={branchForm.price_override} onChange={(e) => setBranchForm((p) => ({ ...p, price_override: e.target.value }))} placeholder="Price override" className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" />
            <input type="number" value={branchForm.stock_override} onChange={(e) => setBranchForm((p) => ({ ...p, stock_override: e.target.value }))} placeholder="Stock override" className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" />
            <button type="submit" className="w-full rounded-lg bg-brandYellow py-2 text-sm font-medium">Save Branch Setting</button>
          </form>
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-soft">
            {selectedItem ? (
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div className="rounded-lg border border-slate-100 p-3"><div className="text-slate-500">Name</div><div className="font-medium">{selectedItem.name}</div></div>
                <div className="rounded-lg border border-slate-100 p-3"><div className="text-slate-500">SKU</div><div className="font-medium">{selectedItem.sku}</div></div>
                <div className="rounded-lg border border-slate-100 p-3"><div className="text-slate-500">Effective Price</div><div className="font-medium">{formatMoney(selectedItem.effective_price)}</div></div>
                <div className="rounded-lg border border-slate-100 p-3"><div className="text-slate-500">Effective Stock</div><div className="font-medium">{selectedItem.effective_stock}</div></div>
              </div>
            ) : (
              <div className="text-sm text-slate-500">Select a product to see branch projection.</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default Products;

