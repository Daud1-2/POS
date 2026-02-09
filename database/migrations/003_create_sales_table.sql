-- Create Sales Table
CREATE TABLE sales (
  id INT PRIMARY KEY AUTO_INCREMENT,
  sale_number VARCHAR(100) NOT NULL UNIQUE,
  customer_id INT,
  subtotal DECIMAL(10, 2),
  tax DECIMAL(10, 2),
  total DECIMAL(10, 2) NOT NULL,
  payment_method ENUM('cash', 'credit') DEFAULT 'cash',
  status ENUM('completed', 'pending', 'cancelled') DEFAULT 'completed',
  cashier_id INT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (cashier_id) REFERENCES users(id)
);
