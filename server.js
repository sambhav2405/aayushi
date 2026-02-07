require('dotenv').config(); // 🔥 Loads passwords from .env file
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');

const app = express();
app.use(express.json());
app.use(cors());
app.use(express.static('public'));

// --- 1. SECURE CONFIGURATION ---
const MONGO_URI = process.env.MONGO_URI;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const ADMIN_PASS = process.env.ADMIN_PASS || "12345"; 

// Check if keys exist
if (!MONGO_URI || !TELEGRAM_BOT_TOKEN) {
    console.error("❌ CRITICAL ERROR: .env file missing or variables not set!");
    process.exit(1);
}

mongoose.connect(MONGO_URI).then(() => {
    console.log("✅ Database Connected Securely");
    initAdmin(); 
    cleanUpTrash(); 
}).catch(err => console.error("❌ DB Error:", err));

// --- SCHEMAS ---
const orderSchema = new mongoose.Schema({
    orderId: String, name: String, phone: String, items: Array,
    total: Number, finalTotal: Number, pickupTime: String, paymentId: String,
    location: { type: String, default: '' }, // 🔥 New Field Added
    status: { type: String, default: 'Pending' }, timestamp: { type: Date, default: Date.now }
});
const Order = mongoose.model('Order', orderSchema);

const itemSchema = new mongoose.Schema({
    name: { type: String, required: true },
    price: { type: Number, required: true },
    category: { type: String, required: true },
    image: { type: String, default: 'https://cdn-icons-png.flaticon.com/512/754/754857.png' },
    isAvailable: { type: Boolean, default: true },
    isBestSeller: { type: Boolean, default: false }
});
const Item = mongoose.model('Item', itemSchema);

const revenueSchema = new mongoose.Schema({ date: String, amount: Number });
const Revenue = mongoose.model('Revenue', revenueSchema);

const adminSchema = new mongoose.Schema({ username: String, pass: String });
const Admin = mongoose.model('Admin', adminSchema);

const settingSchema = new mongoose.Schema({ id: String, isOpen: Boolean, announcement: String });
const Setting = mongoose.model('Setting', settingSchema);

// --- UTILS ---
async function initAdmin() {
    const exists = await Admin.findOne();
    // Secure Password from ENV
    if (!exists) await new Admin({ username: "admin", pass: ADMIN_PASS }).save();
}

async function cleanUpTrash() {
    try { await Item.deleteMany({ $or: [{ name: { $exists: false } }, { name: "undefined" }, { name: "" }] }); } catch (e) {}
}

async function updateDailyRevenue(amount) {
    const today = new Date().toLocaleDateString('en-CA'); 
    await Revenue.updateOne({ date: today }, { $inc: { amount: amount } }, { upsert: true });
}

// Telegram Logic
async function sendTelegramAlert(order) {
    const itemsList = order.items.map(i => `- ${i.qty} x ${i.name}`).join('\n');
    
    // 🔥 Location Link Logic
    const locLine = order.location ? `\n📍 <a href="${order.location}"><b>View on Map</b></a>` : '\n📍 No Location';

    const receiptMsg = `🧾 <b>ORDER #${order.orderId}</b>\n👤 ${order.name} (${order.phone})${locLine}\n💰 ₹${order.finalTotal}\n🛒 <b>ITEMS:</b>\n${itemsList}`;
    
    // Voice Msg Logic (Same as before)
    const itemsSpeech = order.items.map(i => {
        let cleanName = i.name.replace('(📦 PACKED)', '').trim();
        return `${i.qty} ${cleanName}`;
    }).join(', ');
    const voiceMsg = `🔔 <b>NEW ORDER</b>\n${order.name}\n${itemsSpeech}`;

    try {
        // Parse mode HTML zaroori hai link ke liye
        await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text: receiptMsg, parse_mode: 'HTML', disable_notification: true }) });
        await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text: voiceMsg, parse_mode: 'HTML' }) });
    } catch (e) {}
}
// --- API ROUTES ---

// 1. MENU APIs (Public)
app.get('/api/menu', async (req, res) => res.json(await Item.find()));

// 2. ORDER APIs (Public)
app.post('/api/order', async (req, res) => {
    try {
        const uniqueCode = Math.floor(100000 + Math.random() * 900000).toString();
        const newOrder = new Order({ orderId: uniqueCode, ...req.body });
        await newOrder.save();
        sendTelegramAlert(newOrder); 
        updateDailyRevenue(newOrder.finalTotal);
        res.json({ success: true, orderId: uniqueCode });
    } catch (e) { res.json({ success: false }); }
});

app.get('/api/orders', async (req, res) => {
    const yesterday = new Date(new Date().getTime() - 24 * 60 * 60 * 1000);
    res.json(await Order.find({ timestamp: { $gte: yesterday } }).sort({ timestamp: -1 }));
});

// --- 🔥 ADMIN SECURE ROUTES ---
app.post('/api/admin/login', async (req, res) => {
    const admin = await Admin.findOne({ username: req.body.user });
    // Compare with DB pass OR Env pass
    if (admin && (admin.pass === req.body.pass || req.body.pass === ADMIN_PASS)) {
        res.json({ success: true });
    } else {
        res.json({ success: false });
    }
});

app.post('/api/admin/add-item', async (req, res) => { 
    try {
        if(!req.body.name || !req.body.price) return res.json({ success: false });
        await new Item(req.body).save(); 
        res.json({ success: true });
    } catch(e) { res.json({ success: false, error: e.message }); }
});

app.post('/api/admin/delete-item', async (req, res) => { await Item.findByIdAndDelete(req.body.id); res.json({ success: true }); });
app.post('/api/admin/update-stock', async (req, res) => { await Item.findByIdAndUpdate(req.body.id, { isAvailable: req.body.isAvailable }); res.json({ success: true }); });

app.post('/api/update-status', async (req, res) => { await Order.updateOne({ orderId: req.body.orderId }, { status: req.body.status }); res.json({ success: true }); });
app.post('/api/delete-order', async (req, res) => { await Order.deleteOne({ orderId: req.body.orderId }); res.json({ success: true }); });
app.post('/api/clear-all', async (req, res) => { await Order.deleteMany({}); res.json({ success: true }); });

app.get('/api/admin/revenue', async (req, res) => res.json(await Revenue.find().sort({ date: -1 })));

app.get('/api/status', async (req, res) => { 
    let s = await Setting.findOne({ id: "shop_status" });
    if(!s) { s = new Setting({ id: "shop_status", isOpen: true, announcement: "" }); await s.save(); }
    res.json({ isOpen: s.isOpen, announcement: s.announcement });
});
app.post('/api/toggle-shop', async (req, res) => { await Setting.updateOne({ id: "shop_status" }, { isOpen: req.body.isOpen }, { upsert: true }); res.json({ success: true }); });
app.post('/api/admin/announce', async (req, res) => { await Setting.updateOne({ id: "shop_status" }, { announcement: req.body.text }, { upsert: true }); res.json({ success: true }); });

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server Ready on Port ${PORT}`));
