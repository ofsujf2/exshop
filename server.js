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
app.use(session({ secret: 'shop-secret', resave: false, saveUninitialized: false }));

const storage = multer.diskStorage({
    destination: 'public/uploads/',
    filename: (req, file, cb) => cb(null, Date.now() + path.extname(file.originalname))
});
const upload = multer({ storage });
const uploadMulti = multer({ storage }).array('images', 10);

['public/uploads','public/css'].forEach(d => { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); });

db.serialize(() => {
    db.run("CREATE TABLE IF NOT EXISTS admin (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT, password TEXT)");
    db.run("CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT, email TEXT, password TEXT, full_name TEXT, created_at TEXT)");
    db.run("CREATE TABLE IF NOT EXISTS products (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, description TEXT, price REAL, image TEXT, category TEXT DEFAULT 'All', sales_count INTEGER DEFAULT 0, stock INTEGER DEFAULT 100, created_at TEXT)");
    db.run("CREATE TABLE IF NOT EXISTS orders (id INTEGER PRIMARY KEY AUTOINCREMENT, product_id INTEGER, amount REAL, customer_name TEXT, customer_email TEXT, created_at TEXT)");
    db.run("ALTER TABLE products ADD COLUMN gallery TEXT DEFAULT '[]'", (err) => {});
    db.run("INSERT OR IGNORE INTO admin (id, username, password) VALUES (1, 'admin', ?)", [bcrypt.hashSync('executive2026', 10)]);
});

const requireAdmin = (req, res, next) => req.session.admin ? next() : res.redirect('/admin/login');

app.get('/', (req, res) => {
    db.all("SELECT * FROM products ORDER BY sales_count DESC LIMIT 20", (err, products) => {
        db.all("SELECT * FROM products ORDER BY sales_count DESC LIMIT 10", (err, top) => {
            res.render('home', { products: products || [], top_products: top || [], user: req.session.userId });
        });
    });
});

app.get('/products', (req, res) => {
    const cat = req.query.category || '';
    const sort = req.query.sort || 'newest';
    let sql = "SELECT * FROM products WHERE 1=1";
    let params = [];
    if (cat) { sql += " AND category = ?"; params.push(cat); }
    switch(sort) {
        case 'price-asc': sql += " ORDER BY price ASC"; break;
        case 'price-desc': sql += " ORDER BY price DESC"; break;
        case 'popular': sql += " ORDER BY sales_count DESC"; break;
        default: sql += " ORDER BY created_at DESC";
    }
    db.all(sql, params, (err, products) => {
        res.render('products', { products: products || [], current_category: cat, current_sort: sort, user: req.session.userId });
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
        db.run("INSERT INTO orders (product_id, amount, customer_name, customer_email, created_at) VALUES (?,?,?,?,datetime('now'))",
            [p.id, p.price, req.body.name || '', req.body.email || '']);
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

app.get('/register', (req, res) => res.render('register', { user: req.session.userId }));
app.post('/register', (req, res) => {
    const { username, email, password, full_name } = req.body;
    if (!username || !email || !password) return res.send('All fields required');
    db.run("INSERT INTO users (username, email, password, full_name, created_at) VALUES (?,?,?,?,datetime('now'))",
        [username, email, bcrypt.hashSync(password, 10), full_name], function(err) {
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
app.get('/admin', requireAdmin, (req, res) => {
    db.all("SELECT * FROM products", (err, products) => {
        res.render('admin', { products: products || [], categories: ['All','Electronics','Gaming','Clothes','Accessories','Home','Garden','Adapters','Robux'] });
    });
});
app.post('/admin/add', requireAdmin, upload.single('image'), (req, res) => {
    const { name, description, price, category, stock, image_url, gallery } = req.body;
    const img = req.file ? req.file.filename : (image_url || null);
    const galleryData = gallery || '[]';
    db.run("INSERT INTO products (name, description, price, image, category, sales_count, stock, gallery, created_at) VALUES (?,?,?,?,?,?,?,?,datetime('now'))",
        [name, description, parseFloat(price)||0, img, category||'All', Math.floor(Math.random()*450)+50, parseInt(stock)||100, galleryData],
        (err) => { res.redirect('/admin'); });
});
app.post('/admin/add-multi', requireAdmin, (req, res) => {
    uploadMulti(req, res, (err) => {
        if (err) return res.send('Upload error');
        const { name, description, price, category, stock } = req.body;
        const mainImg = req.files && req.files.length > 0 ? req.files[0].filename : null;
        const gallery = req.files ? req.files.slice(1).map(f => '/uploads/' + f.filename) : [];
        db.run("INSERT INTO products (name, description, price, image, category, sales_count, stock, gallery, created_at) VALUES (?,?,?,?,?,?,?,?,datetime('now'))",
            [name, description, parseFloat(price)||0, mainImg, category||'All', Math.floor(Math.random()*450)+50, parseInt(stock)||100, JSON.stringify(gallery)],
            (err) => { res.redirect('/admin'); });
    });
});
app.get('/admin/delete/:id', requireAdmin, (req, res) => {
    db.run("DELETE FROM products WHERE id = ?", [req.params.id]);
    res.redirect('/admin');
});

app.listen(PORT, '0.0.0.0', () => console.log('Executive Shop ready'));
