// Pulls the regular-season schedule and final scores for the seven Canadian
// NHL teams and writes data.json for the BOGO watch page.
// Runs in GitHub Actions; needs Node 18 or newer (built-in fetch).
import { readFile, writeFile, appendFile } from "node:fs/promises";

const TEAMS = ["OTT", "TOR", "EDM", "CGY", "VAN", "WPG", "MTL"];
const TZ = "America/Toronto";
const OUT = "data.json";

const now = new Date();
const year = now.getUTCFullYear();
const month = now.getUTCMonth() + 1;
const season = process.env.SEASON || (month >= 8 ? `${year}${year + 1}` : `${year - 1}${year}`);

const dateParts = new Intl.DateTimeFormat("en-US", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" });
const timeFmt = new Intl.DateTimeFormat("en-US", { timeZone: TZ, hour: "numeric", minute: "2-digit" });

function etDate(d) {
  const p = Object.fromEntries(dateParts.formatToParts(d).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}
function etTime(d) {
  return timeFmt.format(d).replace(/[\u202f\u00a0]/g, " ");
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getJSON(url) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": "bogo-watch (GitHub Actions)" } });
      if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
      return await res.json();
    } catch (err) {
      if (attempt === 3) throw err;
      await sleep(3000 * attempt);
    }
  }
}

const byId = new Map();
for (const team of TEAMS) {
  const data = await getJSON(`https://api-web.nhle.com/v1/club-schedule-season/${team}/${season}`);
  if (!data || !Array.isArray(data.games)) throw new Error(`Unexpected response for ${team}`);
  for (const g of data.games) {
    if (g.gameType !== 2) continue; // regular season only
    if (g.gameScheduleState && g.gameScheduleState !== "OK") continue; // postponed or cancelled
    if (!g.startTimeUTC || !g.awayTeam || !g.homeTeam) continue;
    byId.set(g.id, g);
  }
}
if (byId.size < 50) throw new Error(`Only ${byId.size} games found for ${season}. Leaving the current data alone.`);

const games = [...byId.values()]
  .sort((a, b) => new Date(a.startTimeUTC) - new Date(b.startTimeUTC))
  .map((g) => {
    const start = new Date(g.startTimeUTC);
    const final = g.gameState === "FINAL" || g.gameState === "OFF";
    const as = final && Number.isFinite(g.awayTeam.score) ? g.awayTeam.score : null;
    const hs = final && Number.isFinite(g.homeTeam.score) ? g.homeTeam.score : null;
    return [etDate(start), etTime(start), g.awayTeam.abbrev, g.homeTeam.abbrev, as, hs];
  });

let previous = null;
try { previous = JSON.parse(await readFile(OUT, "utf8")); } catch { /* first run */ }

const changed = !previous || JSON.stringify(previous.games) !== JSON.stringify(games);
if (changed) {
  const data = {
    updated: etDate(now),
    updatedAt: now.toISOString(),
    start: games[0][0],
    scheduleEnd: games[games.length - 1][0],
    games,
  };
  await writeFile(OUT, JSON.stringify(data) + "\n");
  const finals = games.filter((g) => g[4] !== null).length;
  console.log(`Wrote ${games.length} games (${finals} final) for ${season}.`);
} else {
  console.log("No new results.");
}
if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `changed=${changed}\n`);
