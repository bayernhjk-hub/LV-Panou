import express from "express";

const TOKEN = process.env.DISCORD_BOT_TOKEN;
const GUILD_ID = process.env.GUILD_ID || "1459268461195690086";
const PORT = process.env.PORT || 3000;

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

if (!TOKEN) {
  console.error("Lipsește DISCORD_BOT_TOKEN.");
  process.exit(1);
}

async function discord(path) {
  for (let i = 0; i < 3; i++) {
    const r = await fetch(`https://discord.com/api/v10${path}`, {
      headers: { Authorization: `Bot ${TOKEN}` },
    });
    if (r.status === 429) {
      const wait = ((await r.json()).retry_after || 1) * 1000;
      await new Promise((res) => setTimeout(res, wait));
      continue;
    }
    if (!r.ok) throw new Error(`Discord ${r.status}: ${await r.text()}`);
    return r.json();
  }
  throw new Error("Discord rate limit");
}

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
      const idx = RANKS.findIndex((r) => m.roles.includes(r.id));
      if (idx < 0) return null; // fără grad LV, nu apare
      const u = m.user;
      const avatar = m.avatar
        ? `https://cdn.discordapp.com/guilds/${GUILD_ID}/users/${u.id}/avatars/${m.avatar}.png?size=64`
        : u.avatar
        ? `https://cdn.discordapp.com/avatars/${u.id}/${u.avatar}.png?size=64`
        : null;
      return {
        name: m.nick || u.global_name || u.username,
        avatar,
        rank: RANKS[idx].name,
        rankIndex: idx,
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.rankIndex - b.rankIndex || a.name.localeCompare(b.name, "ro"));
}

let cache = { at: 0, data: [] };

const app = express();
app.get("/api/members", async (_req, res) => {
  try {
    if (Date.now() - cache.at > 60_000) {
      cache = { at: Date.now(), data: await fetchMembers() };
    }
    res.json({ ranks: RANKS.map((r) => r.name), members: cache.data });
  } catch (e) {
    console.error(e);
    res.status(502).json({ error: "Nu am putut citi membrii de pe Discord." });
  }
});
app.use(express.static("public"));
app.listen(PORT, () => console.log(`Panou LV pe portul ${PORT}`));
