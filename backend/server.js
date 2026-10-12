// NestRoom backend – Node.js (>=18) + MongoDB (Atlas).
// Auth: scrypt-hashed passwords + HMAC-signed bearer tokens.
const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { MongoClient, ObjectId } = require("mongodb");
const config = require("./config");

const TYPES = ["Single room", "Double sharing", "Triple sharing", "Studio flat", "1 BHK"];
const AMENITIES = ["WiFi", "AC", "Food", "Gym", "Parking", "Laundry", "Power backup", "Attached bath"];
const MAX_IMAGES = 6, MAX_IMAGE_BYTES = 700 * 1024;
const ACTIVE = ["pending", "approved", "leaving"];   // leaving = tenant asked to leave, owner not yet decided

// ---------- password hashing ----------
const hashPw = (pw, salt = crypto.randomBytes(16).toString("hex")) =>
  ({ salt, hash: crypto.scryptSync(pw, salt, 64).toString("hex") });
const checkPw = (pw, salt, hash) => {
  const a = crypto.scryptSync(pw, salt, 64), b = Buffer.from(hash, "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};
const ADMIN = { ...hashPw(config.admin.password), username: config.admin.username };
const DUMMY = hashPw("dummy-password"); // keeps timing similar when the username doesn't exist

// ---------- tokens ----------
function loadSecret() {
  if (config.tokenSecret) return config.tokenSecret;
  // local-development fallback: a generated key kept in data/secret.key
  const f = path.join(__dirname, "data", "secret.key");
  if (!fs.existsSync(f)) fs.writeFileSync(f, crypto.randomBytes(32).toString("hex"), { mode: 0o600 });
  return fs.readFileSync(f, "utf8");
}
const SECRET = loadSecret();
const sig = body => crypto.createHmac("sha256", SECRET).update(body).digest("base64url");
function signToken(payload) {
  const body = Buffer.from(JSON.stringify({ ...payload, exp: Date.now() + config.tokenTtlHours * 3600e3 })).toString("base64url");
  return body + "." + sig(body);
}
function verifyToken(t) {
  const [body, s] = String(t || "").split(".");
  if (!body || !s) return null;
  const good = Buffer.from(sig(body)), got = Buffer.from(s);
  if (good.length !== got.length || !crypto.timingSafeEqual(good, got)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, "base64url").toString());
    return p.exp > Date.now() ? p : null;
  } catch { return null; }
}

// ---------- database ----------
let Users, Rooms, Bookings, Meta, Images;

async function initDb() {
  if (!config.mongoUri) throw new Error("MONGODB_URI is not set. Copy .env.example to .env and add your Atlas connection string.");
  const client = new MongoClient(config.mongoUri, { serverSelectionTimeoutMS: 10000 });
  await client.connect();
  const db = client.db(config.dbName);
  Users = db.collection("users");
  Rooms = db.collection("rooms");
  Bookings = db.collection("bookings");
  Meta = db.collection("meta");
  Images = db.collection("images");   // room photos (base64) stored in the database
  await Users.createIndex({ usernameLower: 1 }, { unique: true });
  await Users.createIndex({ email: 1 }, { unique: true });
  await Rooms.createIndex({ ownerId: 1 });
  await Bookings.createIndex({ ownerId: 1 });
  await Bookings.createIndex({ tenantId: 1 });
  await Bookings.createIndex({ roomId: 1 });
  await Images.createIndex({ roomId: 1 });
  await seedIfFirstRun();
}

// Fills an empty database with the demo data once (tracked by a marker document).
async function seedIfFirstRun() {
  if (await Meta.findOne({ _id: "seeded" })) return;
  if (config.seedDemoData) {
    const seed = JSON.parse(fs.readFileSync(path.join(__dirname, "data", "seed.json"), "utf8"));
    const now = new Date().toISOString();
    const mkOwner = (name, username, email, phone, business) =>
      ({ role: "owner", status: "approved", name, username, usernameLower: username, email, phone, business, createdAt: now, ...hashPw(config.demoOwnerPassword) });
    const owners = { 1001: mkOwner("Meera Shah", "meera", "meera@example.com", "9800000001", "Sunrise PG"),
                     1002: mkOwner("Arjun Rao", "arjun", "arjun@example.com", "9800000002", "Green Nest") };
    const ownerIds = {};
    for (const [key, doc] of Object.entries(owners)) ownerIds[key] = String((await Users.insertOne(doc)).insertedId);
    const roomIds = {};
    for (const r of seed.rooms) {
      const { id, ownerId, ...rest } = r;
      roomIds[id] = String((await Rooms.insertOne({ ...rest, ownerId: ownerIds[ownerId] })).insertedId);
    }
    for (const b of seed.bookings) {
      const { id, roomId, ownerId, ...rest } = b;
      await Bookings.insertOne({ ...rest, roomId: roomIds[roomId], ownerId: ownerIds[ownerId], tenantId: null });
    }
    console.log(`Seeded demo data. Demo owners: meera / arjun, password ${config.demoOwnerPassword}`);
  }
  await Meta.insertOne({ _id: "seeded", at: new Date().toISOString() });
}

