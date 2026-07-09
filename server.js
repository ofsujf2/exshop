const express = require('express');
const session = require('express-session');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const https = require('https');

const app = express();
const PORT = process.env.PORT || 3000;

const pool = new Pool({
    connectionString: process.env.DATABASE_URL || 'postgresql://localhost/shop',
    ssl: { rejectUnauthorized: false }
});

// Crypto wallets
const CRYPTO_WALLETS = {
    BTC: "bc1qqkl35zull7py2zt8fvugxh0hs6elarxuzwcmka",
    ETH: "0x0536b4264B1AaA26B5A97c3184692b25Fa7e1628",
    SOL: "2tUKR6CrndRiFR5iaRYhHwgA6uG1dqNbAVFKwwhXpkWE",
    LTC: "LSEjnWc4NTWz9s3Sy7KsNFPk6DakAJAkaX"
};

app.set('view engine', 'ejs');
app.use(express.static('public'));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(session({ secret: 'shop-' + Math.random(), resave: false, saveUninitialized: false }));

const storage = multer.diskStorage({
    destination: 'public/uploads/',
    filename: (req, file, cb) => cb(null, Date.now() + path.extname(file.originalname))
});
const upload = multer({ storage });

['public/uploads', 'public/css'].forEach(d => {
    if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
});

pool.query(`
    CREATE TABLE IF NOT EXISTS admin (id SERIAL PRIMARY KEY, username TEXT UNIQUE, password TEXT);
    CREATE TABLE IF NOT EXISTS users (id SERIAL PRIMARY KEY, username TEXT UNIQUE, email TEXT UNIQUE, password TEXT, full_name TEXT, profile_pic TEXT, bio TEXT, created_at TEXT);
    CREATE TABLE IF NOT EXISTS products (id SERIAL PRIMARY KEY, name TEXT, description TEXT, price REAL, image TEXT, category TEXT DEFAULT 'All', sales_count INTEGER DEFAULT 0, stock INTEGER DEFAULT 100, created_at TEXT);
    CREATE TABLE IF NOT EXISTS orders (id SERIAL PRIMARY KEY, product_id INTEGER, payment_method TEXT, amount REAL, status TEXT DEFAULT 'completed', customer_name TEXT, customer_email TEXT, created_at TEXT);
    CREATE TABLE IF NOT EXISTS messages (id SERIAL PRIMARY KEY, sender_id INTEGER, receiver_id INTEGER, text TEXT, read INTEGER DEFAULT 0, created_at TEXT);
    CREATE TABLE IF NOT EXISTS payment_config (id SERIAL PRIMARY KEY, paypal_client_id TEXT, paypal_secret TEXT, paypal_verified INTEGER DEFAULT 0);
`).then(() => {
    pool.query("SELECT * FROM admin WHERE username = 'admin'").then(r => {
        if (r.rows.length === 0) {
            pool.query("INSERT INTO admin (username, password) VALUES ($1, $2)", ['admin', bcrypt.hashSync('executive2026', 10)]);
        }
    });
});

const requireUser = (req, res, next) => req.session.userId ? next() : res.redirect('/login');
const requireAdmin = (req, res, next) => req.session.admin ? next() : res.redirect('/admin/login');

