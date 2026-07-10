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
    filename: (req, f, cb) => cb(null, Date.now() + path.extname(f.originalname))
});
const upload = multer({ storage });

['public/uploads','public/css'].forEach(d => { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); });

db.serialize(() => {
    db.run("CREATE TABLE IF NOT EXISTS admin (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT, password TEXT)");
    db.run("CREATE TABLE IF NOT EXISTS products (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, description TEXT, price REAL, image TEXT, category TEXT DEFAULT 'All', sales_count INTEGER DEFAULT 0, stock INTEGER DEFAULT 100, created_at TEXT)");
    db.run("CREATE TABLE IF NOT EXISTS orders (id INTEGER PRIMARY KEY AUTOINCREMENT, product_id INTEGER, amount REAL, customer_name TEXT, customer_email TEXT, created_at TEXT)");
    db.run("INSERT OR IGNORE INTO admin (id, username, password) VALUES (1, 'admin', ?)", [bcrypt.hashSync('executive2026', 10)]);
});

const requireAdmin = (req, res, next) => req.session.admin ? next() : res.redirect('/admin/login');

app.get('/', (req, res) => {
    db.all("SELECT * FROM products ORDER BY created_at DESC LIMIT 20", (err, products) => {
        res.render('home', { products: products || [], user: req.session.userId });
    });
});

app.get('/products', (req, res) => {
    db.all("SELECT * FROM products ORDER BY created_at DESC", (err, products) => {
        res.render('products', { products: products || [], user: req.session.userId });
    });
});

app.get('/product/:id', (req, res) => {
    db.get("SELECT * FROM products WHERE id = ?", [req.params.id], (err, p) => {
        if (!p) return res.redirect('/');
        res.render('product', { product: p, user: req.session.userId });
    });
});

app.get('/checkout/:id', (req, res) => {
    db.get("SELECT * FROM products WHERE id = ?", [req.params.id], (err, p) => {
        if (!p) return res.redirect('/');
        res.render('checkout', { product: p, user: req.session.userId });
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
app.get('/crypto-checkout/:id', (req, res) => {
    db.get("SELECT * FROM products WHERE id = ?", [req.params.id], (err, p) => {
        if (!p) return res.redirect('/');
        res.render('crypto-checkout', { product: p });
    });
});

app.get('/login', (req, res) => res.render('login'));
app.post('/login', (req, res) => {
    db.get("SELECT * FROM admin WHERE username = ?", [req.body.username], (err, admin) => {
        if (admin && bcrypt.compareSync(req.body.password, admin.password)) {
            req.session.admin = true;
            return req.session.save(() => res.redirect('/admin'));
        }
        res.send('<script>alert("Invalid");window.location.href="/login";</script>');
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
app.get('/admin', requireAdmin, (req, res) => {
    db.all("SELECT * FROM products", (err, products) => {
        res.render('admin', { products: products || [] });
    });
});
app.post('/admin/add', requireAdmin, upload.single('image'), (req, res) => {
    const { name, description, price, category, stock } = req.body;
    const img = req.file ? req.file.filename : (req.body.image_url || null);
    db.run("INSERT INTO products (name, description, price, image, category, sales_count, stock, created_at) VALUES (?,?,?,?,?,?,?,datetime('now'))", [name, description, parseFloat(price)||0, img, category||'All', Math.floor(Math.random()*450)+50, parseInt(stock)||100]);
    res.redirect('/admin');
});
app.get('/admin/delete/:id', requireAdmin, (req, res) => {
    db.run("DELETE FROM products WHERE id = ?", [req.params.id]);
    res.redirect('/admin');
});

app.listen(PORT, '0.0.0.0', () => console.log('Shop online'));