// ---------- helpers ----------
class HttpError extends Error { constructor(code, msg) { super(msg); this.code = code; } }

const isId = s => /^[a-f0-9]{24}$/.test(String(s));
const oid = s => { if (!isId(s)) throw new HttpError(404, "Not found"); return new ObjectId(s); };
const now = () => new Date().toISOString();
// database document -> API object (string `id`, no password fields)
const ser = d => { const { _id, salt, hash, usernameLower, ...rest } = d; return { id: String(_id), ...rest }; };
const newestFirst = list => [...list].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
const oldestFirst = list => [...list].sort((a, b) => String(a._id).localeCompare(String(b._id)));

const ADMIN_PUBLIC = { id: "admin", role: "admin", username: config.admin.username, name: config.admin.name };

function send(res, code, data) {
  res.writeHead(code, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": config.corsOrigin,
    "Access-Control-Allow-Methods": "GET,POST,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type,Authorization",
  });
  res.end(data === undefined ? "" : JSON.stringify(data));
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", c => { raw += c; if (raw.length > 8e6) reject(new HttpError(413, "Body too large")); });
    req.on("end", () => {
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); } catch { reject(new HttpError(400, "Invalid JSON")); }
    });
  });
}

// Returns the logged-in principal or throws. Optionally restricts to given roles.
async function requireAuth(req, ...roles) {
  const h = req.headers.authorization || "";
  const p = verifyToken(h.startsWith("Bearer ") ? h.slice(7) : "");
  if (!p) throw new HttpError(401, "Please log in");
  let me;
  if (p.role === "admin") me = ADMIN_PUBLIC;
  else {
    const u = isId(p.sub) ? await Users.findOne({ _id: new ObjectId(p.sub), role: p.role }) : null;
    if (!u) throw new HttpError(401, "Account no longer exists");
    if (u.role === "owner" && u.status !== "approved") throw new HttpError(401, "Your owner account is not approved");
    me = ser(u);
  }
  if (roles.length && !roles.includes(me.role)) throw new HttpError(403, "Not allowed for your role");
  return me;
}

// owner contact details, attached to rooms and bookings so tenants can reach the owner
async function ownerMap(ids) {
  const uniq = [...new Set(ids)].filter(isId);
  if (!uniq.length) return new Map();
  const users = await Users.find({ _id: { $in: uniq.map(i => new ObjectId(i)) } }).toArray();
  return new Map(users.map(u => [String(u._id), u]));
}
const withOwner = (o, map) => {
  const u = map.get(o.ownerId);
  return { ...o, ownerPhone: u ? u.phone : "", ownerBusiness: u ? u.business || "" : "" };
};
async function bookingOut(doc) { return withOwner(ser(doc), await ownerMap([doc.ownerId])); }

// ---- rooms: output shape, city guess for older rooms, photo validation ----
const guessCity = addr => {
  const last = String(addr || "").split(",").pop().trim();
  return /^bengaluru$/i.test(last) ? "Bangalore" : last;
};
const roomOut = (o, map) => ({ ...withOwner(o, map), city: o.city || guessCity(o.addr), amenities: o.amenities || [],
  description: o.description || "", images: o.images || [] });

function parseImage(s) {
  const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(String(s || ""));
  if (!m) throw new HttpError(400, "Photos must be JPG, PNG or WebP images");
  const buf = Buffer.from(m[2], "base64");
  if (buf.length > MAX_IMAGE_BYTES) throw new HttpError(400, "A photo is too large (max 700 KB after resizing)");
  const ok = m[1] === "image/jpeg" ? buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff
    : m[1] === "image/png" ? buf.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]))
    : buf.subarray(0, 4).toString() === "RIFF" && buf.subarray(8, 12).toString() === "WEBP";
  if (!ok) throw new HttpError(400, "One of the files is not a valid image");
  return { contentType: m[1], data: m[2] };
}

