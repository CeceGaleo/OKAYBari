const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const http = require('node:http');
const path = require('node:path');

const config = require('./config');
const { ensureTokenSecret, hashPassword, publicUser, signToken, verifyPassword, verifyToken } = require('./auth');
const { JsonStore } = require('./store');
const {
  AppError,
  validateEmail,
  validateNewUser,
  validatePassword,
  validateReservationInput,
  validateReservationUpdate,
} = require('./validation');

const store = new JsonStore(config.dbPath);
const routes = [];
const rateLimits = new Map();

let tokenSecret = '';

function route(method, pattern, handler) {
  const keys = [];
  const regex = new RegExp(`^${pattern.replace(/:[^/]+/g, (part) => {
    keys.push(part.slice(1));
    return '([^/]+)';
  })}$`);

  routes.push({ method, regex, keys, handler });
}

function securityHeaders(extra = {}) {
  return {
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'SAMEORIGIN',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Content-Security-Policy': [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline'",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com",
      "img-src 'self' data: https:",
      "connect-src 'self' http://localhost:* http://127.0.0.1:*",
      'frame-src https://www.google.com',
    ].join('; '),
    ...extra,
  };
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, securityHeaders({
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  }));
  res.end(body);
}

function ok(res, data, extra = {}) {
  sendJson(res, 200, { success: true, data, ...extra });
}

function created(res, data) {
  sendJson(res, 201, { success: true, data });
}

function fail(res, status, message, code = 'ERROR') {
  sendJson(res, status, { success: false, error: { code, message } });
}

function clientIp(req) {
  return req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket.remoteAddress || 'local';
}

function checkRateLimit(req, url) {
  const pathName = url.pathname;
  const ip = clientIp(req);
  let limit = 240;
  let windowMs = 60 * 1000;
  let scope = 'api';

  if (pathName === '/api/admin/login') {
    limit = 8;
    windowMs = 15 * 60 * 1000;
    scope = 'login';
  } else if (pathName === '/api/reservations' && req.method === 'POST') {
    limit = 20;
    windowMs = 15 * 60 * 1000;
    scope = 'reservation';
  }

  const now = Date.now();
  const key = `${scope}:${ip}`;
  const bucket = rateLimits.get(key) || { count: 0, resetAt: now + windowMs };

  if (bucket.resetAt <= now) {
    bucket.count = 0;
    bucket.resetAt = now + windowMs;
  }

  bucket.count += 1;
  rateLimits.set(key, bucket);

  if (bucket.count > limit) {
    throw new AppError(429, 'Troppi tentativi, riprova tra qualche minuto', 'RATE_LIMITED');
  }
}

async function readJsonBody(req) {
  if (req.method === 'GET' || req.method === 'HEAD') return {};

  const chunks = [];
  let size = 0;
  const maxSize = 128 * 1024;

  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxSize) throw new AppError(413, 'Richiesta troppo grande');
    chunks.push(chunk);
  }

  const raw = Buffer.concat(chunks).toString('utf8').trim();
  if (!raw) return {};

  try {
    return JSON.parse(raw);
  } catch {
    throw new AppError(400, 'JSON non valido');
  }
}

async function requireUser(req, roles = []) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  const payload = verifyToken(token, tokenSecret);

  if (!payload) throw new AppError(401, 'Sessione scaduta o non valida', 'UNAUTHORIZED');

  const db = await store.read();
  const user = db.users.find((item) => item.id === payload.sub && item.email === payload.email);
  if (!user) throw new AppError(401, 'Utente non trovato', 'UNAUTHORIZED');
  if (roles.length && !roles.includes(user.role)) {
    throw new AppError(403, 'Permessi insufficienti', 'FORBIDDEN');
  }

  return user;
}

function addLog(db, user, action, reservationId = '', details = '') {
  db.logs.unshift({
    id: crypto.randomUUID(),
    user_id: user?.id || '',
    user_email: user?.email || 'system',
    action,
    reservation_id: reservationId,
    details,
    created_at: new Date().toISOString(),
  });

  db.logs = db.logs.slice(0, 500);
}

function reservationResponse(reservation) {
  return { ...reservation };
}

