import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import CashierHeader from '../components/cashier/CashierHeader';
import SectionTabs from '../components/cashier/SectionTabs';
import ProductGrid from '../components/cashier/ProductGrid';
import CartPanel from '../components/cashier/CartPanel';
import AddOnModal from '../components/cashier/AddOnModal';
import ReceiptSuccess from '../components/cashier/ReceiptSuccess';
import ShiftPanel from '../components/cashier/ShiftPanel';
import OrderManagementPanel from '../components/cashier/OrderManagementPanel';
import {
  addCashierShiftExpense,
  createCashierOrder,
  endCashierShift,
  extractApiError,
  getCashierItems,
  getCashierQuote,
  getCashierSections,
  getTodayCashierShift,
  listRecentCashierOrders,
  resolveCashierBranchId,
  startCashierShift,
  updateCashierOrderStatus,
} from '../services/cashier';
import { getBranchSettings, getBusinessSettings, getBranchDisplayLabel } from '../services/settings';
import {
  isBrowserPosHardwareSupported,
  openDrawerInBrowserMode,
  printReceiptInBrowserMode,
  requestPrinterDevice,
} from '../services/browserPosHardware';
import {
  setOfflineV2Enabled,
  startOfflineSyncEngine,
  triggerOfflineSyncNow,
} from '../services/offlineSync';

const DEFAULT_ADMIN_SWITCH_PIN = '0000';
const ITEM_PAGE_SIZE = 24;
const QUOTE_DEBOUNCE_MS = 350;
const STOCK_POLL_MS = 5000;
const ONLINE_CHANNELS = new Set(['online', 'whatsapp', 'delivery_platform']);
const ONLINE_CHANNELS_CSV = 'online,whatsapp,delivery_platform';
const HELD_ORDERS_KEY = 'cashierHeldOrders';
const RECEIPT_CACHE_KEY = 'cashierReceiptCache';
const SHIFT_FALLBACK_ACTIVE_KEY = 'cashierFallbackShiftActive';
const SHIFT_FALLBACK_REPORT_KEY = 'cashierFallbackShiftReport';

const sanitizePin = (value) => String(value || '').replace(/\D/g, '').slice(0, 4);

const parsePositiveIntList = (value) =>
  String(value || '')
    .split(',')
    .map((part) => Number(part.trim()))
    .filter((id, index, list) => Number.isInteger(id) && id > 0 && list.indexOf(id) === index);

const roundMoney = (value) => Number(Number(value || 0).toFixed(2));

const parseStoredJson = (key, fallback) => {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw);
  } catch (_) {
    return fallback;
  }
};

const normalizeQuote = (quote) => {
  if (!quote || typeof quote !== 'object') return null;
  return {
    subtotal: roundMoney(quote.subtotal),
    tax: roundMoney(quote.tax),
    discount_total: roundMoney(quote.discount_total),
    final_total: roundMoney(quote.final_total),
    bulk_discount_total: roundMoney(quote.bulk_discount_total),
    promo_discount_total: roundMoney(quote.promo_discount_total),
    promo_code_id: quote.promo_code_id ?? null,
    applied_bulk_discount: quote.applied_bulk_discount || null,
    applied_promo_code: quote.applied_promo_code || null,
  };
};

const getBranchName = (branchId) => {
  try {
    const nameMap = JSON.parse(localStorage.getItem('branchNameMap') || '{}');
    const value = nameMap?.[String(branchId)];
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  } catch (_) {
    // fallback below
  }
  return getBranchDisplayLabel(branchId);
};

const normalizeObject = (value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value;
};

