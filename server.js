import express from "express";
import crypto from "node:crypto";
import pg from "pg";

const TOKEN = process.env.DISCORD_BOT_TOKEN;
const CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET;
const SESSION_SECRET = process.env.SESSION_SECRET;
const BASE_URL = (process.env.BASE_URL || "").replace(/\/+$/, "");
const GUILD_ID = process.env.GUILD_ID || "1459268461195690086";
const PORT = process.env.PORT || 3000;
const DATABASE_URL = process.env.DATABASE_URL;
const SECURE = BASE_URL.startsWith("https://");
const REDIRECT_URI = `${BASE_URL}/api/auth/discord/callback`;

// Gradele, de sus în jos (ordinea contează)
const RANKS = [
  { name: "Lider LV", id: "1461806957773062144" },
  { name: "Lider Secundar LV", id: "1566808505678176316" },
  { name: "Co-Lider LV", id: "1566593624748327085" },
  { name: "Coordonator LV", id: "1567539543136014377" },
  { name: "Reprezentant LV", id: "1566593769380384929" },
  { name: "Enforcer LV", id: "1566593834870374512" },
  { name: "Membru Avansat LV", id: "1566593999509262497" },
  { name: "Membru LV", id: "1566594049723474144" },
];
const LEADERS = ["Lider LV", "Lider Secundar LV"]; // au acces la Administrare

if (!TOKEN) { console.error("Lipsește DISCORD_BOT_TOKEN."); process.exit(1); }
if (!CLIENT_ID || !CLIENT_SECRET || !SESSION_SECRET || !BASE_URL) {
  console.warn("Atenție: conectarea cu Discord nu merge fără DISCORD_CLIENT_ID, DISCORD_CLIENT_SECRET, SESSION_SECRET și BASE_URL.");
}

async function discord(path) {
  for (let i = 0; i < 3; i++) {
    const r = await fetch(`https://discord.com/api/v10${path}`, { headers: { Authorization: `Bot ${TOKEN}` } });
    if (r.status === 429) {
      const wait = ((await r.json()).retry_after || 1) * 1000;
      await new Promise((res) => setTimeout(res, wait));
      continue;
    }
    if (r.status === 404) return null;
    if (!r.ok) throw new Error(`Discord ${r.status}: ${await r.text()}`);
    return r.json();
  }
  throw new Error("Discord rate limit");
}

function avatarOf(m) {
  const u = m.user;
  if (m.avatar) return `https://cdn.discordapp.com/guilds/${GUILD_ID}/users/${u.id}/avatars/${m.avatar}.png?size=64`;
  if (u.avatar) return `https://cdn.discordapp.com/avatars/${u.id}/${u.avatar}.png?size=64`;
  return null;
}
const nameOf = (m) => m.nick || m.user.global_name || m.user.username;
const rankIndexOf = (m) => RANKS.findIndex((r) => m.roles.includes(r.id));

async function fetchMembers() {
  let after = "0";
  const all = [];
  for (;;) {
    const page = await discord(`/guilds/${GUILD_ID}/members?limit=1000&after=${after}`);
    all.push(...page);
    if (page.length < 1000) break;
    after = page[page.length - 1].user.id;
  }
  return all
    .filter((m) => !m.user.bot)
    .map((m) => {
      const idx = rankIndexOf(m);
      if (idx < 0) return null;
      return { name: nameOf(m), avatar: avatarOf(m), rank: RANKS[idx].name, rankIndex: idx };
    })
    .filter(Boolean)
    .sort((a, b) => a.rankIndex - b.rankIndex || a.name.localeCompare(b.name, "ro"));
}

// ---- sesiuni (cookie semnat, fără biblioteci extra) ----
const b64 = (s) => Buffer.from(s).toString("base64url");
const sign = (p) => crypto.createHmac("sha256", SESSION_SECRET || "x").update(p).digest("base64url");
function makeSession(data) {
  const p = b64(JSON.stringify({ ...data, exp: Date.now() + 7 * 24 * 3600 * 1000 }));
  return `${p}.${sign(p)}`;
}
function readSession(req) {
  const raw = parseCookies(req).lv_session;
  if (!raw || !SESSION_SECRET) return null;
  const [p, sig] = raw.split(".");
  if (!p || !sig) return null;
  const a = Buffer.from(sig), b = Buffer.from(sign(p));
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const d = JSON.parse(Buffer.from(p, "base64url").toString());
    return d.exp > Date.now() ? d : null;
  } catch { return null; }
}
function parseCookies(req) {
  const out = {};
  (req.headers.cookie || "").split(";").forEach((c) => {
    const i = c.indexOf("=");
    if (i > 0) out[c.slice(0, i).trim()] = decodeURIComponent(c.slice(i + 1).trim());
  });
  return out;
}
function setCookie(res, name, value, maxAge) {
  res.append("Set-Cookie", `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${SECURE ? "; Secure" : ""}`);
}

