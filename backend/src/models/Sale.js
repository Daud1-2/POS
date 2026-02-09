// Sale/Transaction model schema

const saleSchema = {
  id: 'unique_id',
  saleNumber: 'string',
  customerId: 'reference_to_customer',
  items: [{
    productId: 'reference_to_product',
    quantity: 'integer',
    unitPrice: 'decimal',
    total: 'decimal'
  }],
  subtotal: 'decimal',
  tax: 'decimal',
  total: 'decimal',
  paymentMethod: 'cash|credit',
  status: 'completed|pending|cancelled',
  cashierId: 'reference_to_user',
  createdAt: 'timestamp',
  updatedAt: 'timestamp'
};

module.exports = saleSchema;