const normalizeAddonGroups = (value) => {
  if (!Array.isArray(value)) return [];
  return value
    .map((group, groupIndex) => {
      const id = String(group?.id || '').trim() || `group_${groupIndex + 1}`;
      const label = String(group?.label || group?.name || '').trim();
      if (!label) return null;
      const options = Array.isArray(group?.options)
        ? group.options
            .map((option, optionIndex) => {
              const optionId =
                String(option?.id || '').trim() || `option_${groupIndex + 1}_${optionIndex + 1}`;
              const optionLabel = String(option?.label || option?.name || '').trim();
              if (!optionLabel) return null;
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
      return {
        id,
        label,
        required: Boolean(group?.required),
        multi: Boolean(group?.multi),
        min_select: Number.isInteger(Number(group?.min_select)) ? Number(group.min_select) : 0,
        max_select:
          Number.isInteger(Number(group?.max_select)) && Number(group.max_select) > 0
            ? Number(group.max_select)
            : null,
        options,
      };
    })
    .filter(Boolean);
};

const normalizeSelectedAddons = (value) => {
  if (!Array.isArray(value)) return [];
  return value
    .map((group) => {
      const groupId = String(group?.group_id || group?.id || '').trim();
      if (!groupId) return null;
      const groupLabel = String(group?.group_label || group?.label || groupId).trim();
      const rawOptions = Array.isArray(group?.options)
        ? group.options
        : Array.isArray(group?.option_ids)
          ? group.option_ids.map((optionId) => ({ option_id: optionId }))
          : [];
      const options = rawOptions
        .map((option) => {
          if (typeof option === 'string' || typeof option === 'number') {
            const optionId = String(option).trim();
            if (!optionId) return null;
            return {
              option_id: optionId,
              label: optionId,
              price_delta: 0,
            };
          }
          const optionId = String(option?.option_id || option?.id || '').trim();
          if (!optionId) return null;
          const optionLabel = String(option?.label || optionId).trim();
          const parsedPrice = Number(option?.price_delta ?? option?.price ?? 0);
          return {
            option_id: optionId,
            label: optionLabel,
            price_delta: Number.isFinite(parsedPrice) ? Number(parsedPrice.toFixed(2)) : 0,
          };
        })
        .filter(Boolean);
      if (!options.length) return null;
      return {
        group_id: groupId,
        group_label: groupLabel,
        options,
      };
    })
    .filter(Boolean)
    .sort((a, b) => String(a.group_id).localeCompare(String(b.group_id)))
    .map((group) => ({
      ...group,
      options: [...group.options].sort((a, b) => String(a.option_id).localeCompare(String(b.option_id))),
    }));
};

const buildAddonSignature = (selectedAddons = []) => {
  const normalized = normalizeSelectedAddons(selectedAddons).map((group) => ({
    group_id: group.group_id,
    option_ids: group.options.map((option) => option.option_id),
  }));
  return JSON.stringify(normalized);
};

const createLineId = () => `line-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const buildLineSignature = ({ productId, selectedAddons }) =>
  `${Number(productId)}|${buildAddonSignature(selectedAddons)}`;

const buildLineModifiers = ({ note, selectedAddons, addonUnitDelta }) => {
  const trimmedNote = String(note || '').trim();
  const normalizedAddons = normalizeSelectedAddons(selectedAddons);
  const addonsForApi = normalizedAddons.map((group) => ({
    group_id: group.group_id,
    option_ids: group.options.map((option) => option.option_id),
  }));

  const modifiers = {
    addons: addonsForApi,
    addon_unit_price_delta: roundMoney(addonUnitDelta || 0),
  };
  if (trimmedNote) {
    modifiers.note = trimmedNote;
  }
  return modifiers;
};

const toCartLine = ({ item, quantity = 1, note = '', selectedAddons = [] }) => {
  const addons = normalizeSelectedAddons(selectedAddons);
  const addonUnitDelta = roundMoney(
    addons.reduce(
      (sum, group) =>
        sum
        + group.options.reduce((groupSum, option) => groupSum + Number(option.price_delta || 0), 0),
      0
    )
  );
  const baseUnitPrice = roundMoney(item?.effective_price || 0);
  const unitPrice = roundMoney(baseUnitPrice + addonUnitDelta);
  const safeQuantity = Math.max(1, Number(quantity || 1));

  return {
    line_id: createLineId(),
    line_signature: buildLineSignature({ productId: item.id, selectedAddons: addons }),
    product_id: Number(item.id),
    name: item.name,
    image_url: item.image_url || null,
    base_unit_price: baseUnitPrice,
    addon_unit_price_delta: addonUnitDelta,
    unit_price: unitPrice,
    quantity: safeQuantity,
    line_total: roundMoney(unitPrice * safeQuantity),
    effective_stock:
      item.effective_stock === null || item.effective_stock === undefined
        ? null
        : Number(item.effective_stock),
    note: String(note || '').trim(),
    addons,
    modifiers: buildLineModifiers({
      note,
      selectedAddons: addons,
      addonUnitDelta,
    }),
  };
};

const normalizeCartLine = (line) => {
  const productId = Number(line?.product_id ?? line?.productId);
  if (!Number.isInteger(productId) || productId <= 0) return null;

  const rawModifiers = normalizeObject(line.modifiers);
  const addons = normalizeSelectedAddons(
    Array.isArray(line?.addons) && line.addons.length > 0 ? line.addons : rawModifiers.addons
  );
  const addonUnitDelta = roundMoney(
    line?.addon_unit_price_delta !== undefined
      ? line.addon_unit_price_delta
      : addons.reduce(
          (sum, group) =>
            sum
            + group.options.reduce((groupSum, option) => groupSum + Number(option.price_delta || 0), 0),
          0
        )
  );
  const providedUnitPrice = Number(line?.unit_price || 0);
  const baseUnitPrice = roundMoney(
    line?.base_unit_price !== undefined
      ? line.base_unit_price
      : Math.max(0, providedUnitPrice - addonUnitDelta)
  );
  const unitPrice = roundMoney(baseUnitPrice + addonUnitDelta);
  const quantity = Math.max(1, Number(line?.quantity || 1));
  const note = String(line?.note ?? rawModifiers.note ?? '');

  return {
    ...line,
    line_id: line.line_id || createLineId(),
    line_signature: line.line_signature || buildLineSignature({ productId, selectedAddons: addons }),
    product_id: productId,
    quantity,
    base_unit_price: baseUnitPrice,
    addon_unit_price_delta: addonUnitDelta,
    unit_price: unitPrice,
    line_total: roundMoney(unitPrice * quantity),
    note,
    addons,
    modifiers: buildLineModifiers({
      note,
      selectedAddons: addons,
      addonUnitDelta,
    }),
  };
};

const normalizeCartLines = (value) => {
  if (!Array.isArray(value)) return [];
  return value.map((line) => normalizeCartLine(line)).filter(Boolean);
};

const toQuoteItems = (cartLines) =>
  cartLines.map((line) => ({
    product_id: Number(line.product_id),
    quantity: Number(line.quantity),
    modifiers: normalizeObject(line.modifiers),
  }));

const getTodayDateKey = (value) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const readShiftFallbackForToday = () => {
  const today = getTodayDateKey(new Date());
  const active = parseStoredJson(SHIFT_FALLBACK_ACTIVE_KEY, null);
  const report = parseStoredJson(SHIFT_FALLBACK_REPORT_KEY, null);

  return {
    active: active && active.shift_date === today ? active : null,
    report: report && report.shift_date === today ? report : null,
  };
};

function Cashier() {
  const itemsRequestRef = useRef(0);
  const quoteRequestRef = useRef(0);

  const [now, setNow] = useState(new Date());
  const [currentRole, setCurrentRole] = useState(
    () => String(localStorage.getItem('userRole') || 'cashier').toLowerCase()
  );
  const [branchId, setBranchId] = useState(() => resolveCashierBranchId());
  const [offlineSyncEnabled, setOfflineSyncEnabledState] = useState(
    () => String(localStorage.getItem('offlineV2Enabled') || '') === '1'
  );
  const [sections, setSections] = useState([]);
  const [sectionsError, setSectionsError] = useState('');
  const [activeSectionId, setActiveSectionId] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [orderMode, setOrderMode] = useState('pos');
  const [orderType, setOrderType] = useState('takeaway');
  const [paymentMethod, setPaymentMethod] = useState('cash');
  const [manualDiscountInput, setManualDiscountInput] = useState('');
  const [cashReceivedInput, setCashReceivedInput] = useState('');
  const [cashDrawerStatus, setCashDrawerStatus] = useState('');

  const [items, setItems] = useState([]);
  const [itemsMeta, setItemsMeta] = useState({ page: 1, page_size: ITEM_PAGE_SIZE, total: 0, total_pages: 0 });
  const [itemsLoading, setItemsLoading] = useState(true);
  const [itemsLoadingMore, setItemsLoadingMore] = useState(false);
  const [itemsError, setItemsError] = useState('');

  const [cartLines, setCartLines] = useState([]);
  const [addonModal, setAddonModal] = useState({
    open: false,
    item: null,
    addonGroups: [],
  });
  const [promoInput, setPromoInput] = useState('');
  const [appliedPromoCode, setAppliedPromoCode] = useState('');
  const [promoError, setPromoError] = useState('');
  const [quote, setQuote] = useState(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [quoteError, setQuoteError] = useState('');

  const [checkoutBusy, setCheckoutBusy] = useState(false);
  const [checkoutError, setCheckoutError] = useState('');
  const [pendingOrder, setPendingOrder] = useState(null);
  const [receipt, setReceipt] = useState(null);
  const [receiptCache, setReceiptCache] = useState(() => parseStoredJson(RECEIPT_CACHE_KEY, {}));

  const [heldOrders, setHeldOrders] = useState(() => parseStoredJson(HELD_ORDERS_KEY, []));
  const [activeShift, setActiveShift] = useState(null);
  const [lastShiftReport, setLastShiftReport] = useState(null);
  const [shiftLoading, setShiftLoading] = useState(false);
  const [shiftApiUnavailable, setShiftApiUnavailable] = useState(false);
  const [openingCashInput, setOpeningCashInput] = useState('');
  const [closingCashInput, setClosingCashInput] = useState('');
  const [expenseInput, setExpenseInput] = useState('');

  const [orderSearchInput, setOrderSearchInput] = useState('');
  const [todayOrders, setTodayOrders] = useState([]);
  const [ordersLoading, setOrdersLoading] = useState(false);
  const [ordersError, setOrdersError] = useState('');
  const [statusActionBusyId, setStatusActionBusyId] = useState('');

  const [showPinModal, setShowPinModal] = useState(false);
  const [pinValue, setPinValue] = useState('');
  const [pinError, setPinError] = useState('');
  const [adminSwitchPin, setAdminSwitchPin] = useState(
    sanitizePin(localStorage.getItem('adminSwitchPin') || DEFAULT_ADMIN_SWITCH_PIN) || DEFAULT_ADMIN_SWITCH_PIN
  );

  const isManagerOrAdmin = currentRole === 'admin' || currentRole === 'manager';
  const branchLabel = useMemo(() => getBranchDisplayLabel(branchId), [branchId]);
  const branchName = useMemo(() => getBranchName(branchId), [branchId]);
  const branchDisplayText = useMemo(
    () => (branchName === branchLabel ? branchLabel : `${branchName} (${branchLabel})`),
    [branchLabel, branchName]
  );
  const addonGroupsBySectionId = useMemo(() => {
    const map = new Map();
    sections.forEach((section) => {
      map.set(section.id, normalizeAddonGroups(section.addon_groups || []));
    });
    return map;
  }, [sections]);
  const localSubtotal = useMemo(
    () => roundMoney(cartLines.reduce((sum, line) => sum + Number(line.line_total || 0), 0)),
    [cartLines]
  );
  const hasMoreItems = useMemo(
    () => Number(itemsMeta.page || 1) < Number(itemsMeta.total_pages || 0),
    [itemsMeta.page, itemsMeta.total_pages]
  );
  const cartQuantityByProduct = useMemo(() => {
    const mapped = {};
    cartLines.forEach((line) => {
      const productId = Number(line.product_id);
      mapped[productId] = Number(mapped[productId] || 0) + Number(line.quantity || 0);
    });
    return mapped;
  }, [cartLines]);
  const manualDiscount = useMemo(() => {
    if (!isManagerOrAdmin) return 0;
    const parsed = Number(manualDiscountInput || 0);
    if (!Number.isFinite(parsed) || parsed <= 0) return 0;
    const quoteTotal = quote ? Number(quote.final_total || 0) : localSubtotal;
    return roundMoney(Math.min(parsed, Math.max(0, quoteTotal)));
  }, [isManagerOrAdmin, manualDiscountInput, quote, localSubtotal]);
  const payableTotal = useMemo(() => {
    const quoteTotal = quote ? Number(quote.final_total || 0) : localSubtotal;
    return roundMoney(Math.max(0, quoteTotal - manualDiscount));
  }, [localSubtotal, manualDiscount, quote]);
  const cashReceived = useMemo(() => {
    const parsed = Number(cashReceivedInput || 0);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  }, [cashReceivedInput]);
  const changeDue = useMemo(() => {
    if (paymentMethod !== 'cash') return 0;
    return roundMoney(Math.max(0, cashReceived - payableTotal));
  }, [cashReceived, payableTotal, paymentMethod]);
  const isCashInsufficient = useMemo(
    () => paymentMethod === 'cash' && cartLines.length > 0 && cashReceived < payableTotal,
    [cartLines.length, cashReceived, payableTotal, paymentMethod]
  );
  const matchesPendingFilter = useCallback((rowStatus, mode) => {
    const status = String(rowStatus || '').trim().toLowerCase();
    if (mode === 'online') {
      return ['new', 'accepted', 'preparing', 'ready', 'open', 'out_for_delivery'].includes(status);
    }
    return ['pending', 'open', 'preparing', 'ready', 'out_for_delivery'].includes(status);
  }, []);

  const filteredTodayOrders = useMemo(() => {
    if (orderMode === 'pos') {
      return [];
    }
    const search = String(orderSearchInput || '').trim().toLowerCase();
    const scoped = todayOrders.filter((row) => {
      const channel = String(row.order_channel || '').toLowerCase();
      const status = String(row.status || '').toLowerCase();
      if (orderMode === 'completed') {
        return channel === 'pos' && matchesPendingFilter(status, 'pos');
      }
      if (orderMode === 'online') {
        return ONLINE_CHANNELS.has(channel) && matchesPendingFilter(status, 'online');
      }
      return channel === 'pos' && matchesPendingFilter(status, 'pos');
    });
    if (!search) return scoped;
    return scoped.filter((row) => String(row.order_number || '').toLowerCase().includes(search));
  }, [matchesPendingFilter, orderMode, orderSearchInput, todayOrders]);
  const visibleCatalogItems = useMemo(
    () =>
      items.filter((item) => {
        const stockValue =
          item.effective_stock === null || item.effective_stock === undefined
            ? null
            : Number(item.effective_stock);
        if (stockValue === null) return true;
        const inCart = Number(cartQuantityByProduct?.[item.id] || 0);
        return stockValue - inCart > 0;
      }),
    [cartQuantityByProduct, items]
  );
  const checkoutDisabled = checkoutBusy
    || (!pendingOrder && cartLines.length === 0)
    || (paymentMethod === 'cash' && isCashInsufficient);
  const shiftLockedForDay = !activeShift && Boolean(lastShiftReport);
  const isPosMode = orderMode === 'pos';
  const isOnlineMode = orderMode === 'online';
  const isCompletedMode = orderMode === 'completed';

  const resetPinModal = () => {
    setShowPinModal(false);
    setPinValue('');
    setPinError('');
  };

  const handleOrderModeChange = useCallback((nextMode) => {
    const normalized = String(nextMode || '').trim().toLowerCase();
    if (!normalized) return;
    if (!['pos', 'online', 'completed'].includes(normalized)) return;
    if (normalized !== 'pos') {
      setAddonModal({
        open: false,
        item: null,
        addonGroups: [],
      });
    }
    setOrderMode(normalized);
  }, []);

  const switchToAdmin = () => {
    const adminBranchIds = parsePositiveIntList(localStorage.getItem('adminBranchIds'));
    if (adminBranchIds.length > 1) {
      localStorage.setItem('branchId', 'all');
    }
    localStorage.setItem('userRole', 'admin');
    window.location.href = '/home';
  };

  const persistHeldOrders = useCallback((orders) => {
    localStorage.setItem(HELD_ORDERS_KEY, JSON.stringify(orders || []));
  }, []);

  const persistReceiptCache = useCallback((cache) => {
    localStorage.setItem(RECEIPT_CACHE_KEY, JSON.stringify(cache || {}));
  }, []);

  const persistFallbackActiveShift = useCallback((shift) => {
    if (!shift) {
      localStorage.removeItem(SHIFT_FALLBACK_ACTIVE_KEY);
      return;
    }
    localStorage.setItem(SHIFT_FALLBACK_ACTIVE_KEY, JSON.stringify(shift));
  }, []);

  const persistFallbackShiftReport = useCallback((report) => {
    if (!report) {
      localStorage.removeItem(SHIFT_FALLBACK_REPORT_KEY);
      return;
    }
    localStorage.setItem(SHIFT_FALLBACK_REPORT_KEY, JSON.stringify(report));
  }, []);

  const connectBrowserPrinter = useCallback(async () => {
    if (!isBrowserPosHardwareSupported()) {
      setCashDrawerStatus('Browser printer connection requires Chrome/Edge on HTTPS or localhost');
      return;
    }

    try {
      await requestPrinterDevice();
      setCashDrawerStatus('Thermal printer connected for browser mode');
    } catch (error) {
      const message = String(error?.message || '').toLowerCase();
      if (message.includes('no device selected')) {
        setCashDrawerStatus('Printer connection cancelled');
        return;
      }
      setCashDrawerStatus('Failed to connect thermal printer');
    }
  }, []);

  const loadSections = useCallback(async () => {
    try {
      const response = await getCashierSections();
      setBranchId(response.branchId);
      setSections(Array.isArray(response.sections) ? response.sections : []);
      setSectionsError('');
    } catch (error) {
      setSectionsError(extractApiError(error, 'Failed to load sections'));
    }
  }, []);

  const loadItems = useCallback(
    async ({ page = 1, append = false, silent = false } = {}) => {
      const requestId = ++itemsRequestRef.current;

      if (!silent) {
        if (append) setItemsLoadingMore(true);
        else setItemsLoading(true);
      }

      try {
        const response = await getCashierItems({
          page,
          pageSize: ITEM_PAGE_SIZE,
          search: searchTerm,
          sectionId: activeSectionId,
        });

        if (requestId !== itemsRequestRef.current) return;

        setBranchId(response.branchId);
        setItemsMeta(response.meta || { page: 1, page_size: ITEM_PAGE_SIZE, total: 0, total_pages: 0 });
        setItems((prev) => {
          const incoming = Array.isArray(response.data) ? response.data : [];
          if (!append) return incoming;
          const map = new Map(prev.map((item) => [item.product_uid, item]));
          incoming.forEach((item) => map.set(item.product_uid, item));
          return Array.from(map.values());
        });
        if (!silent) setItemsError('');
      } catch (error) {
        if (requestId !== itemsRequestRef.current) return;
        if (!silent) setItemsError(extractApiError(error, 'Failed to load products'));
      } finally {
        if (requestId !== itemsRequestRef.current) return;
        if (!silent) {
          setItemsLoading(false);
          setItemsLoadingMore(false);
        }
      }
    },
    [activeSectionId, searchTerm]
  );

  const refreshLoadedItems = useCallback(async () => {
    const loadedPages = Math.max(1, Number(itemsMeta.page || 1));
    await loadItems({ page: 1, append: false, silent: true });
    for (let page = 2; page <= loadedPages; page += 1) {
      // eslint-disable-next-line no-await-in-loop
      await loadItems({ page, append: true, silent: true });
    }
  }, [itemsMeta.page, loadItems]);

  const loadTodayOrders = useCallback(async () => {
    setOrdersLoading(true);
    try {
      const channel = isOnlineMode ? ONLINE_CHANNELS_CSV : isCompletedMode ? 'pos' : undefined;
      const status = isCompletedMode ? 'pending' : undefined;
      const response = await listRecentCashierOrders({
        channel,
        status,
      });
      setBranchId(response.branchId);
      const todayKey = getTodayDateKey(new Date());
      const rows = (response.data || []).filter((row) => getTodayDateKey(row.created_at) === todayKey);
      setTodayOrders(rows);
      setOrdersError('');
    } catch (error) {
      setOrdersError(extractApiError(error, 'Failed to load today orders'));
    } finally {
      setOrdersLoading(false);
    }
  }, [isCompletedMode, isOnlineMode]);

  const loadTodayShift = useCallback(async () => {
    setShiftLoading(true);
    try {
      const response = await getTodayCashierShift();
      setBranchId(response.branchId);
      const shift = response?.data?.shift || null;
      setShiftApiUnavailable(false);
      if (!shift) {
        setActiveShift(null);
        setLastShiftReport(null);
        persistFallbackActiveShift(null);
        persistFallbackShiftReport(null);
      } else if (shift.status === 'OPEN') {
        setActiveShift(shift);
        setLastShiftReport(null);
        persistFallbackActiveShift(null);
        persistFallbackShiftReport(null);
      } else {
        setActiveShift(null);
        setLastShiftReport(shift);
        persistFallbackActiveShift(null);
        persistFallbackShiftReport(null);
      }
    } catch (error) {
      if (error?.response?.status === 404) {
        const fallback = readShiftFallbackForToday();
        setActiveShift(fallback.active || null);
        setLastShiftReport(fallback.report || null);
        setShiftApiUnavailable(true);
        return;
      }
      setCheckoutError(extractApiError(error, 'Failed to load shift'));
    } finally {
      setShiftLoading(false);
    }
  }, [persistFallbackActiveShift, persistFallbackShiftReport]);

  const runQuote = useCallback(async (quoteItems, promoCode = '') => {
    if (!quoteItems.length) {
      setQuote(null);
      setQuoteError('');
      if (!promoCode) setPromoError('');
      return;
    }

    const requestId = ++quoteRequestRef.current;
    setQuoteLoading(true);

    try {
      const response = await getCashierQuote({
        source: 'pos',
        promoCode,
        items: quoteItems,
        tax: 0,
        branchId,
      });

      if (requestId !== quoteRequestRef.current) return;

      setBranchId(response.branchId);
      setQuote(normalizeQuote(response.data));
      setQuoteError('');
      setPromoError('');
    } catch (error) {
      if (requestId !== quoteRequestRef.current) return;

      const message = extractApiError(error, 'Failed to calculate totals');
      const promoValidationError =
        Boolean(promoCode) && String(message || '').toLowerCase().startsWith('promo code');
      setQuote(null);
      if (promoValidationError) {
        setQuoteError('');
        setPromoError(message);
      } else {
        setQuoteError(message);
        if (promoCode) setPromoError(message);
      }
    } finally {
      if (requestId !== quoteRequestRef.current) return;
      setQuoteLoading(false);
    }
  }, [branchId]);

  useEffect(() => {
    const storedRole = String(localStorage.getItem('userRole') || '').toLowerCase();
    if (!storedRole) {
      localStorage.setItem('userRole', 'cashier');
      setCurrentRole('cashier');
    } else {
      setCurrentRole(storedRole);
    }
    const resolved = resolveCashierBranchId();
    setBranchId(resolved);
  }, []);

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => setSearchTerm(searchInput.trim()), 250);
    return () => clearTimeout(timer);
  }, [searchInput]);

  useEffect(() => {
    loadSections();
    loadTodayOrders();
    loadTodayShift();
  }, [loadSections, loadTodayOrders, loadTodayShift]);

  useEffect(() => {
    loadItems({ page: 1, append: false });
  }, [loadItems]);

  useEffect(() => {
    const quoteItems = toQuoteItems(cartLines);
    const timer = setTimeout(() => {
      runQuote(quoteItems, appliedPromoCode);
    }, QUOTE_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [cartLines, appliedPromoCode, runQuote]);

  useEffect(() => {
    const timer = setInterval(() => {
      if (receipt) return;
      refreshLoadedItems();
      loadTodayOrders();
      loadTodayShift();
    }, STOCK_POLL_MS);
    return () => clearInterval(timer);
  }, [receipt, refreshLoadedItems, loadTodayOrders, loadTodayShift]);

  useEffect(() => {
    setCartLines((prev) => {
      let changed = false;
      const next = [];
      const itemById = new Map(items.map((item) => [Number(item.id), item]));
      const remainingByProduct = new Map();

      prev.forEach((line) => {
        const productId = Number(line.product_id);
        const matched = itemById.get(productId);
        if (!matched) {
          next.push(line);
          return;
        }

        const stockValue =
          matched.effective_stock === null || matched.effective_stock === undefined
            ? null
            : Number(matched.effective_stock);
        if (stockValue !== null && stockValue <= 0) {
          changed = true;
          return;
        }

        if (!remainingByProduct.has(productId)) {
          remainingByProduct.set(productId, stockValue);
        }
        const remainingForProduct = remainingByProduct.get(productId);
        let nextQuantity = Number(line.quantity || 0);
        if (remainingForProduct !== null) {
          nextQuantity = Math.min(nextQuantity, Math.max(0, Number(remainingForProduct || 0)));
          remainingByProduct.set(productId, Math.max(0, Number(remainingForProduct || 0) - nextQuantity));
        }

        if (nextQuantity <= 0) {
          changed = true;
          return;
        }

        const addons = normalizeSelectedAddons(
          Array.isArray(line.addons) && line.addons.length > 0
            ? line.addons
            : normalizeObject(line.modifiers).addons
        );
        const addonUnitDelta = roundMoney(
          addons.reduce(
            (sum, group) =>
              sum
              + group.options.reduce((groupSum, option) => groupSum + Number(option.price_delta || 0), 0),
            0
          )
        );
        const baseUnitPrice = roundMoney(matched.effective_price);
        const unitPrice = roundMoney(baseUnitPrice + addonUnitDelta);
        const note = String(line.note || '');
        const lineSignature = line.line_signature || buildLineSignature({ productId, selectedAddons: addons });
        const lineId = line.line_id || createLineId();
        const modifiers = buildLineModifiers({
          note,
          selectedAddons: addons,
          addonUnitDelta,
        });

        if (
          line.effective_stock !== stockValue
          || nextQuantity !== Number(line.quantity || 0)
          || Number(line.unit_price || 0) !== unitPrice
          || Number(line.base_unit_price || 0) !== baseUnitPrice
          || Number(line.addon_unit_price_delta || 0) !== addonUnitDelta
          || line.line_signature !== lineSignature
          || line.line_id !== lineId
          || JSON.stringify(line.addons || []) !== JSON.stringify(addons)
        ) {
          changed = true;
        }

        next.push({
          ...line,
          line_id: lineId,
          line_signature: lineSignature,
          name: matched.name || line.name,
          image_url: matched.image_url || line.image_url || null,
          base_unit_price: baseUnitPrice,
          addon_unit_price_delta: addonUnitDelta,
          unit_price: unitPrice,
          effective_stock: stockValue,
          quantity: nextQuantity,
          line_total: roundMoney(unitPrice * nextQuantity),
          addons,
          note,
          modifiers,
        });
      });

      return changed ? next : prev;
    });
  }, [items]);

  useEffect(() => {
    let alive = true;
    getBusinessSettings()
      .then((data) => {
        if (!alive) return;
        const nextPin = sanitizePin(data?.admin_switch_pin || DEFAULT_ADMIN_SWITCH_PIN);
        const effectivePin = nextPin.length === 4 ? nextPin : DEFAULT_ADMIN_SWITCH_PIN;
        setAdminSwitchPin(effectivePin);
        localStorage.setItem('adminSwitchPin', effectivePin);
      })
      .catch(() => {});

    getBranchSettings()
      .then((data) => {
        if (!alive) return;
        const enabled = Boolean(data?.settings?.feature_flags?.offline_v2_enabled);
        setOfflineSyncEnabledState(enabled);
        setOfflineV2Enabled(enabled);
      })
      .catch(() => {});

    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    persistHeldOrders(heldOrders);
  }, [heldOrders, persistHeldOrders]);

  useEffect(() => {
    persistReceiptCache(receiptCache);
  }, [receiptCache, persistReceiptCache]);

  useEffect(() => {
    if (!offlineSyncEnabled) return undefined;
    const stop = startOfflineSyncEngine(branchId, { intervalMs: 10000 });
    triggerOfflineSyncNow(branchId);
    return () => {
      if (typeof stop === 'function') {
        stop();
      }
    };
  }, [branchId, offlineSyncEnabled]);

  useEffect(() => {
    const handleHiddenHardwareShortcut = (event) => {
      if (!event.ctrlKey || !event.shiftKey) return;
      const key = String(event.key || '').toLowerCase();
      if (key === 'p') {
        event.preventDefault();
        connectBrowserPrinter();
      }
    };

    window.addEventListener('keydown', handleHiddenHardwareShortcut);
    return () => window.removeEventListener('keydown', handleHiddenHardwareShortcut);
  }, [connectBrowserPrinter]);

  const closeAddonModal = () => {
    setAddonModal({
      open: false,
      item: null,
      addonGroups: [],
    });
  };

  const appendLineToCart = useCallback((lineToAdd) => {
    setCartLines((prev) => {
      const productId = Number(lineToAdd.product_id);
      const inCartForProduct = prev.reduce((sum, line) => {
        if (Number(line.product_id) !== productId) return sum;
        return sum + Number(line.quantity || 0);
      }, 0);

      const stockValue =
        lineToAdd.effective_stock === null || lineToAdd.effective_stock === undefined
          ? null
          : Number(lineToAdd.effective_stock);
      const remaining = stockValue === null ? Number.POSITIVE_INFINITY : Math.max(0, stockValue - inCartForProduct);
      if (remaining <= 0) return prev;

      const quantityToAdd = Math.max(1, Math.min(Number(lineToAdd.quantity || 1), remaining));
      const existingIndex = prev.findIndex((line) => line.line_signature === lineToAdd.line_signature);
      if (existingIndex < 0) {
        return [
          ...prev,
          {
            ...lineToAdd,
            quantity: quantityToAdd,
            line_total: roundMoney(Number(lineToAdd.unit_price || 0) * quantityToAdd),
          },
        ];
      }

      return prev.map((line, index) => {
        if (index !== existingIndex) return line;
        const nextQuantity = Number(line.quantity || 0) + quantityToAdd;
        return {
          ...line,
          effective_stock: stockValue,
          quantity: nextQuantity,
          line_total: roundMoney(Number(line.unit_price || 0) * nextQuantity),
        };
      });
    });
  }, []);

  const addToCart = (item) => {
    if (pendingOrder) return;
    const stock =
      item.effective_stock === null || item.effective_stock === undefined
        ? null
        : Number(item.effective_stock);
    const unavailable = item.is_available === false || (stock !== null && stock <= 0);
    if (unavailable) return;

    const sectionAddonGroups = addonGroupsBySectionId.get(item.section_id) || [];
    if (sectionAddonGroups.length > 0) {
      setAddonModal({
        open: true,
        item,
        addonGroups: sectionAddonGroups,
      });
      return;
    }

    appendLineToCart(
      toCartLine({
        item,
        quantity: 1,
        note: '',
        selectedAddons: [],
      })
    );
  };

  const addModalSelectionToCart = ({ quantity, note, selectedAddons }) => {
    if (!addonModal?.item) return;
    appendLineToCart(
      toCartLine({
        item: addonModal.item,
        quantity,
        note,
        selectedAddons,
      })
    );
    closeAddonModal();
  };

  const incrementLine = (lineId) => {
    if (pendingOrder) return;
    const targetId = String(lineId);

    setCartLines((prev) => {
      const targetIndex = prev.findIndex(
        (line) => String(line.line_id || line.product_id) === targetId
      );
      if (targetIndex < 0) return prev;

      const target = prev[targetIndex];
      const maxStock =
        target.effective_stock === null || target.effective_stock === undefined
          ? null
          : Number(target.effective_stock);

      if (maxStock !== null) {
        const otherQty = prev.reduce((sum, line, index) => {
          if (index === targetIndex) return sum;
          if (Number(line.product_id) !== Number(target.product_id)) return sum;
          return sum + Number(line.quantity || 0);
        }, 0);
        if (otherQty + Number(target.quantity || 0) >= maxStock) {
          return prev;
        }
      }

      return prev.map((line, index) => {
        if (index !== targetIndex) return line;
        const quantity = Number(line.quantity || 0) + 1;
        return {
          ...line,
          quantity,
          line_total: roundMoney(Number(line.unit_price || 0) * quantity),
        };
      });
    });
  };

  const decrementLine = (lineId) => {
    if (pendingOrder) return;
    const targetId = String(lineId);

    setCartLines((prev) => {
      const targetIndex = prev.findIndex(
        (line) => String(line.line_id || line.product_id) === targetId
      );
      if (targetIndex < 0) return prev;

      const target = prev[targetIndex];
      if (Number(target.quantity || 0) <= 1) {
        return prev.filter((_, index) => index !== targetIndex);
      }

      return prev.map((line, index) => {
        if (index !== targetIndex) return line;
        const quantity = Number(line.quantity || 0) - 1;
        return {
          ...line,
          quantity,
          line_total: roundMoney(Number(line.unit_price || 0) * quantity),
        };
      });
    });
  };

  const removeLine = (lineId) => {
    if (pendingOrder) return;
    const targetId = String(lineId);
    setCartLines((prev) =>
      prev.filter((line) => String(line.line_id || line.product_id) !== targetId)
    );
  };

  const updateLineNote = (lineId, note) => {
    if (pendingOrder) return;
    const targetId = String(lineId);
    const trimmed = String(note || '');
    setCartLines((prev) =>
      prev.map((line) => {
        if (String(line.line_id || line.product_id) !== targetId) return line;
        const currentModifiers = normalizeObject(line.modifiers);
        const nextModifiers = {
          ...currentModifiers,
          note: trimmed.trim(),
        };
        if (!nextModifiers.note) {
          delete nextModifiers.note;
        }
        return {
          ...line,
          note: trimmed,
          modifiers: nextModifiers,
        };
      })
    );
  };

  const applyPromo = () => {
    if (pendingOrder) return;
    const normalized = String(promoInput || '').trim().toUpperCase();
    if (!normalized) {
      setPromoError('Enter a promo code');
      return;
    }
    setAppliedPromoCode(normalized);
    setPromoInput(normalized);
    setPromoError('');
  };

  const removePromo = () => {
    if (pendingOrder) return;
    setAppliedPromoCode('');
    setPromoInput('');
    setPromoError('');
    setQuoteError('');
  };

  const clearCart = () => {
    if (pendingOrder) {
      setCheckoutError('Pending order must be completed or cancelled first');
      return;
    }
    closeAddonModal();
    setCartLines([]);
    setAppliedPromoCode('');
    setPromoInput('');
    setPromoError('');
    setQuote(null);
    setQuoteError('');
    setManualDiscountInput('');
    setCashReceivedInput('');
  };

  const holdOrder = () => {
    if (pendingOrder) return;
    if (!cartLines.length) return;
    const heldId = `held-${Date.now()}`;
    const orderLabel = `Held ${new Date().toLocaleTimeString()}`;
    const summary = `${cartLines.reduce((sum, line) => sum + Number(line.quantity || 0), 0)} items | ${
      orderType === 'dine_in' ? 'Dine In' : 'Takeaway'
    }`;

    const held = {
      id: heldId,
      label: orderLabel,
      summary,
      created_at: new Date().toISOString(),
      payload: {
        cartLines,
        orderType,
        paymentMethod,
        promoInput,
        appliedPromoCode,
        manualDiscountInput,
        cashReceivedInput,
      },
    };

    setHeldOrders((prev) => [held, ...prev].slice(0, 20));
    clearCart();
    setCheckoutError('');
  };

  const resumeHeldOrder = (heldId) => {
    if (pendingOrder) return;
    const target = heldOrders.find((entry) => entry.id === heldId);
    if (!target) return;
    const payload = target.payload || {};
    setCartLines(normalizeCartLines(payload.cartLines));
    setOrderType(payload.orderType === 'dine_in' ? 'dine_in' : 'takeaway');
    setPaymentMethod(payload.paymentMethod === 'card' ? 'card' : 'cash');
    setPromoInput(payload.promoInput || '');
    setAppliedPromoCode(payload.appliedPromoCode || '');
    setManualDiscountInput(payload.manualDiscountInput || '');
    setCashReceivedInput(payload.cashReceivedInput || '');
    setHeldOrders((prev) => prev.filter((entry) => entry.id !== heldId));
  };

  const deleteHeldOrder = (heldId) => {
    setHeldOrders((prev) => prev.filter((entry) => entry.id !== heldId));
  };

  const openCashDrawer = async () => {
    try {
      const maybeElectron = window?.electronAPI?.openCashDrawer;
      const maybeBridge = window?.posBridge?.openCashDrawer;
      if (typeof maybeElectron === 'function') {
        await maybeElectron();
        setCashDrawerStatus('Cash drawer opened');
        return;
      }
      if (typeof maybeBridge === 'function') {
        await maybeBridge();
        setCashDrawerStatus('Cash drawer opened');
        return;
      }
      if (isBrowserPosHardwareSupported()) {
        await openDrawerInBrowserMode({ interactive: false });
        setCashDrawerStatus('Cash drawer opened via browser printer');
        return;
      }
      setCashDrawerStatus('Cash drawer integration is not configured in this environment');
    } catch (error) {
      setCashDrawerStatus('Cash drawer not connected. Connect hardware bridge/printer first.');
    }
  };

  const startShift = async () => {
    const opening = Number(openingCashInput || 0);
    if (!Number.isFinite(opening) || opening < 0) {
      setCheckoutError('Opening cash must be a valid non-negative number');
      return;
    }
    setShiftLoading(true);
    try {
      const response = await startCashierShift({ openingCash: roundMoney(opening) });
      setBranchId(response.branchId);
      setActiveShift(response.data || null);
      setLastShiftReport(null);
      setOpeningCashInput('');
      setExpenseInput('');
      setCheckoutError('');
      setShiftApiUnavailable(false);
    } catch (error) {
      if (error?.response?.status === 404) {
        const timestamp = new Date().toISOString();
        const localShift = {
          id: `local-shift-${Date.now()}`,
          outlet_id: Number(branchId),
          shift_date: getTodayDateKey(timestamp),
          cashier_id: localStorage.getItem('userId') || 'dev-user',
          status: 'OPEN',
          start_time: timestamp,
          end_time: null,
          opening_cash: roundMoney(opening),
          cash_sales: 0,
          expenses: 0,
          expected_cash: roundMoney(opening),
          closing_cash: null,
          difference: null,
          reconciliation_status: null,
          created_at: timestamp,
          updated_at: timestamp,
        };
        setActiveShift(localShift);
        setLastShiftReport(null);
        persistFallbackActiveShift(localShift);
        persistFallbackShiftReport(null);
        setOpeningCashInput('');
        setExpenseInput('');
        setCheckoutError('');
        setShiftApiUnavailable(true);
        return;
      }
      setCheckoutError(extractApiError(error, 'Failed to start shift'));
    } finally {
      setShiftLoading(false);
    }
  };

  const addShiftExpense = async () => {
    if (!activeShift) return;
    const expense = Number(expenseInput || 0);
    if (!Number.isFinite(expense) || expense <= 0) {
      setCheckoutError('Expense must be a valid amount greater than 0');
      return;
    }
    setShiftLoading(true);
    try {
      const response = await addCashierShiftExpense({
        shiftId: activeShift.id,
        amount: roundMoney(expense),
      });
      setBranchId(response.branchId);
      setActiveShift(response.data || null);
      setExpenseInput('');
      setCheckoutError('');
      setShiftApiUnavailable(false);
    } catch (error) {
      if (error?.response?.status === 404) {
        const nextShift = {
          ...activeShift,
          expenses: roundMoney(Number(activeShift.expenses || 0) + expense),
          expected_cash: roundMoney(
            Number(activeShift.opening_cash || 0)
              + Number(activeShift.cash_sales || 0)
              - (Number(activeShift.expenses || 0) + expense)
          ),
          updated_at: new Date().toISOString(),
        };
        setActiveShift(nextShift);
        persistFallbackActiveShift(nextShift);
        setExpenseInput('');
        setCheckoutError('');
        setShiftApiUnavailable(true);
        return;
      }
      setCheckoutError(extractApiError(error, 'Failed to add shift expense'));
    } finally {
      setShiftLoading(false);
    }
  };

  const endShift = async () => {
    if (!activeShift) return;
    const actualCash = Number(closingCashInput || 0);
    if (!Number.isFinite(actualCash) || actualCash < 0) {
      setCheckoutError('Closing cash must be a valid non-negative number');
      return;
    }
    setShiftLoading(true);
    try {
      const response = await endCashierShift({
        shiftId: activeShift.id,
        closingCash: roundMoney(actualCash),
      });
      setBranchId(response.branchId);
      setLastShiftReport(response.data || null);
      setActiveShift(null);
      setClosingCashInput('');
      setExpenseInput('');
      setCheckoutError('');
      setShiftApiUnavailable(false);
    } catch (error) {
      if (error?.response?.status === 404) {
        const expectedCash = roundMoney(
          Number(activeShift.opening_cash || 0)
            + Number(activeShift.cash_sales || 0)
            - Number(activeShift.expenses || 0)
        );
        const closingCash = roundMoney(actualCash);
        const difference = roundMoney(closingCash - expectedCash);
        const reconciliationStatus =
          Math.abs(difference) < 0.01 ? 'Perfect' : difference > 0 ? 'Over' : 'Short';
        const localReport = {
          ...activeShift,
          status: 'CLOSED',
          end_time: new Date().toISOString(),
          expected_cash: expectedCash,
          closing_cash: closingCash,
          difference,
          reconciliation_status: reconciliationStatus,
          updated_at: new Date().toISOString(),
        };
        setLastShiftReport(localReport);
        setActiveShift(null);
        persistFallbackActiveShift(null);
        persistFallbackShiftReport(localReport);
        setClosingCashInput('');
        setExpenseInput('');
        setCheckoutError('');
        setShiftApiUnavailable(true);
        return;
      }
      setCheckoutError(extractApiError(error, 'Failed to end shift'));
    } finally {
      setShiftLoading(false);
    }
  };

  const resolveOrderItems = (orderLike) => {
    if (Array.isArray(orderLike?.items) && orderLike.items.length > 0) {
      return orderLike.items;
    }
    return cartLines.map((line) => ({
      product_id: line.product_id,
      product_name: line.name,
      quantity: line.quantity,
      unit_price: line.unit_price,
      total_price: line.line_total,
      modifiers: normalizeObject(line.modifiers),
    }));
  };

  const applySoldQuantitiesToGrid = (orderItems) => {
    const soldQuantities = new Map();
    orderItems.forEach((entry) => {
      const productId = Number(entry.product_id);
      const quantity = Number(entry.quantity || 0);
      if (!Number.isInteger(productId) || productId <= 0 || quantity <= 0) return;
      soldQuantities.set(productId, (soldQuantities.get(productId) || 0) + quantity);
    });

    if (!soldQuantities.size) return;
    setItems((prev) =>
      prev.map((item) => {
        const sold = soldQuantities.get(Number(item.id));
        if (!sold) return item;
        if (item.effective_stock === null || item.effective_stock === undefined) return item;
        return { ...item, effective_stock: Math.max(0, Number(item.effective_stock) - sold) };
      })
    );
  };

  const confirmOrder = async () => {
    if (checkoutDisabled || pendingOrder) return;

    setCheckoutBusy(true);
    setCheckoutError('');

    try {
      const response = await createCashierOrder({
        branch_id: Number(branchId),
        source: 'pos',
        order_channel: 'pos',
        order_type: orderType,
        status: 'pending',
        payment_method: paymentMethod,
        payment_status: 'unpaid',
        promo_code: appliedPromoCode || undefined,
        manual_discount: isManagerOrAdmin ? manualDiscount : undefined,
        items: cartLines.map((line) => ({
          product_id: Number(line.product_id),
          quantity: Number(line.quantity),
          modifiers: normalizeObject(line.modifiers),
        })),
        metadata: {
          source_screen: 'cashier_mvp',
          generated_at: new Date().toISOString(),
          held_order_resume_used: false,
          cash_received: paymentMethod === 'cash' ? cashReceived : null,
          change_due: paymentMethod === 'cash' ? changeDue : null,
        },
      });

      setBranchId(response.branchId);
      const order = response.data || {};
      const orderItems = resolveOrderItems(order);
      applySoldQuantitiesToGrid(orderItems);
      const effectivePaymentMethod = order.payment_method || paymentMethod;

      const receiptPayload = {
        ...order,
        status: order.status || 'pending',
        order_channel: order.order_channel || 'pos',
        order_type: order.order_type || orderType,
        payment_method: effectivePaymentMethod,
        subtotal: roundMoney(order.subtotal ?? (quote ? quote.subtotal : localSubtotal)),
        tax: roundMoney(order.tax ?? (quote ? quote.tax : 0)),
        discount: roundMoney(order.discount ?? ((quote ? quote.discount_total : 0) + manualDiscount)),
        total: roundMoney(order.total ?? payableTotal),
        manual_discount_amount: roundMoney(order.manual_discount_amount ?? manualDiscount),
        cash_received: effectivePaymentMethod === 'cash' ? cashReceived : null,
        change_due: effectivePaymentMethod === 'cash' ? changeDue : null,
        items: orderItems,
      };

      // After sending to pending, reset the composer so cashier can start a fresh order.
      closeAddonModal();
      setPendingOrder(null);
      setCartLines([]);
      setQuote(null);
      setQuoteError('');
      setPromoError('');
      setPromoInput('');
      setAppliedPromoCode('');
      setManualDiscountInput('');
      setCashReceivedInput('');
      setPaymentMethod('cash');
      setOrderType('takeaway');
      setCashDrawerStatus('');
      setOrderSearchInput('');
      setReceipt(receiptPayload);
      if (receiptPayload.id) {
        setReceiptCache((prev) => ({
          ...prev,
          [receiptPayload.id]: receiptPayload,
        }));
      }

      await loadTodayOrders();
      setCheckoutError('');
    } catch (error) {
      const message = extractApiError(error, 'Failed to confirm order');
      setCheckoutError(message);
      if (message.toLowerCase().includes('stock')) {
        runQuote(toQuoteItems(cartLines), appliedPromoCode);
        refreshLoadedItems();
      }
    } finally {
      setCheckoutBusy(false);
    }
  };

  const markOrderAsCompleted = async (orderToComplete) => {
    if (!orderToComplete?.id || checkoutBusy) return;
    const effectivePaymentMethod = orderToComplete.payment_method || paymentMethod;
    if (effectivePaymentMethod === 'cash' && isCashInsufficient) return;

    setCheckoutBusy(true);
    setCheckoutError('');

    try {
      const response = await updateCashierOrderStatus(orderToComplete.id, {
        status: 'completed',
        payment_status: 'paid',
        reason: 'Cashier marked completed',
        metadata: {
          source: 'cashier_panel',
          cash_received: effectivePaymentMethod === 'cash' ? cashReceived : null,
          change_due: effectivePaymentMethod === 'cash' ? changeDue : null,
        },
      });

      setBranchId(response.branchId);
      const updated = response.data || {};
      const orderItems = resolveOrderItems(orderToComplete);
      applySoldQuantitiesToGrid(orderItems);

      if (
        effectivePaymentMethod === 'cash'
        && activeShift
        && (shiftApiUnavailable || String(activeShift.id || '').startsWith('local-shift-'))
      ) {
        const nextCashSales = roundMoney(Number(activeShift.cash_sales || 0) + Number(orderToComplete.total || payableTotal));
        const nextShift = {
          ...activeShift,
          cash_sales: nextCashSales,
          updated_at: new Date().toISOString(),
        };
        setActiveShift(nextShift);
        persistFallbackActiveShift(nextShift);
      }

      const receiptPayload = {
        ...orderToComplete,
        ...updated,
        status: updated.status || 'completed',
        order_channel: orderToComplete.order_channel || 'pos',
        order_type: orderToComplete.order_type || orderType,
        payment_method: effectivePaymentMethod,
        subtotal: roundMoney(orderToComplete.subtotal ?? (quote ? quote.subtotal : localSubtotal)),
        tax: roundMoney(orderToComplete.tax ?? (quote ? quote.tax : 0)),
        discount: roundMoney(orderToComplete.discount ?? ((quote ? quote.discount_total : 0) + manualDiscount)),
        total: roundMoney(orderToComplete.total ?? payableTotal),
        manual_discount_amount: roundMoney(orderToComplete.manual_discount_amount ?? manualDiscount),
        cash_received: effectivePaymentMethod === 'cash' ? cashReceived : null,
        change_due: effectivePaymentMethod === 'cash' ? changeDue : null,
        items: orderItems,
      };

      setReceipt(receiptPayload);
      if (receiptPayload.id) {
        setReceiptCache((prev) => ({
          ...prev,
          [receiptPayload.id]: receiptPayload,
        }));
      }

      closeAddonModal();
      setPendingOrder(null);
      setCartLines([]);
      setQuote(null);
      setQuoteError('');
      setPromoError('');
      setPromoInput('');
      setAppliedPromoCode('');
      setManualDiscountInput('');
      setCashReceivedInput('');

      await loadTodayOrders();
      await loadTodayShift();
    } catch (error) {
      const message = extractApiError(error, 'Failed to mark order as completed');
      setCheckoutError(message);
      if (message.toLowerCase().includes('stock')) {
        runQuote(toQuoteItems(cartLines), appliedPromoCode);
        refreshLoadedItems();
      }
    } finally {
      setCheckoutBusy(false);
    }
  };

  const startNewOrder = () => {
    setReceipt(null);
    setPendingOrder(null);
    clearCart();
    setCheckoutError('');
    setOrderType('takeaway');
    setPaymentMethod('cash');
    setCashDrawerStatus('');
  };

  const loadMoreItems = () => {
    if (!hasMoreItems || itemsLoadingMore) return;
    const nextPage = Number(itemsMeta.page || 1) + 1;
    loadItems({ page: nextPage, append: true });
  };

  const openPinModal = () => {
    setPinValue('');
    setPinError('');
    setShowPinModal(true);
  };

  const appendPinDigit = (digit) => {
    setPinValue((prev) => {
      if (prev.length >= 4) return prev;
      return `${prev}${digit}`;
    });
    setPinError('');
  };

  const removePinDigit = () => {
    setPinValue((prev) => prev.slice(0, -1));
    setPinError('');
  };

  const submitPin = () => {
    if (pinValue.length !== 4) {
      setPinError('Enter 4-digit PIN');
      return;
    }
    if (pinValue !== adminSwitchPin) {
      setPinError('Incorrect PIN');
      return;
    }
    resetPinModal();
    switchToAdmin();
  };

  const updateOrderStatus = async (order, nextStatus) => {
    if (isOnlineMode) return;
    if (!order?.id) return;
    setStatusActionBusyId(order.id);
    try {
      await updateCashierOrderStatus(order.id, {
        status: nextStatus,
        reason: `Cashier ${nextStatus}`,
        metadata: { source: 'cashier_panel' },
      });
      setOrdersError('');
      if (pendingOrder?.id === order.id && nextStatus !== 'pending') {
        setPendingOrder(null);
        if (
          nextStatus === 'completed'
          || nextStatus === 'cancelled'
          || nextStatus === 'rejected'
          || nextStatus === 'refunded'
        ) {
          setCartLines([]);
          setQuote(null);
          setQuoteError('');
          setPromoError('');
          setPromoInput('');
          setAppliedPromoCode('');
          setManualDiscountInput('');
          setCashReceivedInput('');
        }
      }
      await loadTodayOrders();
      await refreshLoadedItems();
    } catch (error) {
      setOrdersError(extractApiError(error, `Failed to ${nextStatus} order`));
    } finally {
      setStatusActionBusyId('');
    }
  };

  const reprintOrder = (order) => {
    if (!order?.id) return;
    const cached = receiptCache?.[order.id];
    if (cached) {
      setReceipt(cached);
      return;
    }

    setReceipt({
      id: order.id,
      order_number: order.order_number,
      order_type: order.order_type,
      payment_method: order.payment_method,
      status: order.status,
      created_at: order.created_at,
      subtotal: order.subtotal ?? order.total,
      tax: order.tax ?? 0,
      discount: order.discount ?? 0,
      total: order.total ?? 0,
      items: [],
    });
  };

  const handlePrintReceipt = async () => {
    if (!receipt) {
      window.print();
      return;
    }

    if (!isBrowserPosHardwareSupported()) {
      window.print();
      return;
    }

    try {
      await printReceiptInBrowserMode({
        receipt,
        branchLabel: branchName || branchLabel,
        interactive: false,
      });
    } catch (_) {
      window.print();
    }
  };

  return (
    <div className="cashier-screen min-h-screen bg-surface px-4 py-4 lg:px-6">
      {receipt ? (
        <ReceiptSuccess
          receipt={receipt}
          branchLabel={branchName || branchLabel}
          onPrint={handlePrintReceipt}
          onNewOrder={startNewOrder}
        />
      ) : (
        <div className="space-y-4">
          <CashierHeader
            now={now}
            branchName={branchDisplayText}
            branchLabel={branchLabel}
            orderMode={orderMode}
            onOrderModeChange={handleOrderModeChange}
            orderType={orderType}
            onOrderTypeChange={setOrderType}
            onSwitchToAdmin={openPinModal}
            showOrderTypeControls={isPosMode}
          />

          {isCompletedMode ? (
            <OrderManagementPanel
              panelMode={orderMode}
              fullPage
              readOnly={false}
              searchValue={orderSearchInput}
              onSearchChange={setOrderSearchInput}
              orders={filteredTodayOrders}
              loading={ordersLoading}
              error={ordersError}
              onRefresh={loadTodayOrders}
              onReprint={reprintOrder}
              onUpdateStatus={updateOrderStatus}
              canManageStatus={isManagerOrAdmin}
              statusActionBusyId={statusActionBusyId}
            />
          ) : (
            <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_400px]">
              <div className="space-y-3">
                {!isPosMode ? (
                  <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-soft">
                    <h3 className="text-base font-semibold text-slate-900">Online Orders Feed</h3>
                    <p className="mt-2 text-sm text-slate-600">
                      This panel is read-only. Incoming website/app orders will appear in the Online Queue.
                    </p>
                    <p className="mt-2 rounded-lg bg-slate-100 px-3 py-2 text-xs text-slate-600">
                      Website API credentials are pending. Queue view is ready and polling.
                    </p>
                  </div>
                ) : (
                  <>
                    <div className="rounded-2xl border border-slate-200 bg-white p-3 shadow-soft">
                      <input
                        value={searchInput}
                        onChange={(event) => setSearchInput(event.target.value)}
                        placeholder="Search products by name or SKU"
                        className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                      />
                    </div>

                    <SectionTabs
                      sections={sections}
                      activeSectionId={activeSectionId}
                      onChangeSection={(sectionId) => setActiveSectionId(sectionId)}
                    />

                    {sectionsError && (
                      <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                        <div className="flex items-center justify-between gap-2">
                          <span>{sectionsError}</span>
                          <button
                            type="button"
                            onClick={loadSections}
                            className="rounded-md border border-amber-300 bg-white px-2 py-1 text-xs font-medium"
                          >
                            Retry
                          </button>
                        </div>
                      </div>
                    )}

                    <ProductGrid
                      items={visibleCatalogItems}
                      loading={itemsLoading}
                      error={itemsError}
                      onRetry={() => loadItems({ page: 1, append: false })}
                      onAddItem={addToCart}
                      cartQuantityByProduct={cartQuantityByProduct}
                      hasMore={hasMoreItems}
                      loadingMore={itemsLoadingMore}
                      onLoadMore={loadMoreItems}
                    />
                  </>
                )}
              </div>

              <div className="space-y-4">
                {isPosMode ? (
                  <CartPanel
                    lines={cartLines}
                    localSubtotal={localSubtotal}
                    quote={quote}
                    quoteLoading={quoteLoading}
                    quoteError={quoteError}
                    paymentMethod={paymentMethod}
                    onPaymentMethodChange={(method) => {
                      if (pendingOrder) return;
                      setPaymentMethod(method);
                      if (method !== 'cash') setCashReceivedInput('');
                    }}
                    onIncrementLine={incrementLine}
                    onDecrementLine={decrementLine}
                    onRemoveLine={removeLine}
                    onUpdateLineNote={updateLineNote}
                    promoInput={promoInput}
                    appliedPromoCode={appliedPromoCode}
                    onPromoInputChange={setPromoInput}
                    onApplyPromo={applyPromo}
                    onRemovePromo={removePromo}
                    promoError={promoError}
                    checkoutBusy={checkoutBusy}
                    checkoutError={checkoutError}
                    pendingOrder={pendingOrder}
                    onConfirmOrder={confirmOrder}
                    onMarkAsCompleted={markOrderAsCompleted}
                    manualDiscountEnabled={isManagerOrAdmin}
                    manualDiscountInput={manualDiscountInput}
                    onManualDiscountInputChange={setManualDiscountInput}
                    onClearCart={clearCart}
                    onHoldOrder={holdOrder}
                    heldOrders={heldOrders}
                    onResumeHeldOrder={resumeHeldOrder}
                    onDeleteHeldOrder={deleteHeldOrder}
                    cashReceivedInput={cashReceivedInput}
                    onCashReceivedInputChange={setCashReceivedInput}
                    changeDue={changeDue}
                    isCashInsufficient={isCashInsufficient}
                    onOpenCashDrawer={openCashDrawer}
                    cashDrawerStatus={cashDrawerStatus}
                    checkoutDisabled={checkoutDisabled}
                  />
                ) : (
                  <div className="rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-600 shadow-soft">
                    POS checkout is disabled in Online Orders mode.
                  </div>
                )}

                <ShiftPanel
                  activeShift={activeShift}
                  shiftLoading={shiftLoading}
                  shiftLockedForDay={shiftLockedForDay}
                  shiftApiUnavailable={shiftApiUnavailable}
                  openingCashInput={openingCashInput}
                  closingCashInput={closingCashInput}
                  expenseInput={expenseInput}
                  onOpeningCashChange={setOpeningCashInput}
                  onClosingCashChange={setClosingCashInput}
                  onExpenseChange={setExpenseInput}
                  onAddExpense={addShiftExpense}
                  onStartShift={startShift}
                  onEndShift={endShift}
                  shiftReport={lastShiftReport}
                />

                <OrderManagementPanel
                  panelMode={orderMode}
                  readOnly={isOnlineMode}
                  searchValue={orderSearchInput}
                  onSearchChange={setOrderSearchInput}
                  orders={filteredTodayOrders}
                  loading={ordersLoading}
                  error={ordersError}
                  onRefresh={loadTodayOrders}
                  onReprint={reprintOrder}
                  onUpdateStatus={updateOrderStatus}
                  canManageStatus={!isOnlineMode && isManagerOrAdmin}
                  statusActionBusyId={statusActionBusyId}
                />
              </div>
            </div>
          )}
        </div>
      )}

      <AddOnModal
        open={addonModal.open}
        item={addonModal.item}
        addonGroups={addonModal.addonGroups}
        onClose={closeAddonModal}
        onConfirm={addModalSelectionToCart}
      />

      {showPinModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 px-4">
          <div className="w-full max-w-xs rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl">
            <h3 className="text-center text-lg font-semibold text-slate-900">Switch to Admin</h3>
            <p className="mt-1 text-center text-xs text-slate-500">Enter your 4-digit PIN</p>

            <div className="mt-4 grid grid-cols-4 gap-2">
              {[0, 1, 2, 3].map((index) => (
                <div
                  key={index}
                  className="flex h-10 items-center justify-center rounded-lg border border-slate-200 bg-slate-50 text-lg"
                >
                  {pinValue[index] ? '*' : ''}
                </div>
              ))}
            </div>

            <div className="mt-4 grid grid-cols-3 gap-2">
              {['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'Del'].map((key) => (
                <button
                  key={key || 'blank'}
                  type="button"
                  onClick={() => {
                    if (!key) return;
                    if (key === 'Del') {
                      removePinDigit();
                      return;
                    }
                    appendPinDigit(key);
                  }}
                  disabled={!key}
                  className={`h-10 rounded-lg border text-sm font-medium ${
                    key
                      ? 'border-slate-200 bg-white hover:border-brandYellow hover:bg-brandYellow/10'
                      : 'border-transparent bg-transparent'
                  }`}
                >
                  {key}
                </button>
              ))}
            </div>

            {pinError && <p className="mt-3 text-center text-xs text-rose-600">{pinError}</p>}

            <div className="mt-4 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={resetPinModal}
                className="rounded-lg border border-slate-200 py-2 text-sm font-medium text-slate-700"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={submitPin}
                className="rounded-lg bg-slate-900 py-2 text-sm font-semibold text-white hover:bg-slate-700"
              >
                Continue
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default Cashier;
