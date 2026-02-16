const PRINTER_SELECTOR_KEY = 'browserPosPrinterSelector';
const RECEIPT_WIDTH = 42;

const ESC_INIT = [0x1b, 0x40];
const ESC_CUT = [0x1d, 0x56, 0x41, 0x03];
const ESC_DRAWER_PULSE = [0x1b, 0x70, 0x00, 0x32, 0xfa];

const safeJsonParse = (raw, fallback = null) => {
  try {
    if (!raw) return fallback;
    return JSON.parse(raw);
  } catch (_) {
    return fallback;
  }
};

const toAscii = (value) =>
  String(value ?? '')
    .normalize('NFKD')
    .replace(/[^\x20-\x7E]/g, '')
    .trim();

const padRight = (text, width) => {
  const value = String(text || '');
  if (value.length >= width) return value.slice(0, width);
  return value + ' '.repeat(width - value.length);
};

const lineWithRight = (left, right, width = RECEIPT_WIDTH) => {
  const leftText = String(left || '');
  const rightText = String(right || '');
  if (!rightText) return leftText.slice(0, width);
  const availableLeft = Math.max(1, width - rightText.length - 1);
  const croppedLeft = leftText.length > availableLeft ? leftText.slice(0, availableLeft) : leftText;
  return `${padRight(croppedLeft, availableLeft)} ${rightText}`;
};

const formatMoney = (value) => {
  const amount = Number(value || 0);
  return `Rs ${amount.toLocaleString()}`;
};

const formatDateTime = (value) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
};

const isSupported = () =>
  typeof window !== 'undefined'
  && window.isSecureContext
  && typeof navigator !== 'undefined'
  && typeof navigator.usb !== 'undefined';

const getSavedPrinterSelector = () =>
  safeJsonParse(localStorage.getItem(PRINTER_SELECTOR_KEY), null);

const savePrinterSelector = (device) => {
  if (!device) return;
  localStorage.setItem(
    PRINTER_SELECTOR_KEY,
    JSON.stringify({
      vendorId: device.vendorId ?? null,
      productId: device.productId ?? null,
      serialNumber: device.serialNumber || null,
      productName: device.productName || null,
    })
  );
};

const matchSavedDevice = (device, selector) => {
  if (!selector || !device) return false;
  const sameVendor = Number(device.vendorId || 0) === Number(selector.vendorId || 0);
  const sameProduct = Number(device.productId || 0) === Number(selector.productId || 0);
  if (!sameVendor || !sameProduct) return false;
  if (!selector.serialNumber) return true;
  return String(device.serialNumber || '') === String(selector.serialNumber || '');
};

const requestPrinterDevice = async () => {
  if (!isSupported()) {
    throw new Error('Browser USB printing requires HTTPS/localhost and a Chromium-based browser');
  }

  const device = await navigator.usb.requestDevice({
    filters: [{ classCode: 7 }, { classCode: 255 }],
  });
  savePrinterSelector(device);
  return device;
};

const getRememberedPrinterDevice = async () => {
  if (!isSupported()) return null;
  const selector = getSavedPrinterSelector();
  if (!selector) return null;
  const devices = await navigator.usb.getDevices();
  return devices.find((device) => matchSavedDevice(device, selector)) || null;
};

const getPrinterDevice = async ({ interactive = false } = {}) => {
  let device = await getRememberedPrinterDevice();
  if (!device && interactive) {
    device = await requestPrinterDevice();
  }
  if (!device) {
    throw new Error('No USB printer selected. Choose printer once from Print/Open Drawer action.');
  }
  return device;
};

const resolveOutputEndpoint = (device) => {
  const configuration = device.configuration || device.configurations?.[0];
  if (!configuration) {
    throw new Error('Unable to read printer USB configuration');
  }

  for (const iface of configuration.interfaces || []) {
    for (const alternate of iface.alternates || []) {
      const outEndpoint = (alternate.endpoints || []).find((endpoint) => endpoint.direction === 'out');
      if (outEndpoint) {
        return {
          interfaceNumber: iface.interfaceNumber,
          alternateSetting: alternate.alternateSetting || 0,
          endpointNumber: outEndpoint.endpointNumber,
        };
      }
    }
  }

  throw new Error('No writable USB endpoint found on selected printer');
};