function listReservations(db, query) {
  const page = Math.max(1, Number.parseInt(query.get('page') || '1', 10));
  const limit = Math.min(100, Math.max(1, Number.parseInt(query.get('limit') || '20', 10)));
  const date = query.get('date') || '';
  const status = query.get('status') || '';
  const search = (query.get('search') || '').trim().toLowerCase();

  let rows = [...db.reservations];
  if (date) rows = rows.filter((item) => item.date === date);
  if (status) rows = rows.filter((item) => item.status === status);
  if (search) {
    rows = rows.filter((item) => {
      const haystack = `${item.name} ${item.surname} ${item.phone} ${item.email}`.toLowerCase();
      return haystack.includes(search);
    });
  }

  rows.sort((a, b) => {
    const byDate = `${b.date} ${b.time}`.localeCompare(`${a.date} ${a.time}`);
    return byDate || b.created_at.localeCompare(a.created_at);
  });

  const total = rows.length;
  const pages = Math.max(1, Math.ceil(total / limit));
  const start = (page - 1) * limit;

  return {
    rows: rows.slice(start, start + limit).map(reservationResponse),
    pagination: { page, limit, total, pages },
  };
}

function buildSummary(db, date) {
  const rows = db.reservations.filter((item) => item.date === date);
  const activeRows = rows.filter((item) => item.status !== 'cancelled');
  const totals = {
    total: rows.length,
    confirmed: rows.filter((item) => item.status === 'confirmed').length,
    pending: rows.filter((item) => item.status === 'pending').length,
    cancelled: rows.filter((item) => item.status === 'cancelled').length,
    total_people: activeRows.reduce((sum, item) => sum + Number(item.people_count || 0), 0),
  };

  const grouped = new Map();
  for (const item of rows) {
    const current = grouped.get(item.time) || {
      time: item.time,
      total: 0,
      confirmed: 0,
      pending: 0,
      cancelled: 0,
      total_people: 0,
    };
    current.total += 1;
    current[item.status] += 1;
    if (item.status !== 'cancelled') current.total_people += Number(item.people_count || 0);
    grouped.set(item.time, current);
  }

  return {
    date,
    totals,
    by_time: [...grouped.values()].sort((a, b) => a.time.localeCompare(b.time)),
  };
}

async function getInitialAdminPassword() {
  if (config.defaultAdminPassword) return config.defaultAdminPassword;

  try {
    const raw = await fs.readFile(config.firstAdminPath, 'utf8');
    const match = /^Password:\s*(.+)$/m.exec(raw);
    if (match?.[1]) return match[1].trim();
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }

  const password = `Okay-${crypto.randomBytes(9).toString('base64url')}1A`;
  const content = [
    'Credenziali admin iniziali OKAY Bari',
    `Email: ${config.defaultAdminEmail}`,
    `Password: ${password}`,
    '',
    'Questo file viene creato solo per lo sviluppo locale. Cambia password creando un nuovo utente admin e rimuovi questo file prima di pubblicare.',
    '',
  ].join('\n');
  await fs.writeFile(config.firstAdminPath, content, { mode: 0o600 });
  return password;
}

async function seedAdminUser() {
  let seeded = false;
  const password = await getInitialAdminPassword();

  await store.update(async (db) => {
    if (db.users.length > 0) return;

    const now = new Date().toISOString();
    db.users.push({
      id: crypto.randomUUID(),
      email: validateEmail(config.defaultAdminEmail),
      password_hash: await hashPassword(password),
      role: 'admin',
      created_at: now,
      updated_at: now,
    });
    seeded = true;
  });

  return seeded;
}

route('GET', '/api/health', async (_ctx, res) => {
  ok(res, { status: 'ok', time: new Date().toISOString() });
});

route('POST', '/api/reservations', async (ctx, res) => {
  const input = validateReservationInput(ctx.body);
  const createdReservation = await store.update(async (db) => {
    const now = new Date().toISOString();
    const reservation = {
      id: crypto.randomUUID(),
      ...input,
      status: 'pending',
      internal_notes: '',
      created_at: now,
      updated_at: now,
    };

    db.reservations.push(reservation);
    addLog(db, null, 'CREATE_RESERVATION', reservation.id, `${reservation.name} ${reservation.surname}`.trim());
    return reservationResponse(reservation);
  });

  created(res, createdReservation);
});

