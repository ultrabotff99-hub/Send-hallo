const express = require('express'), http = require('http'), cors = require('cors');
const bcrypt = require('bcryptjs'), jwt = require('jsonwebtoken'), { Server } = require('socket.io');
const mongoose = require('mongoose');

const SECRET = process.env.JWT_SECRET || 'bigchat_secret_key_tonix';
const PORT = process.env.PORT || 3000;

// 🔴 MongoDB URI Here (MongoDB Atlas-ൽ നിന്ന് കിട്ടിയ ലിങ്ക് നൽകുക)
const MONGO_URI = process.env.MONGO_URI || "mongodb+srv://admin:password123@cluster0.xxx.mongodb.net/bigchat?retryWrites=true&w=majority";

const app = express();
app.use(cors());
app.use(express.json({ limit: '12mb' }));
app.use(express.static(__dirname));

const srv = http.createServer(app);
const io = new Server(srv, { cors: { origin: '*' }, maxHttpBufferSize: 15e6 });

// Database Connection
mongoose.connect(MONGO_URI)
  .then(() => console.log('MongoDB Connected Successfully'))
  .catch(err => console.log('MongoDB Memory Fallback Enabled:', err.message));

// Schemas
const userSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  displayName: String,
  passwordHash: String,
  bio: { type: String, default: 'Hey there! I am using BIG CHAT' },
  msgCount: { type: Number, default: 0 }
});
const User = mongoose.model('User', userSchema);

const pub = u => ({ username: u.username, displayName: u.displayName, bio: u.bio, msgCount: u.msgCount });
const uname = s => String(s || '').toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 20);
const sign = u => jwt.sign({ u: u.username }, SECRET, { expiresIn: '30d' });

const auth = async (req, res, next) => {
  try {
    const token = (req.headers.authorization || '').slice(7);
    const decoded = jwt.verify(token, SECRET);
    const u = await User.findOne({ username: decoded.u });
    if (!u) throw 0;
    req.user = u;
    next();
  } catch {
    res.status(401).json({ error: 'Unauthorized' });
  }
};

// Routes
app.get('/', (q, r) => r.sendFile(__dirname + '/index.html'));
app.get('/health', (q, r) => r.json({ ok: true }));

app.post('/api/register', async (req, res) => {
  const { password, displayName } = req.body, username = uname(req.body.username);
  if (username.length < 3 || String(password || '').length < 6) return res.status(400).json({ error: 'Username needs 3+ characters and password 6+' });
  
  const existing = await User.findOne({ username });
  if (existing) return res.status(409).json({ error: 'Username is taken' });

  const hash = await bcrypt.hash(password, 10);
  const u = new User({ username, displayName: String(displayName || username).slice(0, 30), passwordHash: hash });
  await u.save();

  res.json({ token: sign(u), user: pub(u) });
});

app.post('/api/login', async (req, res) => {
  const username = uname(req.body.username);
  const u = await User.findOne({ username });
  if (!u || !(await bcrypt.compare(String(req.body.password || ''), u.passwordHash))) {
    return res.status(401).json({ error: 'Wrong username or password' });
  }
  res.json({ token: sign(u), user: pub(u) });
});

app.get('/api/me', auth, (q, r) => r.json(pub(q.user)));

// Socket handling
const rooms = { general: { name: 'General', history: [] } };

io.use(async (s, next) => {
  try {
    const decoded = jwt.verify(s.handshake.auth.token, SECRET);
    const u = await User.findOne({ username: decoded.u });
    if (u) { s.user = u; return next(); }
    next(new Error('auth'));
  } catch {
    next(new Error('auth'));
  }
});

io.on('connection', s => {
  s.on('join', ({ id } = {}, cb = () => {}) => {
    id = id || 'general';
    s.join(id); s.data.room = id;
    cb({ id, name: 'General', private: false, history: rooms.general.history });
  });

  s.on('message', ({ text } = {}) => {
    const room = s.data.room || 'general';
    const msg = { id: Date.now(), room, username: s.user.username, displayName: s.user.displayName, text, ts: Date.now() };
    rooms.general.history.push(msg);
    io.to(room).emit('message', msg);
  });
});

srv.listen(PORT, () => console.log('BIG CHAT running on port ' + PORT));
                  