const app = express();
app.use(express.json({ limit: "10kb" }));

let cache = { at: 0, data: [] };
app.get("/api/members", async (_req, res) => {
  try {
    if (Date.now() - cache.at > 60_000) cache = { at: Date.now(), data: await fetchMembers() };
    res.json({ ranks: RANKS.map((r) => r.name), members: cache.data });
  } catch (e) {
    console.error(e);
    res.status(502).json({ error: "Nu am putut citi membrii de pe Discord." });
  }
});

app.get("/api/auth/discord/login", (_req, res) => {
  if (!CLIENT_ID || !SESSION_SECRET || !BASE_URL) return res.status(500).send("Conectarea cu Discord nu este configurată pe server.");
  const state = crypto.randomBytes(16).toString("hex");
  setCookie(res, "lv_state", state, 600);
  const q = new URLSearchParams({ client_id: CLIENT_ID, redirect_uri: REDIRECT_URI, response_type: "code", scope: "identify", state, prompt: "none" });
  res.redirect(`https://discord.com/oauth2/authorize?${q}`);
});

app.get("/api/auth/discord/callback", async (req, res) => {
  const fail = (why) => res.redirect(`/?login=${why}#acasa`);
  try {
    const { code, state } = req.query;
    const saved = parseCookies(req).lv_state;
    setCookie(res, "lv_state", "", 0);
    if (!code || !state || !saved || state !== saved) return fail("fail");

    const tr = await fetch("https://discord.com/api/v10/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET, grant_type: "authorization_code", code: String(code), redirect_uri: REDIRECT_URI }),
    });
    if (!tr.ok) return fail("fail");
    const { access_token } = await tr.json();

    const ur = await fetch("https://discord.com/api/v10/users/@me", { headers: { Authorization: `Bearer ${access_token}` } });
    if (!ur.ok) return fail("fail");
    const user = await ur.json();

    const member = await discord(`/guilds/${GUILD_ID}/members/${user.id}`);
    if (!member) return fail("notmember");

    setCookie(res, "lv_session", makeSession({ uid: user.id }), 7 * 24 * 3600);
    res.redirect("/#pontaj");
  } catch (e) {
    console.error(e);
    fail("fail");
  }
});

// gradul se verifică live (cache scurt), nu doar la conectare
const memberCache = new Map();
async function getMember(uid) {
  let c = memberCache.get(uid);
  if (!c || Date.now() - c.at > 30_000) {
    c = { at: Date.now(), m: await discord(`/guilds/${GUILD_ID}/members/${uid}`) };
    memberCache.set(uid, c);
  }
  return c.m;
}
app.get("/api/me", async (req, res) => {
  const s = readSession(req);
  if (!s) return res.json({ loggedIn: false });
  try {
    const m = await getMember(s.uid);
    if (!m) return res.json({ loggedIn: false });
    const idx = rankIndexOf(m);
    const rank = idx < 0 ? null : RANKS[idx].name;
    res.json({ loggedIn: true, name: nameOf(m), avatar: avatarOf(m), rank, isLeader: !!rank && LEADERS.includes(rank) });
  } catch (e) {
    console.error(e);
    res.status(502).json({ loggedIn: false });
  }
});

app.post("/api/auth/logout", (_req, res) => {
  setCookie(res, "lv_session", "", 0);
  res.json({ ok: true });
});


// ================= baza de date: pontaj + activități =================
const { Pool } = pg;
let pool = null;
if (DATABASE_URL) {
  pool = new Pool({
    connectionString: DATABASE_URL,
    max: 5,
    ssl: /localhost|127\.0\.0\.1/.test(DATABASE_URL) ? false : { rejectUnauthorized: false },
  });
  try {
    await pool.query(`
      create table if not exists lv_users (uid text primary key, name text not null, avatar text, rank text, updated_at timestamptz not null default now());
      create table if not exists lv_sessions (id bigserial primary key, uid text not null, started_at timestamptz not null default now(), ended_at timestamptz, auto boolean not null default false);
      create index if not exists lv_sessions_uid_idx on lv_sessions (uid, started_at desc);
      create unique index if not exists lv_one_open_idx on lv_sessions (uid) where ended_at is null;
      create table if not exists lv_activities (id bigserial primary key, uid text not null, type text not null, note text not null, created_at timestamptz not null default now());
      create index if not exists lv_activities_time_idx on lv_activities (created_at desc);
    `);
  } catch (e) {
    console.error("Nu pot porni baza de date:", e.message);
    pool = null;
  }
} else {
  console.warn("Lipsește DATABASE_URL: Pontajul și Activitățile sunt oprite.");
}
const q = (sql, p) => pool.query(sql, p);

