import React, { useEffect, useMemo, useState } from 'react';
import api from '../services/api';

const CASHIER_ID = 1;

const formatMoney = (value) => `Rs ${Number(value).toFixed(2)}`;

function Cashier() {
  const [products, setProducts] = useState([]);
  const [cart, setCart] = useState([]);
  const [paymentMethod, setPaymentMethod] = useState('cash');
  const [status, setStatus] = useState('');

  useEffect(() => {
    api
      .get('/products')
      .then((res) => {
        setProducts(res.data.data || []);
      })
      .catch(() => {
        setStatus('Failed to load products');
      });
  }, []);

  const cartTotal = useMemo(
    () => cart.reduce((sum, item) => sum + item.price * item.quantity, 0),
    [cart]
  );

  const addToCart = (product) => {
    setCart((current) => {
      const existing = current.find((item) => item.id === product.id);
      if (existing) {
        return current.map((item) =>
          item.id === product.id
            ? { ...item, quantity: item.quantity + 1 }
            : item
        );
      }
      return [...current, { ...product, quantity: 1 }];
    });
  };

  const updateQty = (productId, quantity) => {
    if (quantity <= 0) {
      setCart((current) => current.filter((item) => item.id !== productId));
      return;
    }
    setCart((current) =>
      current.map((item) =>
        item.id === productId ? { ...item, quantity } : item
      )
    );
  };

  const checkout = async () => {
    if (cart.length === 0) {
      setStatus('Cart is empty');
      return;
    }
    setStatus('Processing sale...');
    try {
      const payload = {
        items: cart.map((item) => ({
          productId: item.id,
          quantity: item.quantity,
        })),
        paymentMethod,
        cashierId: CASHIER_ID,
      };
      await api.post('/sales', payload);
      setCart([]);
      setStatus('Sale completed');
    } catch (err) {
      const message =
        err.response?.data?.error || 'Failed to complete sale';
      setStatus(message);
    }
  };

  return (
    <div style={{ padding: 24, display: 'grid', gap: 24, gridTemplateColumns: '2fr 1fr' }}>
      <section>
        <h2>Products</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 12 }}>
          {products.map((product) => (
            <button
              key={product.id}
              type="button"
              onClick={() => addToCart(product)}
              style={{
                border: '1px solid #ddd',
                borderRadius: 8,
                padding: 12,
                textAlign: 'left',
                background: '#fff',
                cursor: 'pointer',
              }}
            >
              <div style={{ fontWeight: 600 }}>{product.name}</div>
              <div>{formatMoney(product.price)}</div>
              {typeof product.stock === 'number' && (
                <div style={{ fontSize: 12, color: '#666' }}>
                  Stock: {product.stock}
                </div>
              )}
            </button>
          ))}
        </div>
      </section>
      <section>
        <h2>Cart</h2>
        {cart.length === 0 ? (
          <div>No items yet</div>
        ) : (
          <div style={{ display: 'grid', gap: 12 }}>
            {cart.map((item) => (
              <div
                key={item.id}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr auto auto',
                  gap: 8,
                  alignItems: 'center',
                }}
              >
                <div>
                  <div style={{ fontWeight: 600 }}>{item.name}</div>
                  <div style={{ fontSize: 12, color: '#666' }}>
                    {formatMoney(item.price)}
                  </div>
                </div>
                <input
                  type="number"
                  min="0"
                  value={item.quantity}
                  onChange={(e) => updateQty(item.id, Number(e.target.value))}
                  style={{ width: 64, padding: 4 }}
                />
                <div>{formatMoney(item.price * item.quantity)}</div>
              </div>
            ))}
          </div>
        )}
        <div style={{ marginTop: 16, fontWeight: 600 }}>
          Total: {formatMoney(cartTotal)}
        </div>
        <div style={{ marginTop: 12 }}>
          <label>
            Payment:
            <select
              value={paymentMethod}
              onChange={(e) => setPaymentMethod(e.target.value)}
              style={{ marginLeft: 8 }}
            >
              <option value="cash">Cash</option>
              <option value="credit">Credit</option>
            </select>
          </label>
        </div>
        <button
          type="button"
          onClick={checkout}
          style={{
            marginTop: 16,
            padding: '10px 16px',
            background: '#0f172a',
            color: '#fff',
            border: 'none',
            borderRadius: 6,
            cursor: 'pointer',
          }}
        >
          Checkout
        </button>
        {status && <div style={{ marginTop: 12 }}>{status}</div>}
      </section>
    </div>
  );
}

export default Cashier;
