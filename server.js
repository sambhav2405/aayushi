require('dotenv').config(); 
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');

const app = express();
app.use(express.json());
app.use(cors());
app.use(express.static('public'));

// --- CONFIGURATION ---
const MONGO_URI = process.env.MONGO_URI || "mongodb+srv://jainsambhav877_db_user:rtY9YGPgMQyyqYEn@canteen.95x83al.mongodb.net/?retryWrites=true&w=majority&appName=canteen";
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "8500126121:AAEUL_YjXTq20kN7m8k9VYL7EjAQ-Xn3bDE";
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || "-5154056582";
const ADMIN_PASS = process.env.ADMIN_PASS || "12345"; 

if (!MONGO_URI) console.warn("⚠️ WARNING: MONGO_URI is missing");

mongoose.connect(MONGO_URI).then(() => {
    console.log("✅ Database Connected");
    initAdmin(); 
    cleanUpTrash(); 
    initCoupons(); // 🔥 Creates default coupons
}).catch(err => console.error("❌ DB Error:", err));

// --- SCHEMAS ---
const orderSchema = new mongoose.Schema({
    orderId: String, name: String, phone: String, items: Array,
    total: Number, finalTotal: Number, pickupTime: String, 
    paymentMode: String, // 🔥 COD or Online
    coupon: String, // 🔥 Applied Coupon Code
    discount: Number, // 🔥 Discount Amount
    location: { type: String, default: '' },
    status: { type: String, default: 'Pending' }, timestamp: { type: Date, default: Date.now }
});
const Order = mongoose.model('Order', orderSchema);

const itemSchema = new mongoose.Schema({
    name: { type: String, required: true },
    price: { type: Number, required: true },
    category: { type: String, required: true },
    image: { type: String, default: 'https://cdn-icons-png.flaticon.com/512/754/754857.png' },
    isAvailable: { type: Boolean, default: true },
    stock: { type: Number, default: 50 } 
});
const Item = mongoose.model('Item', itemSchema);

const couponSchema = new mongoose.Schema({
    code: String, type: String, value: Number, minOrder: Number
});
const Coupon = mongoose.model('Coupon', couponSchema);

const revenueSchema = new mongoose.Schema({ date: String, amount: Number });
const Revenue = mongoose.model('Revenue', revenueSchema);
const adminSchema = new mongoose.Schema({ username: String, pass: String });
const Admin = mongoose.model('Admin', adminSchema);
const settingSchema = new mongoose.Schema({ id: String, isOpen: Boolean, announcement: String });
const Setting = mongoose.model('Setting', settingSchema);

// --- UTILS ---
async function initAdmin() {
    const exists = await Admin.findOne();
    if (!exists) await new Admin({ username: "admin", pass: ADMIN_PASS }).save();
}

async function initCoupons() {
    // 🔥 Create Default Coupons if not exist
    const count = await Coupon.countDocuments();
    if(count === 0) {
        await new Coupon({ code: "WELCOME50", type: "flat", value: 50, minOrder: 150 }).save();
        await new Coupon({ code: "FOODIE10", type: "percent", value: 10, minOrder: 100 }).save();
        console.log("🎟️ Default Coupons Created: WELCOME50 & FOODIE10");
    }
}

async function cleanUpTrash() {
    try { await Item.deleteMany({ $or: [{ name: { $exists: false } }, { name: "undefined" }] }); } catch (e) {}
}

async function updateDailyRevenue(amount) {
    const today = new Date().toLocaleDateString('en-CA'); 
    await Revenue.updateOne({ date: today }, { $inc: { amount: amount } }, { upsert: true });
}

// 🔥 Telegram Alert with Payment Mode & Discount
async function sendTelegramAlert(order) {
    const itemsList = order.items.map(i => `- ${i.qty} x ${i.name}`).join('\n');
    const locLine = order.location ? `\n📍 <a href="${order.location}"><b>View on Map</b></a>` : '\n📍 No Location';
    
    // Payment Status Logic
    const payStatus = order.paymentMode === 'Online' ? '🟢 PAID ONLINE' : '🔴 CASH ON DELIVERY';
    const discountLine = order.discount > 0 ? `\n🏷️ Coupon: ${order.coupon} (-₹${order.discount})` : '';

    const receiptMsg = `🧾 <b>ORDER #${order.orderId}</b>\n👤 ${order.name} (${order.phone})${locLine}\n\n<b>${payStatus}</b>\n💰 Total: ₹${order.finalTotal} ${discountLine}\n\n🛒 <b>ITEMS:</b>\n${itemsList}`;
    
    const itemsSpeech = order.items.map(i => `${i.qty} ${i.name.replace('(📦 PACKED)', '')}`).join(', ');
    const voiceMsg = `🔔 <b>NEW ORDER</b>\n${order.name}\n${itemsSpeech}`;

    try {
        await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text: receiptMsg, parse_mode: 'HTML', disable_notification: true }) });
        await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text: voiceMsg, parse_mode: 'HTML' }) });
    } catch (e) { console.error("Telegram Error:", e.message); }
}

// --- API ROUTES ---

app.get('/api/menu', async (req, res) => res.json(await Item.find()));

// 🔥 Verify Coupon API
app.post('/api/verify-coupon', async (req, res) => {
    try {
        const { code, total } = req.body;
        const coupon = await Coupon.findOne({ code: code.toUpperCase() });

        if (!coupon) return res.json({ success: false, message: "Invalid Coupon Code" });
        if (total < coupon.minOrder) return res.json({ success: false, message: `Min order ₹${coupon.minOrder} required!` });

        let discount = 0;
        if (coupon.type === 'flat') discount = coupon.value;
        else if (coupon.type === 'percent') discount = Math.floor((total * coupon.value) / 100);

        // Max discount cap check (Optional, abhi ke liye rehne dete hain)
        res.json({ success: true, discount, newTotal: total - discount, code: coupon.code });
    } catch (e) { res.json({ success: false, message: "Server Error" }); }
});

app.post('/api/order', async (req, res) => {
    try {
        const { items } = req.body;

        // Stock Check
        for (const item of items) {
            const dbItem = await Item.findById(item.id); 
            if (!dbItem) continue; 
            if (dbItem.stock < item.qty) return res.json({ success: false, message: `Oops! ${dbItem.name} bas ${dbItem.stock} bache hain.` });
        }

        // Reduce Stock
        for (const item of items) {
            await Item.findByIdAndUpdate(item.id, { $inc: { stock: -item.qty } });
        }

        const uniqueCode = Math.floor(100000 + Math.random() * 900000).toString();
        const newOrder = new Order({ orderId: uniqueCode, ...req.body });
        await newOrder.save();
        
        sendTelegramAlert(newOrder); 
        updateDailyRevenue(newOrder.finalTotal);
        
        res.json({ success: true, orderId: uniqueCode });
    } catch (e) { console.error("Order Error:", e); res.json({ success: false, message: "Server Error" }); }
});

app.get('/api/orders', async (req, res) => {
    const yesterday = new Date(new Date().getTime() - 24 * 60 * 60 * 1000);
    res.json(await Order.find({ timestamp: { $gte: yesterday } }).sort({ timestamp: -1 }));
});

// Admin Routes
app.post('/api/admin/login', async (req, res) => {
    const admin = await Admin.findOne({ username: req.body.user });
    if ((admin && admin.pass === req.body.pass) || req.body.pass === ADMIN_PASS) res.json({ success: true });
    else res.json({ success: false });
});

app.post('/api/admin/add-item', async (req, res) => { 
    try { await new Item(req.body).save(); res.json({ success: true }); } catch(e) { res.json({ success: false }); }
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