async function findRoom(id) {
  const r = await Rooms.findOne({ _id: oid(id) });
  if (!r) throw new HttpError(404, "Room not found");
  return r;
}
async function findBooking(id) {
  const b = await Bookings.findOne({ _id: oid(id) });
  if (!b) throw new HttpError(404, "Booking not found");
  return b;
}
async function ownBooking(me, id) {
  const b = await findBooking(id);
  if (b.tenantId !== me.id) throw new HttpError(403, "That is not your booking");
  return b;
}
async function roomOwnerBooking(me, id) {
  const b = await findBooking(id);
  if (b.ownerId !== me.id) throw new HttpError(403, "That booking is for another owner's room");
  return b;
}
// Atomic status change: only succeeds if the booking is still in the `from` status.
async function move(b, from, set, unset, msg) {
  const upd = { $set: { ...set, updatedAt: now() } };
  if (unset) upd.$unset = unset;
  const r = await Bookings.findOneAndUpdate({ _id: b._id, status: from }, upd, { returnDocument: "after" });
  if (!r) throw new HttpError(409, msg);
  return r;
}
const setRoomStatus = (roomId, status) => Rooms.updateOne({ _id: oid(roomId) }, { $set: { status } });

// simple in-memory login throttle: 10 failed attempts / 15 min per IP
const fails = new Map();
function throttle(ip, failed) {
  const t = Date.now(), list = (fails.get(ip) || []).filter(x => t - x < 15 * 60e3);
  if (failed === undefined && list.length >= 10) throw new HttpError(429, "Too many failed attempts. Try again in a few minutes.");
  if (failed) list.push(t);
  if (failed === false) list.length = 0;
  fails.set(ip, list);
}

// ---------- registration ----------
async function validateRegistration(b, role) {
  const name = String(b.name || "").trim(), username = String(b.username || "").trim();
  const email = String(b.email || "").trim().toLowerCase(), phone = String(b.phone || "").trim();
  const password = String(b.password || ""), business = String(b.business || "").trim();
  if (name.length < 2 || name.length > 60) throw new HttpError(400, "Enter your full name (2–60 characters)");
  if (!/^[A-Za-z0-9_-]{3,30}$/.test(username)) throw new HttpError(400, "Username must be 3–30 letters, numbers, - or _");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, "Enter a valid email address");
  if (!/^[0-9+\-\s]{7,15}$/.test(phone)) throw new HttpError(400, "Enter a valid phone number");
  if (password.length < 8 || password.length > 100 || !/[A-Za-z]/.test(password) || !/\d/.test(password))
    throw new HttpError(400, "Password needs 8+ characters with at least one letter and one number");
  if (business.length > 80) throw new HttpError(400, "Property / business name is too long");
  const lower = username.toLowerCase();
  if (lower === config.admin.username.toLowerCase() || await Users.findOne({ usernameLower: lower }))
    throw new HttpError(409, "That username is already taken");
  if (await Users.findOne({ email })) throw new HttpError(409, "That email is already registered");
  return { name, username, usernameLower: lower, email, phone, password, business: role === "owner" ? business : undefined };
}
function register(role) {
  return async (_req, _m, b) => {
    const { password, business, ...rest } = await validateRegistration(b, role);
    const user = { role, status: role === "owner" ? "pending" : "approved", ...rest, ...(role === "owner" ? { business } : {}),
                   createdAt: now(), ...hashPw(password) };
    try { user._id = (await Users.insertOne(user)).insertedId; }
    catch (e) { if (e.code === 11000) throw new HttpError(409, "That username or email is already registered"); throw e; }
    const u = ser(user);
    if (role === "owner")
      return [201, { pending: true, user: u, message: "Registration received. You can log in once the admin approves your account." }];
    return [201, { token: signToken({ sub: u.id, role }), user: u }];
  };
}