const ensureDeviceReady = async (device) => {
  if (!device.opened) {
    await device.open();
  }

  if (!device.configuration) {
    const configValue = device.configurations?.[0]?.configurationValue || 1;
    await device.selectConfiguration(configValue);
  }

  const endpoint = resolveOutputEndpoint(device);

  try {
    await device.claimInterface(endpoint.interfaceNumber);
  } catch (error) {
    const message = String(error?.message || '');
    if (!message.toLowerCase().includes('claimed')) {
      throw error;
    }
  }

  try {
    await device.selectAlternateInterface(endpoint.interfaceNumber, endpoint.alternateSetting);
  } catch (_) {
    // alternate selection is optional for many printers
  }

  return endpoint;
};

const writeToPrinter = async (bytes, { interactive = false } = {}) => {
  const device = await getPrinterDevice({ interactive });
  const endpoint = await ensureDeviceReady(device);
  const payload = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const result = await device.transferOut(endpoint.endpointNumber, payload);

  if (result.status && result.status !== 'ok') {
    throw new Error(`Printer write failed: ${result.status}`);
  }

  return true;
};

const buildReceiptBytes = ({ receipt, branchLabel }) => {
  const items = Array.isArray(receipt?.items) ? receipt.items : [];
  const title = toAscii(branchLabel) || 'POS RECEIPT';
  const orderNo = toAscii(receipt?.order_number || '-');
  const dateText = toAscii(formatDateTime(receipt?.created_at));
  const status = toAscii(String(receipt?.status || '').toUpperCase());

  const lines = [
    title,
    ''.padEnd(RECEIPT_WIDTH, '-'),
    lineWithRight('Order', orderNo),
    lineWithRight('Date', dateText),
    lineWithRight('Status', status),
    ''.padEnd(RECEIPT_WIDTH, '-'),
  ];

  items.forEach((item) => {
    const name = toAscii(item?.product_name || item?.name || 'Item');
    const qty = Number(item?.quantity || 0);
    const total = formatMoney(item?.total_price);
    lines.push(lineWithRight(`${qty} x ${name}`, toAscii(total)));

    const modifiers = item?.modifiers && typeof item.modifiers === 'object' ? item.modifiers : {};
    const addons = Array.isArray(modifiers.addons) ? modifiers.addons : [];
    addons.forEach((group) => {
      const groupLabel = toAscii(group?.group_label || group?.group_id || '');
      const options = Array.isArray(group?.options)
        ? group.options.map((opt) => toAscii(opt?.label || opt?.option_id || '')).filter(Boolean)
        : [];
      if (groupLabel && options.length) {
        lines.push(`  ${groupLabel}: ${options.join(', ')}`.slice(0, RECEIPT_WIDTH));
      }
    });

    const note = toAscii(modifiers.note || '');
    if (note) {
      lines.push(`  Note: ${note}`.slice(0, RECEIPT_WIDTH));
    }
  });

  lines.push(''.padEnd(RECEIPT_WIDTH, '-'));
  lines.push(lineWithRight('Subtotal', toAscii(formatMoney(receipt?.subtotal))));
  lines.push(lineWithRight('Discount', toAscii(formatMoney(receipt?.discount))));
  lines.push(lineWithRight('Tax', toAscii(formatMoney(receipt?.tax))));
  lines.push(lineWithRight('Total', toAscii(formatMoney(receipt?.total))));
  lines.push(''.padEnd(RECEIPT_WIDTH, '-'));
  lines.push('Thank you!');
  lines.push('');
  lines.push('');

  const textEncoder = new TextEncoder();
  const textBytes = textEncoder.encode(lines.join('\n'));
  return new Uint8Array([...ESC_INIT, ...textBytes, 0x0a, ...ESC_CUT]);
};

const printReceiptInBrowserMode = async ({ receipt, branchLabel, interactive = false } = {}) => {
  const bytes = buildReceiptBytes({ receipt, branchLabel });
  return writeToPrinter(bytes, { interactive });
};

const openDrawerInBrowserMode = async ({ interactive = false } = {}) =>
  writeToPrinter(new Uint8Array([...ESC_INIT, ...ESC_DRAWER_PULSE]), { interactive });

export {
  isSupported as isBrowserPosHardwareSupported,
  requestPrinterDevice,
  printReceiptInBrowserMode,
  openDrawerInBrowserMode,
};