function getPayPalToken(clientId, secret) {
    return new Promise((resolve, reject) => {
        const auth = Buffer.from(`${clientId}:${secret}`).toString('base64');
        https.request({
            hostname: 'api-m.paypal.com', path: '/v1/oauth2/token', method: 'POST',
            headers: { 'Authorization': `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' }
        }, (res) => { let d=''; res.on('data',c=>d+=c); res.on('end',()=>{try{resolve(JSON.parse(d))}catch(e){reject(e)}}); }).on('error', reject).write('grant_type=client_credentials').end();
    });
}

app.get('/', async (req, res) => {
    const cat = req.query.category || 'All';
    const query = cat === 'All' ? "SELECT * FROM products" : "SELECT * FROM products WHERE category = $1";
    const params = cat === 'All' ? [] : [cat];
    const products = await pool.query(query, params);
    const top = await pool.query("SELECT * FROM products ORDER BY sales_count DESC LIMIT 10");
    res.render('home', { products: products.rows, top_products: top.rows, current_category: cat, user: req.session.userId });
});

app.get('/product/:id', async (req, res) => {
    const product = await pool.query("SELECT * FROM products WHERE id = $1", [req.params.id]);
    if (product.rows.length === 0) return res.redirect('/');
    const config = await pool.query("SELECT * FROM payment_config LIMIT 1");
    res.render('product', { product: product.rows[0], user: req.session.userId, config: config.rows[0] });
});

app.get('/checkout/:id', async (req, res) => {
    const product = await pool.query("SELECT * FROM products WHERE id = $1", [req.params.id]);
    if (product.rows.length === 0) return res.redirect('/');
    res.render('checkout', { product: product.rows[0], user: req.session.userId, wallets: CRYPTO_WALLETS });
});

app.post('/checkout/:id', async (req, res) => {
    const product = await pool.query("SELECT * FROM products WHERE id = $1", [req.params.id]);
    if (product.rows.length === 0) return res.redirect('/');
    const { name, email, payment_method } = req.body;
    await pool.query("INSERT INTO orders (product_id, payment_method, amount, customer_name, customer_email, created_at) VALUES ($1,$2,$3,$4,$5,NOW())",
        [product.rows[0].id, payment_method || 'paypal', product.rows[0].price, name || 'N/A', email || 'N/A']);
    await pool.query("UPDATE products SET sales_count = sales_count + 1 WHERE id = $1", [product.rows[0].id]);
    res.redirect('/success');
});

app.get('/success', (req, res) => res.render('success'));
app.get('/cancel', (req, res) => res.render('cancel'));
app.get('/register', (req, res) => res.render('register', { user: req.session.userId }));
app.post('/register', async (req, res) => {
    const { username, email, password, full_name } = req.body;
    if (!username || !email || !password) return res.status(400).send('All fields required');
    try {
        const r = await pool.query("INSERT INTO users (username, email, password, full_name, created_at) VALUES ($1,$2,$3,$4,NOW()) RETURNING id",
            [username, email, bcrypt.hashSync(password, 10), full_name]);
        req.session.userId = r.rows[0].id;
        res.redirect('/');
    } catch(e) { res.status(400).send('Error'); }
});
app.get('/login', (req, res) => res.render('login', { user: req.session.userId }));
app.post('/login', async (req, res) => {
    const { username, password } = req.body;
    const admin = await pool.query("SELECT * FROM admin WHERE username = $1", [username]);
    if (admin.rows[0] && bcrypt.compareSync(password, admin.rows[0].password)) {
        req.session.admin = true;
        return res.redirect('/admin');
    }
    const user = await pool.query("SELECT * FROM users WHERE username = $1", [username]);
    if (user.rows[0] && bcrypt.compareSync(password, user.rows[0].password)) {
        req.session.userId = user.rows[0].id;
        return res.redirect('/');
    }
    res.status(401).send('Invalid credentials');
});
app.get('/logout', (req, res) => { req.session.destroy(); res.redirect('/'); });
app.get('/profile', requireUser, async (req, res) => {
    const user = await pool.query("SELECT * FROM users WHERE id = $1", [req.session.userId]);
    res.render('profile', { user: user.rows[0] });
});
app.get('/profile/edit', requireUser, async (req, res) => {
    const user = await pool.query("SELECT * FROM users WHERE id = $1", [req.session.userId]);
    res.render('edit-profile', { user: user.rows[0] });
});
app.post('/profile/edit', requireUser, upload.single('profile_pic'), async (req, res) => {
    const { full_name, bio } = req.body;
    const pic = req.file ? req.file.filename : null;
    if (pic) await pool.query("UPDATE users SET profile_pic = $1 WHERE id = $2", [pic, req.session.userId]);
    await pool.query("UPDATE users SET full_name = $1, bio = $2 WHERE id = $3", [full_name || '', bio || '', req.session.userId]);
    res.redirect('/profile');
});
app.get('/messages', requireUser, (req, res) => res.render('messages', { contacts: [], user: req.session.userId }));
app.get('/chat/:id', requireUser, async (req, res) => {
    const other = await pool.query("SELECT * FROM users WHERE id = $1", [req.params.id]);
    if (other.rows.length === 0) return res.redirect('/messages');
    const msgs = await pool.query("SELECT * FROM messages WHERE (sender_id=$1 AND receiver_id=$2) OR (sender_id=$2 AND receiver_id=$1) ORDER BY created_at ASC",
        [req.session.userId, req.params.id]);
    res.render('chat', { messages: msgs.rows, other_user: other.rows[0], userId: req.session.userId });
});
app.post('/chat/:id', requireUser, async (req, res) => {
    await pool.query("INSERT INTO messages (sender_id, receiver_id, text, created_at) VALUES ($1,$2,$3,NOW())",
        [req.session.userId, req.params.id, req.body.message]);
    res.redirect('/chat/' + req.params.id);
});

// ADMIN
app.get('/admin/login', (req, res) => res.render('admin-login'));
app.post('/admin/login', async (req, res) => {
    const admin = await pool.query("SELECT * FROM admin WHERE username = $1", [req.body.username]);
    if (admin.rows[0] && bcrypt.compareSync(req.body.password, admin.rows[0].password)) {
        req.session.admin = true;
        return res.redirect('/admin');
    }
    res.status(401).send('Invalid');
});
app.get('/admin', requireAdmin, async (req, res) => {
    const products = await pool.query("SELECT * FROM products");
    const orders = await pool.query("SELECT * FROM orders ORDER BY created_at DESC LIMIT 20");
    const config = await pool.query("SELECT * FROM payment_config LIMIT 1");
    res.render('admin', { products: products.rows, orders: orders.rows, config: config.rows[0] });
});
app.post('/admin/add', requireAdmin, upload.single('image'), async (req, res) => {
    const { name, description, price, category, stock } = req.body;
    const img = req.file ? req.file.filename : null;
    await pool.query("INSERT INTO products (name, description, price, image, category, sales_count, stock, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,NOW())",
        [name, description, parseFloat(price), img, category || 'All', Math.floor(Math.random()*450)+50, parseInt(stock)||100]);
    res.redirect('/admin');
});
app.get('/admin/delete/:id', requireAdmin, async (req, res) => {
    await pool.query("DELETE FROM products WHERE id = $1", [req.params.id]);
    res.redirect('/admin');
});
app.post('/admin/save-keys', requireAdmin, async (req, res) => {
    const { paypal_client_id, paypal_secret } = req.body;
    let verified = 0;
    try { const t = await getPayPalToken(paypal_client_id, paypal_secret); verified = t.access_token ? 1 : 0; } catch(e) {}
    const c = await pool.query("SELECT * FROM payment_config LIMIT 1");
    if (c.rows[0]) {
        await pool.query("UPDATE payment_config SET paypal_client_id=$1, paypal_secret=$2, paypal_verified=$3 WHERE id=$4",
            [paypal_client_id, paypal_secret, verified, c.rows[0].id]);
    } else {
        await pool.query("INSERT INTO payment_config (paypal_client_id, paypal_secret, paypal_verified) VALUES ($1,$2,$3)",
            [paypal_client_id, paypal_secret, verified]);
    }
    res.json({ success: true, message: verified ? '✅ PayPal Verified!' : '❌ Not verified' });
});

app.listen(PORT, () => console.log(`\n✅ Executive Shop: http://localhost:${PORT}\n✅ admin / executive2026\n`));