// ---------- routes ----------
// [method, regex, async handler(req, match, body)] – return data, or [status, data]
const ID = "([a-f0-9]{24})";
const routes = [
  // --- auth ---
  ["POST", /^\/api\/auth\/register\/user$/, register("user")],
  ["POST", /^\/api\/auth\/register\/owner$/, register("owner")],

  ["POST", /^\/api\/auth\/login$/, async (req, _m, b) => {
    const ip = req.socket.remoteAddress;
    throttle(ip);
    const username = String(b.username || "").trim(), password = String(b.password || ""), role = b.role;
    if (!["user", "owner", "admin"].includes(role)) throw new HttpError(400, "Choose a role");
    let ok = false, token, user;
    if (role === "admin") {
      const nameOk = username.toLowerCase() === ADMIN.username.toLowerCase();
      const pwOk = checkPw(password, ADMIN.salt, ADMIN.hash);
      if (nameOk && pwOk) { ok = true; user = ADMIN_PUBLIC; token = signToken({ sub: "admin", role: "admin" }); }
    } else {
      const u = await Users.findOne({ usernameLower: username.toLowerCase(), role });
      const pwOk = u ? checkPw(password, u.salt, u.hash) : (checkPw(password, DUMMY.salt, DUMMY.hash), false);
      if (u && pwOk && u.role === "owner" && u.status !== "approved") {
        throttle(ip, false);
        throw new HttpError(403, u.status === "pending"
          ? "Your owner account is waiting for admin approval."
          : "Your owner registration was rejected by the admin.");
      }
      if (u && pwOk) { ok = true; user = ser(u); token = signToken({ sub: user.id, role }); }
    }
    if (!ok) { throttle(ip, true); throw new HttpError(401, "Wrong username, password or role"); }
    throttle(ip, false);
    return { token, user };
  }],

  ["GET", /^\/api\/auth\/me$/, async req => ({ user: await requireAuth(req) })],

  // --- owner approval & removal (admin) ---
  ["GET", /^\/api\/owners$/, async req => {
    await requireAuth(req, "admin");
    const [users, rooms] = await Promise.all([Users.find({ role: "owner" }).toArray(), Rooms.find({}).toArray()]);
    const counts = {};
    for (const r of rooms) counts[r.ownerId] = (counts[r.ownerId] || 0) + 1;
    const order = { pending: 0, approved: 1, rejected: 2 };
    return users.map(u => ({ ...ser(u), roomCount: counts[String(u._id)] || 0 }))
      .sort((a, b) => order[a.status] - order[b.status] || b.createdAt.localeCompare(a.createdAt));
  }],
  ["POST", new RegExp(`^/api/owners/${ID}/(approve|reject)$`), async (req, m) => {
    await requireAuth(req, "admin");
    const u = await Users.findOneAndUpdate({ _id: oid(m[1]), role: "owner" },
      { $set: { status: m[2] === "approve" ? "approved" : "rejected", reviewedAt: now() } }, { returnDocument: "after" });
    if (!u) throw new HttpError(404, "Owner not found");
    return ser(u);
  }],
  // removing an owner deletes their rooms and cancels active bookings on them
  ["DELETE", new RegExp(`^/api/owners/${ID}$`), async (req, m) => {
    await requireAuth(req, "admin");
    const u = await Users.findOne({ _id: oid(m[1]), role: "owner" });
    if (!u) throw new HttpError(404, "Owner not found");
    const id = String(u._id);
    await Bookings.updateMany({ ownerId: id, status: { $in: ACTIVE } }, { $set: { status: "cancelled", updatedAt: now() } });
    await Images.deleteMany({ ownerId: id });
    await Rooms.deleteMany({ ownerId: id });
    await Users.deleteOne({ _id: u._id });
    return { ok: true };
  }],

  // --- rooms ---
  ["GET", /^\/api\/rooms$/, async req => {
    const me = await requireAuth(req);
    let rooms = oldestFirst(await Rooms.find({}).toArray());
    const map = await ownerMap(rooms.map(r => r.ownerId));
    // tenants only see rooms of approved owners
    if (me.role === "user") rooms = rooms.filter(r => { const u = map.get(r.ownerId); return u && u.status === "approved"; });
    return rooms.map(r => roomOut(ser(r), map));
  }],

  // public listing for the landing page: available rooms of approved owners (no phone numbers)
  ["GET", /^\/api\/public\/rooms$/, async () => {
    const [rooms, owners] = await Promise.all([Rooms.find({ status: "available" }).toArray(), Users.find({ role: "owner", status: "approved" }).toArray()]);
    const map = new Map(owners.map(u => [String(u._id), u]));
    return oldestFirst(rooms.filter(r => map.has(r.ownerId))).map(r => {
      const { ownerPhone, ownerId, ...pub } = roomOut(ser(r), map);
      return pub;
    });
  }],

  ["POST", /^\/api\/rooms$/, async (req, _m, b) => {
    const me = await requireAuth(req, "owner");
    const name = String(b.name || "").trim(), addr = String(b.addr || "").trim(), rent = Number(b.rent);
    const city = String(b.city || "").trim().replace(/\s+/g, " ").replace(/\w\S*/g, w => w[0].toUpperCase() + w.slice(1).toLowerCase());
    const description = String(b.description || "").trim();
    if (!name || !addr || !(rent > 0)) throw new HttpError(400, "name, address and a positive rent are required");
    if (!/^[A-Za-z][A-Za-z .'-]{1,39}$/.test(city)) throw new HttpError(400, "Enter a valid city");
    if (!TYPES.includes(b.type)) throw new HttpError(400, "Invalid room type");
    if (description.length > 500) throw new HttpError(400, "Description is too long (max 500 characters)");
    const amenities = Array.isArray(b.amenities) ? [...new Set(b.amenities)] : [];
    if (amenities.some(a => !AMENITIES.includes(a))) throw new HttpError(400, "Unknown amenity");
    if (!Array.isArray(b.images) || b.images.length < 1 || b.images.length > MAX_IMAGES)
      throw new HttpError(400, `Upload 1 to ${MAX_IMAGES} photos of the room`);
    const parsed = b.images.map(parseImage);

    const roomId = new ObjectId(), imageIds = [];
    for (const p of parsed)
      imageIds.push(String((await Images.insertOne({ roomId: String(roomId), ownerId: me.id, ...p, createdAt: now() })).insertedId));
    const room = { _id: roomId, name, addr, city, type: b.type, rent, amenities, description, images: imageIds,
                   status: "available", owner: me.name, ownerId: me.id, createdAt: now() };
    try { await Rooms.insertOne(room); }
    catch (e) { await Images.deleteMany({ roomId: String(roomId) }); throw e; }
    return [201, roomOut(ser(room), await ownerMap([me.id]))];
  }],

  ["DELETE", new RegExp(`^/api/rooms/${ID}$`), async (req, m) => {
    const me = await requireAuth(req, "owner", "admin");
    const room = await findRoom(m[1]);
    if (me.role === "owner" && room.ownerId !== me.id) throw new HttpError(403, "That room belongs to another owner");
    await Bookings.updateMany({ roomId: m[1], status: { $in: ACTIVE } }, { $set: { status: "cancelled", updatedAt: now() } });
    await Images.deleteMany({ roomId: m[1] });
    await Rooms.deleteOne({ _id: room._id });
    return { ok: true };
  }],

  ["POST", new RegExp(`^/api/rooms/${ID}/vacate$`), async (req, m) => {
    const me = await requireAuth(req, "owner");
    const room = await findRoom(m[1]);
    if (room.ownerId !== me.id) throw new HttpError(403, "That room belongs to another owner");
    await Bookings.updateMany({ roomId: m[1], status: { $in: ["approved", "leaving"] } }, { $set: { status: "ended", updatedAt: now() } });
    await setRoomStatus(m[1], "available");
    return ser({ ...room, status: "available" });
  }],

  // --- bookings (visible to the tenant, the room's owner, and the admin) ---
  ["GET", /^\/api\/bookings$/, async req => {
    const me = await requireAuth(req);
    const filter = me.role === "admin" ? {} : me.role === "user" ? { tenantId: me.id } : { ownerId: me.id };
    const list = await Bookings.find(filter).toArray();
    const map = await ownerMap(list.map(b => b.ownerId));
    return newestFirst(list.map(b => withOwner(ser(b), map)));
  }],

  ["POST", /^\/api\/bookings$/, async (req, _m, b) => {
    const me = await requireAuth(req, "user");
    const room = await findRoom(String(b.roomId || ""));
    const owner = await Users.findOne({ _id: oid(room.ownerId), role: "owner" });
    if (!owner || owner.status !== "approved") throw new HttpError(409, "Room is not available");
    // atomic: only one tenant can grab an available room
    const locked = await Rooms.findOneAndUpdate({ _id: room._id, status: "available" }, { $set: { status: "pending" } });
    if (!locked) throw new HttpError(409, "Room is not available");
    const t = now();
    const booking = {
      roomId: String(room._id), roomName: room.name, roomAddr: room.addr, roomType: room.type, rent: room.rent, roomImage: (room.images && room.images[0]) || null,
      ownerId: room.ownerId, owner: room.owner, tenantId: me.id, tenant: me.name, tenantEmail: me.email, tenantPhone: me.phone,
      status: "pending", createdAt: t, updatedAt: t };
    booking._id = (await Bookings.insertOne(booking)).insertedId;
    return [201, await bookingOut(booking)];
  }],

  // --- tenant actions on their own booking ---
  ["POST", new RegExp(`^/api/bookings/${ID}/cancel$`), async (req, m) => {
    const me = await requireAuth(req, "user");
    const b = await ownBooking(me, m[1]);
    const r = await move(b, "pending", { status: "cancelled" }, null, "Only pending bookings can be cancelled");
    await setRoomStatus(b.roomId, "available");
    return bookingOut(r);
  }],
  ["POST", new RegExp(`^/api/bookings/${ID}/leave$`), async (req, m) => {
    const me = await requireAuth(req, "user");
    const b = await ownBooking(me, m[1]);
    const r = await move(b, "approved", { status: "leaving", leaveRequestedAt: now() }, null, "You can only leave a room you are currently staying in");
    return bookingOut(r);
  }],
  ["POST", new RegExp(`^/api/bookings/${ID}/leave-cancel$`), async (req, m) => {
    const me = await requireAuth(req, "user");
    const b = await ownBooking(me, m[1]);
    const r = await move(b, "leaving", { status: "approved" }, { leaveRequestedAt: "" }, "No leave request to withdraw");
    return bookingOut(r);
  }],

  // --- owner decisions (only the owner of that room; the admin can view but not decide) ---
  ["POST", new RegExp(`^/api/bookings/${ID}/(approve|reject)$`), async (req, m) => {
    const me = await requireAuth(req, "owner");
    const b = await roomOwnerBooking(me, m[1]);
    const approve = m[2] === "approve";
    const r = await move(b, "pending", { status: approve ? "approved" : "rejected" }, null, "This booking is not pending");
    await setRoomStatus(b.roomId, approve ? "booked" : "available");
    return bookingOut(r);
  }],
  ["POST", new RegExp(`^/api/bookings/${ID}/leave-(approve|reject)$`), async (req, m) => {
    const me = await requireAuth(req, "owner");
    const b = await roomOwnerBooking(me, m[1]);
    const approve = m[2] === "approve";
    const r = approve
      ? await move(b, "leaving", { status: "ended", endedAt: now() }, null, "No leave request on this booking")
      : await move(b, "leaving", { status: "approved" }, { leaveRequestedAt: "" }, "No leave request on this booking");
    if (approve) await setRoomStatus(b.roomId, "available");
    return bookingOut(r);
  }],
];

// ---------- server ----------
const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") return send(res, 204);
  const url = new URL(req.url, "http://localhost");
  try {
    // room photos: public, cacheable binary
    const im = req.method === "GET" && url.pathname.match(/^\/api\/images\/([a-f0-9]{24})$/);
    if (im) {
      const d = await Images.findOne({ _id: new ObjectId(im[1]) });
      if (!d) return send(res, 404, { error: "Image not found" });
      res.writeHead(200, { "Content-Type": d.contentType, "Cache-Control": "public, max-age=31536000, immutable",
        "Access-Control-Allow-Origin": config.corsOrigin, "Cross-Origin-Resource-Policy": "cross-origin", "X-Content-Type-Options": "nosniff" });
      return res.end(Buffer.from(d.data, "base64"));
    }
    for (const [method, re, handler] of routes) {
      const m = url.pathname.match(re);
      if (method === req.method && m) {
        const body = method === "POST" ? await readBody(req) : {};
        const out = await handler(req, m, body);
        return Array.isArray(out) && typeof out[0] === "number" ? send(res, out[0], out[1]) : send(res, 200, out);
      }
    }
    send(res, 404, { error: "Not found" });
  } catch (e) {
    send(res, e.code && e.code < 600 ? e.code : 500, { error: e.code && e.code < 600 ? e.message : "Server error" });
    if (!(e.code && e.code < 600)) console.error(e);
  }
});

initDb()
  .then(() => server.listen(config.port, () => console.log(`NestRoom API running on http://localhost:${config.port}/api (MongoDB: ${config.dbName})`)))
  .catch(e => {
    console.error("\nCould not start:", e.message);
    if (/ENOTFOUND|ECONNREFUSED|timed out|Server selection|querySrv/i.test(e.message))
      console.error("Check MONGODB_URI, your internet connection, and that your IP address is allowed in Atlas > Network Access.");
    if (/auth/i.test(e.message)) console.error("Check the database username and password in MONGODB_URI.");
    process.exit(1);
  });