route('POST', '/api/admin/login', async (ctx, res) => {
  const email = validateEmail(ctx.body.email);
  const password = typeof ctx.body.password === 'string' ? ctx.body.password : '';
  const db = await store.read();
  const user = db.users.find((item) => item.email === email);

  if (!user || !(await verifyPassword(password, user.password_hash))) {
    throw new AppError(401, 'Email o password non corretti', 'BAD_CREDENTIALS');
  }

  await store.update(async (data) => {
    const stored = data.users.find((item) => item.id === user.id);
    if (stored) stored.last_login_at = new Date().toISOString();
    addLog(data, user, 'LOGIN', '', 'Accesso al pannello');
  });

  ok(res, {
    token: signToken(user, tokenSecret, config.tokenTtlSeconds),
    user: publicUser(user),
  });
});

route('GET', '/api/admin/summary', async (ctx, res) => {
  await requireUser(ctx.req, ['admin', 'staff']);
  const date = ctx.url.searchParams.get('date') || new Date().toISOString().slice(0, 10);
  const db = await store.read();
  ok(res, buildSummary(db, date));
});

route('GET', '/api/admin/reservations', async (ctx, res) => {
  await requireUser(ctx.req, ['admin', 'staff']);
  const db = await store.read();
  const { rows, pagination } = listReservations(db, ctx.url.searchParams);
  ok(res, rows, { pagination });
});

route('GET', '/api/admin/reservations/:id', async (ctx, res) => {
  await requireUser(ctx.req, ['admin', 'staff']);
  const db = await store.read();
  const reservation = db.reservations.find((item) => item.id === ctx.params.id);
  if (!reservation) throw new AppError(404, 'Prenotazione non trovata', 'NOT_FOUND');
  ok(res, reservationResponse(reservation));
});

route('PUT', '/api/admin/reservations/:id', async (ctx, res) => {
  const user = await requireUser(ctx.req, ['admin', 'staff']);
  const update = validateReservationUpdate(ctx.body);

  const updated = await store.update(async (db) => {
    const reservation = db.reservations.find((item) => item.id === ctx.params.id);
    if (!reservation) throw new AppError(404, 'Prenotazione non trovata', 'NOT_FOUND');

    Object.assign(reservation, update, { updated_at: new Date().toISOString() });
    addLog(db, user, 'UPDATE_RESERVATION', reservation.id, JSON.stringify(update));
    return reservationResponse(reservation);
  });

  ok(res, updated);
});

route('DELETE', '/api/admin/reservations/:id', async (ctx, res) => {
  const user = await requireUser(ctx.req, ['admin']);

  const removed = await store.update(async (db) => {
    const index = db.reservations.findIndex((item) => item.id === ctx.params.id);
    if (index === -1) throw new AppError(404, 'Prenotazione non trovata', 'NOT_FOUND');

    const [reservation] = db.reservations.splice(index, 1);
    addLog(db, user, 'DELETE_RESERVATION', reservation.id, `${reservation.name} ${reservation.surname}`.trim());
    return reservationResponse(reservation);
  });

  ok(res, removed);
});

route('GET', '/api/admin/logs', async (ctx, res) => {
  await requireUser(ctx.req, ['admin']);
  const db = await store.read();
  ok(res, db.logs.slice(0, 200));
});

route('GET', '/api/admin/users', async (ctx, res) => {
  await requireUser(ctx.req, ['admin']);
  const db = await store.read();
  ok(res, db.users.map(publicUser));
});

route('POST', '/api/admin/users', async (ctx, res) => {
  const actor = await requireUser(ctx.req, ['admin']);
  const input = validateNewUser(ctx.body);

  const user = await store.update(async (db) => {
    if (db.users.some((item) => item.email === input.email)) {
      throw new AppError(409, 'Email già registrata', 'DUPLICATE_USER');
    }

    const now = new Date().toISOString();
    const nextUser = {
      id: crypto.randomUUID(),
      email: input.email,
      password_hash: await hashPassword(input.password),
      role: input.role,
      created_at: now,
      updated_at: now,
    };

    db.users.push(nextUser);
    addLog(db, actor, 'CREATE_USER', '', `${nextUser.email} (${nextUser.role})`);
    return publicUser(nextUser);
  });

  created(res, user);
});

