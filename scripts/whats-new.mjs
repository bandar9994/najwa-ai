// Najwa AI — © 2026 Bandar Altariqi. All rights reserved.
// Licensed under the Najwa AI License (see LICENSE): non-commercial use only;
// keep the Najwa AI name and the "Najwa AI by Bandar Altariqi" credit; no rebranding.

// "What's new" for a release: the changes since the previous one, one line per
// change, from the commits in between. Shown in the release notes (GitHub,
// Obtainium, Orion Store) and on Google Play.
//
//   node scripts/whats-new.mjs --platform android --since <commit> [--max-chars 500]
//
// In a workflow (GITHUB_REPOSITORY, GITHUB_SHA, GH_TOKEN). Prints the list, or
// nothing when it can't tell (no previous release, GitHub unreachable): the
// notes then go out without it, and the release is never held up.
//
// A change is a commit's first line. A commit can say it differently, or leave
// itself out, with lines in its message like:
//   What's new: Replies on the phone stop at the end of their turn
//   What's new: none
// Commits that only change things people don't see (tests, the build, the
// website, docs), or only another platform's app, are left out.

const API = 'https://api.github.com';

// Where a file belongs: what it changes for people.
export function area(file) {
  if (/^(\.github|\.claude|test|scripts|docs|site|brag-output|www)\//.test(file)) return 'internal';
  if (/^(README\.md|package-lock\.json|\.gitignore|CLAUDE\.md)$/.test(file)) return 'internal';
  if (/^android\//.test(file)) return 'android';
  if (/^ios\//.test(file)) return 'ios';
  if (/^(mobile|native)\//.test(file) || file === 'capacitor.config.json' || file === 'src/turn-guard.js') return 'mobile';
  if (/^(main\.js|preload\.js|build\/)/.test(file) || /^src\/.*-desktop\.js$/.test(file)) return 'desktop';
  return 'shared';
}

const SEEN_BY = {
  android: new Set(['shared', 'mobile', 'android']),
  ios: new Set(['shared', 'mobile', 'ios']),
  desktop: new Set(['shared', 'desktop'])
};

// The lines a commit adds to "What's new" for this platform ([] for none).
export function linesFor(commit, platform) {
  const message = String(commit.message || '');
  const subject = message.split('\n')[0];
  if ((commit.parents && commit.parents.length > 1) || /^Merge (branch|pull request|remote-tracking)/.test(subject)) return [];
  const said = [...message.matchAll(/^What's new:[ \t]*(.*)$/gim)].map((m) => m[1].trim());
  if (said.length && said.every((s) => !s || /^(none|-)$/i.test(s))) return [];
  const seen = SEEN_BY[platform] || SEEN_BY.android;
  if (commit.files && commit.files.length && !commit.files.some((f) => seen.has(area(f)))) return [];
  const lines = said.length ? said.filter((s) => s && !/^(none|-)$/i.test(s)) : [subject];
  return lines.map((l) => l.replace(/\s+/g, ' ').trim().replace(/\.$/, '')).filter(Boolean);
}

/**
 * The list ("- one\n- two"), newest change first.
 * @param commits [{ message, files, parents }], oldest first (as GitHub lists them)
 */
export function whatsNew(commits, { platform = 'android', maxItems = 12, maxChars = 0 } = {}) {
  if (!commits.length) return '';
  const lines = [];
  for (const c of [...commits].reverse()) {
    for (const l of linesFor(c, platform)) if (!lines.includes(l)) lines.push(l);
  }
  if (!lines.length) return '- Fixes behind the scenes; nothing you will notice';
  const render = (n) => {
    const shown = lines.slice(0, n).map((l) => `- ${l}`);
    if (n < lines.length) shown.push(`- …and ${lines.length - n} more`);
    return shown.join('\n');
  };
  let n = Math.min(maxItems, lines.length);
  while (maxChars && n > 1 && render(n).length > maxChars) n--;
  let out = render(n);
  if (maxChars && out.length > maxChars) out = out.slice(0, maxChars - 1) + '…';
  return out;
}

// The commits after `since` up to `head`, with the files each one changed.
export async function commitsBetween({ repo, since, head, token, fetch = globalThis.fetch, limit = 40 }) {
  const get = async (path) => {
    const res = await fetch(`${API}/repos/${repo}/${path}`, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'najwa-ai-release-notes', ...(token ? { Authorization: `Bearer ${token}` } : {}) }
    });
    if (!res.ok) throw new Error(`GitHub ${res.status} for ${path}`);
    return res.json();
  };
  const cmp = await get(`compare/${since}...${head}?per_page=250`);
  const list = (cmp.commits || []).slice(-limit);
  return Promise.all(list.map(async (c) => {
    const full = await get(`commits/${c.sha}`);
    return { message: c.commit.message, parents: c.parents, files: (full.files || []).map((f) => f.filename) };
  }));
}

function args(argv) {
  const a = {};
  for (let i = 0; i < argv.length; i++) if (argv[i].startsWith('--')) a[argv[i].slice(2)] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : 'true';
  return a;
}

async function main() {
  const a = args(process.argv.slice(2));
  const repo = process.env.GITHUB_REPOSITORY;
  const head = a.head || process.env.GITHUB_SHA;
  const since = (a.since || '').trim();
  if (!repo || !head || !since || since === head) return;
  try {
    const commits = await commitsBetween({ repo, since, head, token: process.env.GH_TOKEN || process.env.GITHUB_TOKEN });
    const text = whatsNew(commits, { platform: a.platform || 'android', maxChars: Number(a['max-chars']) || 0 });
    if (text) process.stdout.write(text + '\n');
  } catch (err) {
    console.error(`::warning::No "What's new" for this release: ${err.message}`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) main();
