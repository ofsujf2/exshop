const express = require('express');
const session = require('express-session');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;
const db = new sqlite3.Database('/data/shop.db');

app.set('view engine', 'ejs');
app.use(express.static('public'));
app.use('/uploads', express.static('public/uploads'));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(session({ secret: 'shop', resave: false, saveUninitialized: false }));

const storage = multer.diskStorage({
    destination: 'public/uploads/',
    filename: (req, file, cb) => cb(null, Date.now() + path.extname(file.originalname))
});
const upload = multer({ storage });
['public/uploads', 'public/css'].forEach(d => { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); });

db.serialize(() => {
    db.run("CREATE TABLE IF NOT EXISTS admin (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT, password TEXT)");
    db.run("CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT, email TEXT, password TEXT, full_name TEXT, created_at TEXT)");
    db.run("CREATE TABLE IF NOT EXISTS products (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, description TEXT, price REAL, image TEXT, category TEXT DEFAULT 'All', sales_count INTEGER DEFAULT 0, stock INTEGER DEFAULT 100, created_at TEXT)");
    db.run("CREATE TABLE IF NOT EXISTS orders (id INTEGER PRIMARY KEY AUTOINCREMENT, product_id INTEGER, amount REAL, customer_name TEXT, customer_email TEXT, created_at TEXT)");
    db.run("CREATE TABLE IF NOT EXISTS payment_config (id INTEGER PRIMARY KEY AUTOINCREMENT, paypal_client_id TEXT, paypal_secret TEXT, paypal_verified INTEGER DEFAULT 0)");
    db.run("INSERT OR IGNORE INTO admin (id, username, password) VALUES (1, 'admin', ?)", [bcrypt.hashSync('executive2026', 10)]);
});

const requireAdmin = (req, res, next) => req.session.admin ? next() : res.redirect('/admin/login');

app.get('/', (req, res) => {
    db.all("SELECT * FROM products", (err, products) => {
        db.all("SELECT * FROM products ORDER BY sales_count DESC LIMIT 10", (err, top) => {
            res.render('home', { products: products || [], top_products: top || [], current_category: 'All', user: req.session.userId });
        });
    });
});

app.get('/product/:id', (req, res) => {
    db.get("SELECT * FROM products WHERE id = ?", [req.params.id], (err, p) => {
        if (!p) return res.redirect('/');
        res.render('product', { product: p, user: req.session.userId, config: null });
    });
});

app.get('/checkout/:id', (req, res) => {
    db.get("SELECT * FROM products WHERE id = ?", [req.params.id], (err, p) => {
        if (!p) return res.redirect('/');
        res.render('checkout', { product: p, user: req.session.userId, wallets: {} });
    });
});

app.post('/checkout/:id', (req, res) => {
    db.get("SELECT * FROM products WHERE id = ?", [req.params.id], (err, p) => {
        if (!p) return res.redirect('/');
        db.run("INSERT INTO orders (product_id, amount, customer_name, customer_email, created_at) VALUES (?,?,?,?,datetime('now'))", [p.id, p.price, req.body.name || '', req.body.email || '']);
        db.run("UPDATE products SET sales_count = sales_count + 1 WHERE id = ?", [p.id]);
        res.redirect('/success');
    });
});

app.get('/success', (req, res) => res.render('success'));
app.get('/cancel', (req, res) => res.render('cancel'));
app.get('/register', (req, res) => res.render('register', { user: req.session.userId }));
app.post('/register', (req, res) => {
    const { username, email, password, full_name } = req.body;
    if (!username || !email || !password) return res.send('All fields required');
    db.run("INSERT INTO users (username, email, password, full_name, created_at) VALUES (?,?,?,?,datetime('now'))", [username, email, bcrypt.hashSync(password, 10), full_name], function(err) {
        if (err) return res.send('Error');
        req.session.userId = this.lastID;
        res.redirect('/');
    });
});
app.get('/login', (req, res) => res.render('login', { user: req.session.userId }));
app.post('/login', (req, res) => {
    db.get("SELECT * FROM admin WHERE username = ?", [req.body.username], (err, admin) => {
        if (admin && bcrypt.compareSync(req.body.password, admin.password)) {
            req.session.admin = true;
            return req.session.save(() => res.redirect('/admin'));
        }
        db.get("SELECT * FROM users WHERE username = ?", [req.body.username], (err, user) => {
            if (user && bcrypt.compareSync(req.body.password, user.password)) {
                req.session.userId = user.id;
                return req.session.save(() => res.redirect('/'));
            }
            res.send('<script>alert("Invalid");window.location.href="/login";</script>');
        });
    });
});
app.get('/logout', (req, res) => { req.session.destroy(); res.redirect('/'); });

app.get('/admin/login', (req, res) => res.render('admin-login'));
app.post('/admin/login', (req, res) => {
    db.get("SELECT * FROM admin WHERE username = ?", [req.body.username], (err, admin) => {
        if (admin && bcrypt.compareSync(req.body.password, admin.password)) {
            req.session.admin = true;
            return req.session.save(() => res.redirect('/admin'));
        }
        res.send('<script>alert("Invalid");window.location.href="/admin/login";</script>');
    });
});
app.get('/admin/logout', (req, res) => { req.session.admin = false; res.redirect('/'); });
app.get('/admin', requireAdmin, (req, res) => {
    db.all("SELECT * FROM products", (err, products) => {
        db.all("SELECT * FROM orders ORDER BY created_at DESC LIMIT 20", (err, orders) => {
            db.get("SELECT * FROM payment_config LIMIT 1", (err, config) => {
                res.render('admin', { products: products || [], orders: orders || [], config, categories: ['All','Gaming','Electronics','Robux','Clothes','Accessories','Adapters','Home','Garden'] });
            });
        });
    });
});
app.post('/admin/add', requireAdmin, upload.single('image'), (req, res) => {
    const { name, description, price, category, stock } = req.body;
    const img = req.file ? req.file.filename : null;
    db.run("INSERT INTO products (name, description, price, image, category, sales_count, stock, created_at) VALUES (?,?,?,?,?,?,?,datetime('now'))", [name, description, parseFloat(price)||0, img, category||'All', Math.floor(Math.random()*450)+50, parseInt(stock)||100], (err) => {
        res.redirect('/admin');
    });
});
app.get('/admin/delete/:id', requireAdmin, (req, res) => {
    db.run("DELETE FROM products WHERE id = ?", [req.params.id]);
    res.redirect('/admin');
});
app.post('/admin/save-keys', requireAdmin, (req, res) => {
    db.run("INSERT OR REPLACE INTO payment_config (id, paypal_client_id, paypal_secret, paypal_verified) VALUES (1,?,?,1)", [req.body.paypal_client_id, req.body.paypal_secret]);
    res.json({ success: true });
});


app.get('/crypto-checkout/:id', (req, res) => {
    db.get("SELECT * FROM products WHERE id = ?", [req.params.id], (err, p) => {
        if (!p) return res.redirect('/');
        res.render('crypto-checkout', { product: p, user: req.session.userId });
    });
});


app.get('/paypal-checkout/:id', (req, res) => {
    db.get("SELECT * FROM products WHERE id = ?", [req.params.id], (err, p) => {
        if (!p) return res.redirect('/');
        res.render('paypal-checkout', { product: p, user: req.session.userId });
    });
});

app.listen(PORT, '0.0.0.0', () => console.log('Executive Shop ready'));