const TYPES = ["Acțiune", "Patrulă", "Recrutare", "Eveniment", "Antrenament", "Altele"];
const MAX_H = 8; // o tură uitată deschisă se închide automat după atâtea ore
const TZ = "Europe/Bucharest";

// luni 00:00, ora României, ca moment UTC
function tzOffsetMs(date) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: TZ, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })
      .formatToParts(date).map((x) => [x.type, x.value])
  );
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - Math.floor(date.getTime() / 1000) * 1000;
}
function weekStart() {
  const now = new Date();
  const local = new Date(now.getTime() + tzOffsetMs(now));
  const dow = (local.getUTCDay() + 6) % 7; // luni = 0
  const mondayWall = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() - dow);
  const guess = new Date(mondayWall - tzOffsetMs(now));
  return new Date(mondayWall - tzOffsetMs(guess));
}

const closeStale = () =>
  q(`update lv_sessions set ended_at = started_at + interval '${MAX_H} hours', auto = true where ended_at is null and started_at < now() - interval '${MAX_H} hours'`);
const upsertUser = (u) =>
  q(`insert into lv_users (uid, name, avatar, rank) values ($1,$2,$3,$4)
     on conflict (uid) do update set name = excluded.name, avatar = excluded.avatar, rank = excluded.rank, updated_at = now()`, [u.uid, u.name, u.avatar, u.rank]);

async function authed(req, res) {
  const s = readSession(req);
  if (!s) { res.status(401).json({ error: "Trebuie să te conectezi cu Discord." }); return null; }
  const m = await getMember(s.uid);
  if (!m) { res.status(401).json({ error: "Nu mai ești pe serverul LV." }); return null; }
  const idx = rankIndexOf(m);
  if (idx < 0) { res.status(403).json({ error: "Ai nevoie de un grad LV." }); return null; }
  const rank = RANKS[idx].name;
  return { uid: s.uid, name: nameOf(m), avatar: avatarOf(m), rank, isLeader: LEADERS.includes(rank) };
}
// verifică baza de date + conectarea + gradul LV, apoi rulează handlerul
const h = (fn) => async (req, res) => {
  try {
    if (!pool) return res.status(503).json({ error: "Baza de date nu este configurată pe server." });
    const u = await authed(req, res);
    if (!u) return;
    if (req.method !== "GET") await upsertUser(u);
    await fn(req, res, u);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Eroare de server. Încearcă din nou." });
  }
};
// cererile care modifică date trebuie să vină din site (nu dintr-o altă pagină)
app.use(["/api/pontaj", "/api/activitati"], (req, res, next) => {
  if (req.method !== "GET" && req.get("x-lv") !== "1") return res.status(400).json({ error: "Cerere invalidă." });
  next();
});

const WEEK_SQL = `select coalesce(sum(extract(epoch from (coalesce(ended_at, now()) - greatest(started_at, $2)))), 0)::float8 as secs
                  from lv_sessions where uid = $1 and coalesce(ended_at, now()) > $2`;

app.get("/api/pontaj/me", h(async (_req, res, u) => {
  await closeStale();
  const ws = weekStart();
  const open = (await q("select started_at from lv_sessions where uid = $1 and ended_at is null", [u.uid])).rows[0];
  const week = (await q(WEEK_SQL, [u.uid, ws])).rows[0];
  const sessions = (await q("select id, started_at, ended_at, auto from lv_sessions where uid = $1 order by started_at desc limit 15", [u.uid])).rows;
  res.json({
    serverNow: new Date(),
    maxHours: MAX_H,
    open: open ? { startedAt: open.started_at } : null,
    weekSecs: week.secs,
    sessions: sessions.map((s) => ({ id: s.id, start: s.started_at, end: s.ended_at, auto: s.auto })),
  });
}));

