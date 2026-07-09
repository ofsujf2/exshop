const express = require('express');
const session = require('express-session');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const https = require('https');

const app = express();
const PORT = process.env.PORT || 3000;

const db = new sqlite3.Database('shop.db');

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

db.serialize(() => {
    db.run("CREATE TABLE IF NOT EXISTS admin (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE, password TEXT)");
    db.run("CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE, email TEXT UNIQUE, password TEXT, full_name TEXT, profile_pic TEXT, bio TEXT, created_at TEXT)");
    db.run("CREATE TABLE IF NOT EXISTS products (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, description TEXT, price REAL, image TEXT, category TEXT DEFAULT 'All', sales_count INTEGER DEFAULT 0, stock INTEGER DEFAULT 100, created_at TEXT)");
    db.run("CREATE TABLE IF NOT EXISTS orders (id INTEGER PRIMARY KEY AUTOINCREMENT, product_id INTEGER, payment_method TEXT, amount REAL, status TEXT DEFAULT 'completed', customer_name TEXT, customer_email TEXT, created_at TEXT)");
    db.run("CREATE TABLE IF NOT EXISTS messages (id INTEGER PRIMARY KEY AUTOINCREMENT, sender_id INTEGER, receiver_id INTEGER, text TEXT, read INTEGER DEFAULT 0, created_at TEXT)");
    db.run("CREATE TABLE IF NOT EXISTS payment_config (id INTEGER PRIMARY KEY AUTOINCREMENT, paypal_client_id TEXT, paypal_secret TEXT, paypal_verified INTEGER DEFAULT 0)");
});

db.get("SELECT * FROM admin WHERE username = 'admin'", (err, row) => {
    if (!row) db.run("INSERT INTO admin (username, password) VALUES (?, ?)", ['admin', bcrypt.hashSync('executive2026', 10)]);
});

const requireUser = (req, res, next) => req.session.userId ? next() : res.redirect('/login');
const requireAdmin = (req, res, next) => req.session.admin ? next() : res.redirect('/admin/login');

function getPayPalToken(clientId, secret) {
    return new Promise((resolve, reject) => {
        const auth = Buffer.from(clientId + ':' + secret).toString('base64');
        https.request({
            hostname: 'api-m.paypal.com', path: '/v1/oauth2/token', method: 'POST',
            headers: { 'Authorization': 'Basic ' + auth, 'Content-Type': 'application/x-www-form-urlencoded' }
        }, (res) => { let d=''; res.on('data',c=>d+=c); res.on('end',()=>{try{resolve(JSON.parse(d))}catch(e){reject(e)}}); }).on('error', reject).write('grant_type=client_credentials').end();
    });
}

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

app.get('/product/:id', (req, res) => {
    db.get("SELECT * FROM products WHERE id = ?", [req.params.id], (err, product) => {
        if (!product) return res.redirect('/');
        db.get("SELECT * FROM payment_config LIMIT 1", (err, config) => {
            res.render('product', { product, user: req.session.userId, config });
        });
    });
});

app.get('/checkout/:id', (req, res) => {
    db.get("SELECT * FROM products WHERE id = ?", [req.params.id], (err, product) => {
        if (!product) return res.redirect('/');
        res.render('checkout', { product, user: req.session.userId, wallets: CRYPTO_WALLETS });
    });
});

app.post('/checkout/:id', (req, res) => {
    db.get("SELECT * FROM products WHERE id = ?", [req.params.id], (err, product) => {
        if (!product) return res.redirect('/');
        db.run("INSERT INTO orders (product_id, payment_method, amount, customer_name, customer_email, created_at) VALUES (?,?,?,?,?,datetime('now'))",
            [product.id, req.body.payment_method || 'paypal', product.price, req.body.name || 'N/A', req.body.email || 'N/A']);
        db.run("UPDATE products SET sales_count = sales_count + 1 WHERE id = ?", [product.id]);
        res.redirect('/success');
    });
});

