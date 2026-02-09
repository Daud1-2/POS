const nowIso = () => new Date().toISOString();

const store = {
  products: [
    { id: 1, name: 'Cola 500ml', sku: 'COLA-500', price: 120, stock: 48 },
    { id: 2, name: 'Water 1.5L', sku: 'WATER-15', price: 80, stock: 64 },
    { id: 3, name: 'Chips', sku: 'CHIPS-01', price: 60, stock: 100 },
  ],
  sales: [],
  saleSeq: 1,
};

const nextSaleNumber = () => {
  const num = String(store.saleSeq).padStart(6, '0');
  store.saleSeq += 1;
  return `S-${num}`;
};

const computeTotals = (items) => {
  const subtotal = items.reduce((sum, item) => sum + item.total, 0);
  const tax = 0;
  const total = subtotal + tax;
  return { subtotal, tax, total };
};

const buildSale = ({ items, paymentMethod, cashierId, customerId }) => {
  const saleItems = items.map((item) => {
    const product = store.products.find((p) => p.id === item.productId);
    return {
      productId: product.id,
      quantity: item.quantity,
      unitPrice: product.price,
      total: product.price * item.quantity,
    };
  });

  const { subtotal, tax, total } = computeTotals(saleItems);
  const sale = {
    id: store.sales.length + 1,
    saleNumber: nextSaleNumber(),
    customerId: customerId || null,
    items: saleItems,
    subtotal,
    tax,
    total,
    paymentMethod,
    status: paymentMethod === 'credit' ? 'pending' : 'completed',
    cashierId,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };

  store.sales.push(sale);
  saleItems.forEach((item) => {
    const product = store.products.find((p) => p.id === item.productId);
    if (product && typeof product.stock === 'number') {
      product.stock = Math.max(0, product.stock - item.quantity);
    }
  });

  return sale;
};

module.exports = {
  store,
  buildSale,
};