app.get("/api/pontaj/board", h(async (_req, res) => {
  await closeStale();
  const rows = (await q(
    `select u.name, u.avatar, u.rank,
            coalesce(sum(extract(epoch from (coalesce(s.ended_at, now()) - greatest(s.started_at, $1)))), 0)::float8 as secs,
            bool_or(s.ended_at is null) as on_duty
     from lv_sessions s join lv_users u on u.uid = s.uid
     where coalesce(s.ended_at, now()) > $1
     group by u.uid, u.name, u.avatar, u.rank
     order by secs desc, u.name limit 50`, [weekStart()])).rows;
  res.json({ board: rows.map((r) => ({ name: r.name, avatar: r.avatar, rank: r.rank, secs: r.secs, onDuty: r.on_duty })) });
}));

app.post("/api/pontaj/start", h(async (_req, res, u) => {
  await closeStale();
  try {
    await q("insert into lv_sessions (uid) values ($1)", [u.uid]);
  } catch (e) {
    if (e.code === "23505") return res.status(409).json({ error: "Ai deja o tură deschisă." });
    throw e;
  }
  res.json({ ok: true });
}));

app.post("/api/pontaj/stop", h(async (_req, res, u) => {
  await closeStale();
  const r = await q("update lv_sessions set ended_at = now() where uid = $1 and ended_at is null", [u.uid]);
  if (!r.rowCount) return res.status(409).json({ error: `Nu ai nicio tură deschisă. Turele uitate se închid automat după ${MAX_H} ore.` });
  res.json({ ok: true });
}));

app.get("/api/pontaj/all", h(async (_req, res, u) => {
  if (!u.isLeader) return res.status(403).json({ error: "Doar conducerea are acces." });
  await closeStale();
  const rows = (await q(
    `select s.id, s.started_at, s.ended_at, s.auto, u.name, u.rank
     from lv_sessions s join lv_users u on u.uid = s.uid order by s.started_at desc limit 40`)).rows;
  res.json({ sessions: rows.map((r) => ({ id: r.id, start: r.started_at, end: r.ended_at, auto: r.auto, name: r.name, rank: r.rank })) });
}));

app.delete("/api/pontaj/:id", h(async (req, res, u) => {
  if (!u.isLeader) return res.status(403).json({ error: "Doar conducerea poate șterge ture." });
  if (!/^\d+$/.test(req.params.id)) return res.status(400).json({ error: "Cerere invalidă." });
  await q("delete from lv_sessions where id = $1", [req.params.id]);
  res.json({ ok: true });
}));

app.get("/api/activitati", h(async (_req, res, u) => {
  const week = (await q(
    `select u.name, u.avatar, u.rank, count(*)::int as n
     from lv_activities a join lv_users u on u.uid = a.uid
     where a.created_at >= $1 group by u.uid, u.name, u.avatar, u.rank order by n desc, u.name limit 30`, [weekStart()])).rows;
  const recent = (await q(
    `select a.id, a.uid, a.type, a.note, a.created_at, u.name, u.avatar, u.rank
     from lv_activities a join lv_users u on u.uid = a.uid order by a.created_at desc limit 40`)).rows;
  res.json({
    types: TYPES,
    week,
    recent: recent.map((a) => ({ id: a.id, type: a.type, note: a.note, at: a.created_at, name: a.name, avatar: a.avatar, rank: a.rank, canDelete: u.isLeader || a.uid === u.uid })),
  });
}));

app.post("/api/activitati", h(async (req, res, u) => {
  const type = String(req.body?.type || "");
  const note = String(req.body?.note || "").trim().slice(0, 300);
  if (!TYPES.includes(type)) return res.status(400).json({ error: "Alege un tip de activitate." });
  if (note.length < 3) return res.status(400).json({ error: "Descrie pe scurt activitatea (minimum 3 caractere)." });
  const recent = (await q("select count(*)::int as n from lv_activities where uid = $1 and created_at > now() - interval '1 hour'", [u.uid])).rows[0].n;
  if (recent >= 15) return res.status(429).json({ error: "Ai adăugat prea multe activități într-o oră. Încearcă mai târziu." });
  await q("insert into lv_activities (uid, type, note) values ($1,$2,$3)", [u.uid, type, note]);
  res.json({ ok: true });
}));

app.delete("/api/activitati/:id", h(async (req, res, u) => {
  if (!/^\d+$/.test(req.params.id)) return res.status(400).json({ error: "Cerere invalidă." });
  const r = await q("delete from lv_activities where id = $1 and ($2 or uid = $3)", [req.params.id, u.isLeader, u.uid]);
  if (!r.rowCount) return res.status(403).json({ error: "Nu poți șterge această activitate." });
  res.json({ ok: true });
}));

app.use(express.static("public"));
app.listen(PORT, () => console.log(`Panou LV pe portul ${PORT}`));