app.get('/success', (req, res) => res.render('success'));
app.get('/cancel', (req, res) => res.render('cancel'));
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
    const { username, password } = req.body;
    db.get("SELECT * FROM admin WHERE username = ?", [username], (err, admin) => {
        if (admin && bcrypt.compareSync(password, admin.password)) {
            req.session.admin = true;
            req.session.save(() => res.redirect('/admin'));
            return;
        }
        db.get("SELECT * FROM users WHERE username = ?", [username], (err, user) => {
            if (user && bcrypt.compareSync(password, user.password)) {
                req.session.userId = user.id;
                req.session.save(() => res.redirect('/'));
            } else {
                res.send('<script>alert("Invalid credentials");window.location.href="/login";</script>');
            }
        });
    });
});
app.get('/logout', (req, res) => { req.session.destroy(); res.redirect('/'); });
app.get('/profile', requireUser, (req, res) => {
    db.get("SELECT * FROM users WHERE id = ?", [req.session.userId], (err, user) => res.render('profile', { user }));
});
app.get('/profile/edit', requireUser, (req, res) => {
    db.get("SELECT * FROM users WHERE id = ?", [req.session.userId], (err, user) => res.render('edit-profile', { user }));
});
app.post('/profile/edit', requireUser, upload.single('profile_pic'), (req, res) => {
    const { full_name, bio } = req.body;
    const pic = req.file ? req.file.filename : null;
    if (pic) db.run("UPDATE users SET profile_pic = ? WHERE id = ?", [pic, req.session.userId]);
    db.run("UPDATE users SET full_name = ?, bio = ? WHERE id = ?", [full_name || '', bio || '', req.session.userId]);
    res.redirect('/profile');
});
app.get('/messages', requireUser, (req, res) => res.render('messages', { contacts: [], user: req.session.userId }));
app.get('/chat/:id', requireUser, (req, res) => {
    db.get("SELECT * FROM users WHERE id = ?", [req.params.id], (err, other) => {
        if (!other) return res.redirect('/messages');
        db.all("SELECT * FROM messages WHERE (sender_id=? AND receiver_id=?) OR (sender_id=? AND receiver_id=?) ORDER BY created_at ASC",
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

app.get('/admin/login', (req, res) => res.render('admin-login'));
app.post('/admin/login', (req, res) => {
    db.get("SELECT * FROM admin WHERE username = ?", [req.body.username], (err, admin) => {
        if (admin && bcrypt.compareSync(req.body.password, admin.password)) {
            req.session.admin = true;
            req.session.save(() => res.redirect('/admin'));
        } else {
            res.send('<script>alert("Invalid");window.location.href="/admin/login";</script>');
        }
    });
});
app.get('/admin', requireAdmin, (req, res) => {
    db.all("SELECT * FROM products", (err, products) => {
        db.all("SELECT * FROM orders ORDER BY created_at DESC LIMIT 20", (err, orders) => {
            db.get("SELECT * FROM payment_config LIMIT 1", (err, config) => {
                res.render('admin', { products: products || [], orders: orders || [], config });
            });
        });
    });
});
app.post('/admin/add', requireAdmin, upload.single('image'), (req, res) => {
    const { name, description, price, category, stock } = req.body;
    const img = req.file ? req.file.filename : null;
    db.run("INSERT INTO products (name, description, price, image, category, sales_count, stock, created_at) VALUES (?,?,?,?,?,?,?,datetime('now'))",
        [name, description, parseFloat(price), img, category || 'All', Math.floor(Math.random()*450)+50, parseInt(stock)||100], (err) => {
            res.redirect('/admin');
        });
});
app.get('/admin/delete/:id', requireAdmin, (req, res) => {
    db.run("DELETE FROM products WHERE id = ?", [req.params.id]);
    res.redirect('/admin');
});
app.post('/admin/save-keys', requireAdmin, async (req, res) => {
    const { paypal_client_id, paypal_secret } = req.body;
    let verified = 0;
    try { const t = await getPayPalToken(paypal_client_id, paypal_secret); verified = t.access_token ? 1 : 0; } catch(e) {}
    db.get("SELECT * FROM payment_config LIMIT 1", (err, row) => {
        if (row) db.run("UPDATE payment_config SET paypal_client_id=?, paypal_secret=?, paypal_verified=? WHERE id=?", [paypal_client_id, paypal_secret, verified, row.id]);
        else db.run("INSERT INTO payment_config (paypal_client_id, paypal_secret, paypal_verified) VALUES (?,?,?)", [paypal_client_id, paypal_secret, verified]);
        res.json({ success: true, message: verified ? 'Verified' : 'Not verified' });
    });
});

app.listen(PORT, '0.0.0.0', () => console.log('Executive Shop ready'));
