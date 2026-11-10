import express from "express";
import crypto from "node:crypto";

const TOKEN = process.env.DISCORD_BOT_TOKEN;
const CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET;
const SESSION_SECRET = process.env.SESSION_SECRET;
const BASE_URL = (process.env.BASE_URL || "").replace(/\/+$/, "");
const GUILD_ID = process.env.GUILD_ID || "1459268461195690086";
const PORT = process.env.PORT || 3000;
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
    res.redirect("/#admin");
  } catch (e) {
    console.error(e);
    fail("fail");
  }
});

// gradul se verifică live la fiecare cerere (cache scurt), nu doar la conectare
const meCache = new Map();
app.get("/api/me", async (req, res) => {
  const s = readSession(req);
  if (!s) return res.json({ loggedIn: false });
  try {
    let c = meCache.get(s.uid);
    if (!c || Date.now() - c.at > 30_000) {
      const m = await discord(`/guilds/${GUILD_ID}/members/${s.uid}`);
      c = { at: Date.now(), m };
      meCache.set(s.uid, c);
    }
    if (!c.m) return res.json({ loggedIn: false });
    const idx = rankIndexOf(c.m);
    const rank = idx < 0 ? null : RANKS[idx].name;
    res.json({ loggedIn: true, name: nameOf(c.m), avatar: avatarOf(c.m), rank, isLeader: !!rank && LEADERS.includes(rank) });
  } catch (e) {
    console.error(e);
    res.status(502).json({ loggedIn: false });
  }
});

app.post("/api/auth/logout", (_req, res) => {
  setCookie(res, "lv_session", "", 0);
  res.json({ ok: true });
});

app.use(express.static("public"));
app.listen(PORT, () => console.log(`Panou LV pe portul ${PORT}`));