route('PUT', '/api/admin/users/:id/password', async (ctx, res) => {
  const actor = await requireUser(ctx.req, ['admin']);
  const password = validatePassword(ctx.body.password);

  const user = await store.update(async (db) => {
    const target = db.users.find((item) => item.id === ctx.params.id);
    if (!target) throw new AppError(404, 'Utente non trovato', 'NOT_FOUND');

    target.password_hash = await hashPassword(password);
    target.updated_at = new Date().toISOString();
    addLog(db, actor, 'UPDATE_USER_PASSWORD', '', target.email);
    return publicUser(target);
  });

  ok(res, user);
});

function mimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
  }[ext] || 'application/octet-stream';
}

async function serveStatic(req, res, url) {
  if (!['GET', 'HEAD'].includes(req.method)) {
    fail(res, 405, 'Metodo non consentito', 'METHOD_NOT_ALLOWED');
    return;
  }

  let pathname = decodeURIComponent(url.pathname);
  if (pathname === '/') pathname = '/index.html';
  if (pathname === '/admin' || pathname === '/admin/') pathname = '/admin.html';

  const filePath = path.resolve(config.publicDir, `.${pathname}`);
  const publicRoot = path.resolve(config.publicDir);
  if (!filePath.startsWith(`${publicRoot}${path.sep}`)) {
    fail(res, 403, 'Accesso negato', 'FORBIDDEN');
    return;
  }

  try {
    const stat = await fs.stat(filePath);
    if (!stat.isFile()) throw new AppError(404, 'File non trovato', 'NOT_FOUND');

    const body = req.method === 'HEAD' ? Buffer.alloc(0) : await fs.readFile(filePath);
    res.writeHead(200, securityHeaders({
      'Content-Type': mimeType(filePath),
      'Content-Length': req.method === 'HEAD' ? 0 : body.length,
      'Cache-Control': 'no-store',
    }));
    res.end(body);
  } catch (error) {
    if (error.code === 'ENOENT' || error.status === 404) {
      fail(res, 404, 'File non trovato', 'NOT_FOUND');
      return;
    }
    throw error;
  }
}

async function handleApi(req, res, url) {
  checkRateLimit(req, url);

  const match = routes.find((item) => item.method === req.method && item.regex.test(url.pathname));
  if (!match) {
    fail(res, 404, 'Endpoint non trovato', 'NOT_FOUND');
    return;
  }

  const values = match.regex.exec(url.pathname).slice(1);
  const params = Object.fromEntries(match.keys.map((key, index) => [key, decodeURIComponent(values[index])]));
  const body = await readJsonBody(req);

  await match.handler({ req, url, params, body }, res);
}

async function handleRequest(req, res) {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

    if (req.method === 'OPTIONS') {
      res.writeHead(204, securityHeaders());
      res.end();
      return;
    }

    if (url.pathname.startsWith('/api/')) {
      await handleApi(req, res, url);
      return;
    }

    await serveStatic(req, res, url);
  } catch (error) {
    if (error instanceof AppError) {
      fail(res, error.status, error.message, error.code);
      return;
    }

    console.error(error);
    fail(res, 500, 'Errore interno del server', 'INTERNAL_ERROR');
  }
}

async function main() {
  if (!Number.isFinite(config.port) || config.port < 1 || config.port > 65535) {
    throw new Error('PORT non valida');
  }

  await store.ensure();
  tokenSecret = await ensureTokenSecret(config);
  const seeded = await seedAdminUser();

  const server = http.createServer(handleRequest);
  server.listen(config.port, config.host, () => {
    console.log(`OKAY Bari server attivo: http://${config.host}:${config.port}`);
    console.log(`Sito pubblico: http://${config.host}:${config.port}/`);
    console.log(`Pannello admin: http://${config.host}:${config.port}/admin`);
    if (seeded && !config.defaultAdminPassword) {
      console.log(`Credenziali iniziali salvate in: ${config.firstAdminPath}`);
    }
  });
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
