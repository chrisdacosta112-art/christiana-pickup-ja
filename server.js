const express = require('express');
const path = require('path');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const twilio = require('twilio');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'CHANGE_ME_IN_PRODUCTION';
const DRIVER_ADMIN_PHONE = process.env.DRIVER_ADMIN_PHONE || '8763750403';
const DRIVER_ADMIN_WHATSAPP = process.env.DRIVER_ADMIN_WHATSAPP || 'whatsapp:+18763750403';
const db = new Database(process.env.DB_FILE || 'bookings.db');

db.pragma('journal_mode = WAL');
db.exec(`
CREATE TABLE IF NOT EXISTS drivers (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 name TEXT NOT NULL,
 email TEXT NOT NULL UNIQUE,
 password_hash TEXT NOT NULL,
 phone TEXT DEFAULT '',
 active INTEGER NOT NULL DEFAULT 1,
 created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS bookings (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 created_at TEXT NOT NULL DEFAULT (datetime('now')),
 name TEXT NOT NULL, phone TEXT NOT NULL, pickup TEXT NOT NULL, destination TEXT NOT NULL,
 service TEXT NOT NULL, passengers TEXT NOT NULL, ride_date TEXT NOT NULL, ride_time TEXT NOT NULL,
 notes TEXT DEFAULT '', price TEXT DEFAULT 'Quote on booking', status TEXT NOT NULL DEFAULT 'NEW',
 assigned_driver_id INTEGER, accepted_at TEXT, completed_at TEXT
);
`);

if (!db.prepare('SELECT 1 FROM drivers LIMIT 1').get()) {
 const email = process.env.DEFAULT_DRIVER_EMAIL || 'driver@christianapickupja.com';
 const password = process.env.DEFAULT_DRIVER_PASSWORD || 'ChangeMe123!';
 db.prepare('INSERT INTO drivers (name,email,password_hash,phone) VALUES (?,?,?,?)')
   .run(process.env.DEFAULT_DRIVER_NAME || 'Main Driver', email, bcrypt.hashSync(password, 12), DRIVER_ADMIN_PHONE);
 console.log(`Created default driver: ${email}`);
}

const twilioReady = process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_PHONE_NUMBER;
const tw = twilioReady ? twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN) : null;
async function notify(to, body, whatsapp=false) {
 if (!tw) return {sent:false, reason:'Twilio not configured'};
 try {
   const from = whatsapp ? (process.env.TWILIO_WHATSAPP_FROM || 'whatsapp:+14155238886') : process.env.TWILIO_PHONE_NUMBER;
   const dest = whatsapp ? (String(to).startsWith('whatsapp:') ? to : `whatsapp:${to}`) : to;
   await tw.messages.create({from, to:dest, body});
   return {sent:true};
 } catch (e) { console.error('Notification failed:', e.message); return {sent:false, reason:e.message}; }
}

app.use(express.json());
app.use(express.static(path.join(__dirname,'public')));

function auth(req,res,next){
 const token=(req.headers.authorization||'').replace(/^Bearer\s+/,'') || req.cookies?.cpja;
 try { req.driver=jwt.verify(token,JWT_SECRET); next(); } catch { return res.status(401).json({error:'Login required'}); }
}

app.post('/api/login',(req,res)=>{
 const {email,password}=req.body||{};
 const d=db.prepare('SELECT * FROM drivers WHERE email=? AND active=1').get(String(email||'').trim().toLowerCase());
 if(!d || !bcrypt.compareSync(String(password||''),d.password_hash)) return res.status(401).json({error:'Invalid email or password'});
 const token=jwt.sign({id:d.id,name:d.name,email:d.email},JWT_SECRET,{expiresIn:'7d'});
 res.json({ok:true,token,driver:{id:d.id,name:d.name,email:d.email,phone:d.phone}});
});

app.get('/api/me',auth,(req,res)=>res.json({driver:req.driver}));

app.get('/api/bookings',auth,(req,res)=>{
 const status=req.query.status||'all';
 const rows=status==='all' ? db.prepare(`SELECT b.*,d.name driver_name FROM bookings b LEFT JOIN drivers d ON d.id=b.assigned_driver_id ORDER BY b.id DESC`).all()
   : db.prepare(`SELECT b.*,d.name driver_name FROM bookings b LEFT JOIN drivers d ON d.id=b.assigned_driver_id WHERE b.status=? ORDER BY b.id DESC`).all(status);
 res.json(rows);
});

app.post('/api/bookings',async(req,res)=>{
 const b=req.body||{};
 const required=['name','phone','pickup','destination','service','passengers','ride_date','ride_time'];
 for(const f of required) if(!String(b[f]??'').trim()) return res.status(400).json({error:`Missing ${f}`});
 const info=db.prepare(`INSERT INTO bookings (name,phone,pickup,destination,service,passengers,ride_date,ride_time,notes,price) VALUES (?,?,?,?,?,?,?,?,?,?)`)
   .run(String(b.name).trim(),String(b.phone).trim(),String(b.pickup).trim(),String(b.destination).trim(),String(b.service).trim(),String(b.passengers).trim(),String(b.ride_date).trim(),String(b.ride_time).trim(),String(b.notes||'').trim(),String(b.price||'Quote on booking').trim());
 const message=`NEW CHRISTIANA PICK UP JA BOOKING #${info.lastInsertRowid}\n${b.name}\n${b.pickup} → ${b.destination}\n${b.ride_date} ${b.ride_time}\n${b.service}, ${b.passengers} passenger(s)\nPhone: ${b.phone}`;
 await notify(DRIVER_ADMIN_PHONE,message,false);
 if(process.env.NOTIFY_DRIVER_WHATSAPP==='true') await notify(DRIVER_ADMIN_WHATSAPP,message,true);
 res.status(201).json({ok:true,id:info.lastInsertRowid});
});

app.patch('/api/bookings/:id',auth,async(req,res)=>{
 const allowed=new Set(['NEW','ACCEPTED','EN_ROUTE','ARRIVED','COMPLETED','CANCELLED']);
 const status=String(req.body?.status||'');
 if(!allowed.has(status)) return res.status(400).json({error:'Invalid status'});
 const b=db.prepare('SELECT * FROM bookings WHERE id=?').get(req.params.id);
 if(!b) return res.status(404).json({error:'Booking not found'});
 const price=req.body?.price!==undefined ? String(req.body.price) : b.price;
 const now=new Date().toISOString();
 db.prepare(`UPDATE bookings SET status=?,price=?,assigned_driver_id=?,accepted_at=CASE WHEN ?='ACCEPTED' AND accepted_at IS NULL THEN ? ELSE accepted_at END,completed_at=CASE WHEN ?='COMPLETED' THEN ? ELSE completed_at END WHERE id=?`)
  .run(status,price,req.driver.id,status,now,status,now,req.params.id);
 if(status==='ACCEPTED') await notify(b.phone,`Christiana Pick Up JA: Your booking #${b.id} has been accepted. ${b.pickup} → ${b.destination}. Fare: ${price}.`,false);
 res.json({ok:true});
});

app.delete('/api/bookings/:id',auth,(req,res)=>{db.prepare('DELETE FROM bookings WHERE id=?').run(req.params.id);res.json({ok:true});});
app.get('/api/health',(_,res)=>res.json({ok:true,twilio:!!tw}));
app.listen(PORT,'0.0.0.0',()=>console.log(`Christiana Pick Up JA running on ${PORT}`));
