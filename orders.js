function run(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) { if (err) return reject(err); resolve(this); });
  });
}
function get(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => { if (err) return reject(err); resolve(row); });
  });
}
async function createOrder(db, { productId, amount, paymentMethod, customer }) {
  const result = await run(db,
    `INSERT INTO orders (product_id, payment_method, amount, status, customer_name, customer_email, customer_address, customer_city, customer_zip, created_at)
     VALUES (?, ?, ?, 'pending', ?, ?, ?, ?, ?, datetime('now'))`,
    [productId, paymentMethod, amount, customer.name, customer.email, customer.address, customer.city, customer.zip_code]);
  return get(db, `SELECT * FROM orders WHERE id = ?`, [result.lastID]);
}
module.exports = { createOrder, getOrder: get, markProductSold: async (db, id) => { await run(db, `UPDATE products SET sales_count = sales_count + 1 WHERE id = ?`, [id]); } };
