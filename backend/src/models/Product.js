// Product model schema

const productSchema = {
  id: 'unique_id',
  name: 'string',
  sku: 'string',
  price: 'decimal',
  cost: 'decimal',
  quantity: 'integer',
  category: 'string',
  description: 'text',
  createdAt: 'timestamp',
  updatedAt: 'timestamp'
};

module.exports = productSchema;
