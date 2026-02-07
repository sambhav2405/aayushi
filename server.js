require('dotenv').config(); // 🔥 Loads passwords from .env file
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');

const app = express();
app.use(express.json());
app.use(cors());
app.use(express.static('public'));

// --- 1. SECURE CONFIGURATION ---
// Fallback values agar .env file nahi milti (Local testing ke liye)
const MONGO_URI = process.env.MONGO_URI || "mongodb+srv://jainsambhav877_db_user:rtY9YGPgMQyyqYEn@canteen.95x83al.mongodb.net/?retryWrites=true&w=majority&appName=canteen";
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "8500126121:AAEUL_YjXTq20kN7m8k9VYL7EjAQ-Xn3bDE";
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || "-5154056582";
const ADMIN_PASS = process.env.ADMIN_PASS || "12345"; 

// Check if critical keys exist (Optional: warning only)
if (!MONGO_URI) {
    console.warn("⚠️ WARNING: MONGO_URI is missing in .env");
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
    isBestSeller: { type: Boolean, default: false },
    stock: { type: Number, default: 50 } // 🔥 Stock Added
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
    if (!exists) await new Admin({ username: "admin", pass: ADMIN_PASS }).save();
}

async function cleanUpTrash() {
    try { await Item.deleteMany({ $or: [{ name: { $exists: false } }, { name: "undefined" }, { name: "" }] }); } catch (e) {}
}

async function updateDailyRevenue(amount) {
    const today = new Date().toLocaleDateString('en-CA'); 
    await Revenue.updateOne({ date: today }, { $inc: { amount: amount } }, { upsert: true });
}

// Telegram Logic (Fixed)
async function sendTelegramAlert(order) {
    const itemsList = order.items.map(i => `- ${i.qty} x ${i.name}`).join('\n');
    
    // 🔥 Location Link Logic (Fixed HTML Tag)
    const locLine = order.location ? `\n📍 <a href="${order.location}"><b>View on Map</b></a>` : '\n📍 No Location';

    const receiptMsg = `🧾 <b>ORDER #${order.orderId}</b>\n👤 ${order.name} (${order.phone})${locLine}\n💰 ₹${order.finalTotal}\n🛒 <b>ITEMS:</b>\n${itemsList}`;
    
    // Voice Msg Logic
    const itemsSpeech = order.items.map(i => {
        let cleanName = i.name.replace('(📦 PACKED)', '').trim();
        return `${i.qty} ${cleanName}`;
    }).join(', ');
    const voiceMsg = `🔔 <b>NEW ORDER</b>\n${order.name}\n${itemsSpeech}`;

    try {
        // Parse mode HTML zaroori hai link ke liye
        await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text: receiptMsg, parse_mode: 'HTML', disable_notification: true }) });
        await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text: voiceMsg, parse_mode: 'HTML' }) });
    } catch (e) {
        console.error("Telegram Error:", e.message);
    }
}

// --- API ROUTES ---

// 1. MENU APIs (Public)
app.get('/api/menu', async (req, res) => res.json(await Item.find()));

// 2. ORDER APIs (Public)
// 🔥 Updated Order Logic with Stock Check
app.post('/api/order', async (req, res) => {
    try {
        const { items } = req.body;

        // 1. Check Stock Availability
        for (const item of items) {
            // Find item in DB using ID passed from frontend (ensure frontend sends item.id)
            // If frontend sends id inside item object, access it correctly. 
            // Assuming frontend sends { id: "...", qty: ... } inside items array
            const dbItem = await Item.findById(item.id); 
            
            if (!dbItem) continue; // Skip if item not found (or handle error)

            if (dbItem.stock < item.qty) {
                return res.json({ success: false, message: `Oops! ${dbItem.name} bas ${dbItem.stock} bache hain.` });
            }
        }

        // 2. Reduce Stock
        for (const item of items) {
            await Item.findByIdAndUpdate(item.id, { $inc: { stock: -item.qty } });
        }

        // 3. Place Order
        const uniqueCode = Math.floor(100000 + Math.random() * 900000).toString();
        const newOrder = new Order({ orderId: uniqueCode, ...req.body });
        await newOrder.save();
        
        // Non-blocking calls
        sendTelegramAlert(newOrder); 
        updateDailyRevenue(newOrder.finalTotal);
        
        res.json({ success: true, orderId: uniqueCode });
    } catch (e) { 
        console.error("Order Error:", e);
        res.json({ success: false, message: "Server Error" }); 
    }
});

app.get('/api/orders', async (req, res) => {
    const yesterday = new Date(new Date().getTime() - 24 * 60 * 60 * 1000);
    res.json(await Order.find({ timestamp: { $gte: yesterday } }).sort({ timestamp: -1 }));
});

// --- 🔥 ADMIN SECURE ROUTES ---
app.post('/api/admin/login', async (req, res) => {
    try {
        const admin = await Admin.findOne({ username: req.body.user });
        // Compare with DB pass OR Env pass OR Hardcoded Fallback
        if ((admin && admin.pass === req.body.pass) || req.body.pass === ADMIN_PASS || req.body.pass === "12345") {
            res.json({ success: true });
        } else {
            res.json({ success: false });
        }
    } catch (e) { res.json({ success: false }); }
});

// 🔥 Updated Add Item Logic to include Stock
app.post('/api/admin/add-item', async (req, res) => { 
    try {
        if(!req.body.name || !req.body.price) return res.json({ success: false });
        
        // Stock is now saved from req.body
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
