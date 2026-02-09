// User model schema
// To be implemented with Mongoose or database of choice

const userSchema = {
  id: 'unique_id',
  username: 'string',
  email: 'string',
  password: 'hashed_password',
  role: 'admin|cashier',
  createdAt: 'timestamp',
  updatedAt: 'timestamp'
};

module.exports = userSchema;
