// Vercel serverless function: returns date-aligned GitHub commit + Monkeytype
// typing-activity heatmaps. Keys live in env vars; response is edge-cached.
//
// Required env vars:
//   GITHUB_TOKEN        - GitHub PAT (public contribution data needs no special scope)
//   MONKEYTYPE_APE_KEY  - Monkeytype ApeKey (account settings)
// Optional:
//   GITHUB_LOGIN        - GitHub username (defaults to joeyzhang-dev)

const GITHUB_LOGIN = process.env.GITHUB_LOGIN || 'joeyzhang-dev';
const WEEKS = 53;
const MS_PER_DAY = 86400000;

function isoDate(d) {
  return d.toISOString().slice(0, 10);
}

// Canonical date axis: WEEKS columns of 7 days, ending today, starting on a Sunday.
function buildAxis() {
  const today = new Date();
  const end = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  const start = new Date(end.getTime() - (WEEKS * 7 - 1) * MS_PER_DAY);
  // Roll start back to the most recent Sunday (getUTCDay: 0 = Sunday).
  start.setUTCDate(start.getUTCDate() - start.getUTCDay());
  const days = [];
  for (let t = start.getTime(); t <= end.getTime(); t += MS_PER_DAY) {
    const d = new Date(t);
    days.push({ date: isoDate(d), weekday: d.getUTCDay(), count: 0, level: 0 });
  }
  return { start: isoDate(start), end: isoDate(end), days };
}

// Bucket a raw count into levels 1-4 relative to the period max (0 stays 0).
function levelFor(count, max) {
  if (count <= 0 || max <= 0) return 0;
  const step = max / 4;
  if (count <= step) return 1;
  if (count <= step * 2) return 2;
  if (count <= step * 3) return 3;
  return 4;
}

const GH_LEVEL = {
  NONE: 0,
  FIRST_QUARTILE: 1,
  SECOND_QUARTILE: 2,
  THIRD_QUARTILE: 3,
  FOURTH_QUARTILE: 4,
};

async function fetchGitHub(axisByDate) {
  const token = process.env.GITHUB_TOKEN;
  if (!token) return { configured: false, total: 0, error: 'GITHUB_TOKEN not set' };

  const query = `query($login: String!) {
    user(login: $login) {
      contributionsCollection {
        contributionCalendar {
          totalContributions
          weeks { contributionDays { date contributionCount contributionLevel } }
        }
      }
    }
  }`;

  const res = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'User-Agent': 'wodesite-heatmaps',
    },
    body: JSON.stringify({ query, variables: { login: GITHUB_LOGIN } }),
  });

  if (!res.ok) throw new Error(`GitHub API ${res.status}`);
  const json = await res.json();
  if (json.errors) throw new Error(json.errors.map((e) => e.message).join('; '));

  const cal = json.data.user.contributionsCollection.contributionCalendar;
  for (const week of cal.weeks) {
    for (const day of week.contributionDays) {
      const cell = axisByDate.get(day.date);
      if (cell) {
        cell.count = day.contributionCount;
        cell.level = GH_LEVEL[day.contributionLevel] ?? levelFor(day.contributionCount, 1);
      }
    }
  }
  return { configured: true, total: cal.totalContributions };
}

async function fetchMonkeytype(axisByDate, sinceMs) {
  const key = process.env.MONKEYTYPE_APE_KEY;
  if (!key) return { configured: false, total: 0, error: 'MONKEYTYPE_APE_KEY not set' };

  const headers = { Authorization: `ApeKey ${key}`, 'User-Agent': 'wodesite-heatmaps' };
  const perDay = new Map();
  let offset = 0;
  const limit = 1000;
  const MAX_PAGES = 5; // free history is capped; guard against runaways

  for (let page = 0; page < MAX_PAGES; page += 1) {
    const url = `https://api.monkeytype.com/results?limit=${limit}&offset=${offset}&onOrAfterTimestamp=${sinceMs}`;
    const res = await fetch(url, { headers });
    if (!res.ok) {
      if (offset > 0) break; // partial data already collected
      throw new Error(`Monkeytype API ${res.status}`);
    }
    const json = await res.json();
    const results = Array.isArray(json.data) ? json.data : [];
    for (const r of results) {
      if (typeof r.timestamp !== 'number') continue;
      const date = isoDate(new Date(r.timestamp));
      perDay.set(date, (perDay.get(date) || 0) + 1);
    }
    if (results.length < limit) break;
    offset += limit;
  }

  let max = 0;
  for (const v of perDay.values()) if (v > max) max = v;
  let total = 0; // count only tests that land on the rendered date axis
  for (const [date, count] of perDay) {
    const cell = axisByDate.get(date);
    if (cell) {
      cell.count = count;
      cell.level = levelFor(count, max);
      total += count;
    }
  }
  return { configured: true, total };
}

module.exports = async function handler(req, res) {
  const axis = buildAxis();
  const sinceMs = new Date(axis.start + 'T00:00:00.000Z').getTime();

  // Separate day arrays so each grid carries its own counts/levels on a shared axis.
  const githubDays = axis.days.map((d) => ({ ...d }));
  const monkeytypeDays = axis.days.map((d) => ({ ...d }));
  const githubByDate = new Map(githubDays.map((d) => [d.date, d]));
  const monkeytypeByDate = new Map(monkeytypeDays.map((d) => [d.date, d]));

  const [github, monkeytype] = await Promise.all([
    fetchGitHub(githubByDate).catch((e) => ({ configured: true, total: 0, error: e.message })),
    fetchMonkeytype(monkeytypeByDate, sinceMs).catch((e) => ({ configured: true, total: 0, error: e.message })),
  ]);

  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400');
  res.status(200).json({
    start: axis.start,
    end: axis.end,
    github: { ...github, days: githubDays },
    monkeytype: { ...monkeytype, days: monkeytypeDays },
  });
};
