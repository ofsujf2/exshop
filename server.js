const express = require('express');
const session = require('express-session');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = process.env.PORT || 3000;

app.set('view engine', 'ejs');
app.use(express.static('public'));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(session({ secret: 'shop-' + uuidv4(), resave: false, saveUninitialized: false }));

const storage = multer.diskStorage({
    destination: 'public/uploads/',
    filename: (req, file, cb) => cb(null, Date.now() + path.extname(file.originalname))
});
const upload = multer({ storage });

['public/uploads', 'public/css', 'views'].forEach(d => {
    if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
});

const db = new sqlite3.Database('shop.db');
db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS admin (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE, password TEXT)`);
    db.run(`CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE, email TEXT UNIQUE, password TEXT, full_name TEXT, profile_pic TEXT, bio TEXT, is_seller INTEGER DEFAULT 0, created_at TEXT)`);
    db.run(`CREATE TABLE IF NOT EXISTS products (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, description TEXT, price REAL, image TEXT, category TEXT DEFAULT 'All', sales_count INTEGER DEFAULT 0, created_at TEXT)`);
    db.run(`CREATE TABLE IF NOT EXISTS orders (id INTEGER PRIMARY KEY AUTOINCREMENT, product_id INTEGER, payment_method TEXT, amount REAL, status TEXT DEFAULT 'pending', customer_name TEXT, customer_email TEXT, created_at TEXT)`);
    db.run(`CREATE TABLE IF NOT EXISTS messages (id INTEGER PRIMARY KEY AUTOINCREMENT, sender_id INTEGER, receiver_id INTEGER, text TEXT, read INTEGER DEFAULT 0, created_at TEXT)`);
});

db.get("SELECT * FROM admin WHERE username = 'admin'", (err, row) => {
    if (!row) {
        db.run("INSERT INTO admin (username, password) VALUES (?, ?)", ['admin', bcrypt.hashSync('executive2026', 10)]);
    }
});

const requireUser = (req, res, next) => req.session.userId ? next() : res.redirect('/login');
const requireAdmin = (req, res, next) => req.session.admin ? next() : res.redirect('/admin/login');

// HOME
app.get('/', (req, res) => {
    const cat = req.query.category || 'All';
    const query = cat === 'All' ? "SELECT * FROM products" : "SELECT * FROM products WHERE category = ?";
    const params = cat === 'All' ? [] : [cat];
    db.all(query, params, (err, products) => {
        db.all("SELECT * FROM products ORDER BY sales_count DESC LIMIT 10", (err, top) => {
            res.render('home', { products: products || [], top_products: top || [], current_category: cat, user: req.session.userId });
        });
    });
});

// PRODUCT
app.get('/product/:id', (req, res) => {
    db.get("SELECT * FROM products WHERE id = ?", [req.params.id], (err, product) => {
        if (!product) return res.redirect('/');
        res.render('product', { product, user: req.session.userId });
    });
});

// CHECKOUT
app.get('/checkout/:id', (req, res) => {
    db.get("SELECT * FROM products WHERE id = ?", [req.params.id], (err, product) => {
        if (!product) return res.redirect('/');
        res.render('checkout', { product, user: req.session.userId });
    });
});

app.post('/checkout/:id', (req, res) => {
    const { name, email, payment_method } = req.body;
    db.get("SELECT * FROM products WHERE id = ?", [req.params.id], (err, product) => {
        if (!product) return res.redirect('/');
        db.run("INSERT INTO orders (product_id, payment_method, amount, customer_name, customer_email, created_at) VALUES (?,?,?,?,?,datetime('now'))",
            [product.id, payment_method || 'paypal', product.price, name, email]);
        db.run("UPDATE products SET sales_count = sales_count + 1 WHERE id = ?", [product.id]);
        res.redirect('/success');
    });
});

// REGISTER
app.get('/register', (req, res) => res.render('register', { user: req.session.userId }));
app.post('/register', (req, res) => {
    const { username, email, password, full_name } = req.body;
    if (!username || !email || !password) return res.send('All fields required');
    const hash = bcrypt.hashSync(password, 10);
    db.run("INSERT INTO users (username, email, password, full_name, created_at) VALUES (?,?,?,?,datetime('now'))",
        [username, email, hash, full_name], function(err) {
            if (err) return res.send('Error: ' + err.message);
            req.session.userId = this.lastID;
            res.redirect('/');
        });
});

// LOGIN
app.get('/login', (req, res) => res.render('login', { user: req.session.userId }));
app.post('/login', (req, res) => {
    const { username, password } = req.body;
    db.get("SELECT * FROM admin WHERE username = ?", [username], (err, admin) => {
        if (admin && bcrypt.compareSync(password, admin.password)) {
            req.session.admin = true;
            return res.redirect('/admin');
        }
        db.get("SELECT * FROM users WHERE username = ?", [username], (err, user) => {
            if (user && bcrypt.compareSync(password, user.password)) {
                req.session.userId = user.id;
                return res.redirect('/');
            }
            res.send('Invalid credentials');
        });
    });
});

app.get('/logout', (req, res) => { req.session.destroy(); res.redirect('/'); });

// PROFILE
app.get('/profile', requireUser, (req, res) => {
    db.get("SELECT * FROM users WHERE id = ?", [req.session.userId], (err, user) => {
        res.render('profile', { user });
    });
});

app.get('/profile/edit', requireUser, (req, res) => {
    db.get("SELECT * FROM users WHERE id = ?", [req.session.userId], (err, user) => {
        res.render('edit-profile', { user });
    });
});

app.post('/profile/edit', requireUser, upload.single('profile_pic'), (req, res) => {
    const { full_name, bio } = req.body;
    const pic = req.file ? req.file.filename : null;
    if (pic) db.run("UPDATE users SET profile_pic = ? WHERE id = ?", [pic, req.session.userId]);
    db.run("UPDATE users SET full_name = ?, bio = ? WHERE id = ?", [full_name, bio, req.session.userId]);
    res.redirect('/profile');
});

// MESSAGES
app.get('/messages', requireUser, (req, res) => {
    res.render('messages', { contacts: [], user: req.session.userId });
});

app.get('/chat/:id', requireUser, (req, res) => {
    db.get("SELECT * FROM users WHERE id = ?", [req.params.id], (err, other) => {
        if (!other) return res.redirect('/messages');
        db.all(`SELECT * FROM messages WHERE (sender_id = ? AND receiver_id = ?) OR (sender_id = ? AND receiver_id = ?) ORDER BY created_at ASC`,
            [req.session.userId, req.params.id, req.params.id, req.session.userId], (err, msgs) => {
            res.render('chat', { messages: msgs || [], other_user: other, userId: req.session.userId });
        });
    });
});

app.post('/chat/:id', requireUser, (req, res) => {
    db.run("INSERT INTO messages (sender_id, receiver_id, text, created_at) VALUES (?,?,?,datetime('now'))",
        [req.session.userId, req.params.id, req.body.message]);
    res.redirect('/chat/' + req.params.id);
});

// SUCCESS / CANCEL
app.get('/success', (req, res) => res.render('success'));
app.get('/cancel', (req, res) => res.render('cancel'));

// ADMIN
app.get('/admin/login', (req, res) => res.render('admin-login'));
app.post('/admin/login', (req, res) => {
    db.get("SELECT * FROM admin WHERE username = ?", [req.body.username], (err, admin) => {
        if (admin && bcrypt.compareSync(req.body.password, admin.password)) {
            req.session.admin = true;
            return res.redirect('/admin');
        }
        res.send('Invalid admin credentials');
    });
});

app.get('/admin', requireAdmin, (req, res) => {
    db.all("SELECT * FROM products", (err, products) => {
        db.all("SELECT * FROM orders ORDER BY created_at DESC LIMIT 20", (err, orders) => {
            res.render('admin', { products: products || [], orders: orders || [] });
        });
    });
});

app.post('/admin/add', requireAdmin, upload.single('image'), (req, res) => {
    const { name, description, price, category } = req.body;
    const img = req.file ? req.file.filename : null;
    db.run("INSERT INTO products (name, description, price, image, category, sales_count, created_at) VALUES (?,?,?,?,?,?,datetime('now'))",
        [name, description, price, img, category || 'All', Math.floor(Math.random() * 450) + 50]);
    res.redirect('/admin');
});

app.get('/admin/delete/:id', requireAdmin, (req, res) => {
    db.run("DELETE FROM products WHERE id = ?", [req.params.id]);
    res.redirect('/admin');
});

app.listen(PORT, () => console.log(`\n✅ Executive Shop: http://localhost:${PORT}\n✅ admin / executive2026\n`));
