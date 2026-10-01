/* global JSZip, MealimeTransform, MealimeCookbook */
'use strict';

const T = MealimeTransform;
const IMAGE_CONCURRENCY = 6;
const RECIPE_CONCURRENCY = 6;
const APP_API = 'https://app.mealime.com/api/favourites';
const MY_API = 'https://api.mealime.com/api/v2/get_user';
const MY_CDN = 'https://cdn-recipes.mealime.com/';

const $ = (id) => document.getElementById(id);
const sourceTabId = Number(new URLSearchParams(location.search).get('tab'));
const NOT_ON_MEALIME = 'Go to app.mealime.com or my.mealime.com, log in, and click the extension icon from that tab.';

class NotReady extends Error {}

let source = null;  // the adapter for the tab we were launched from
let cached = null;  // account data from the last successful check
let lastZip = null;
let lastName = null;

// ---------------------------------------------------------------------------
// Source adapters. Each one's check() returns account data plus counts for the
// "ready" line; load() turns it into { raw, mealPlanRaw, userRecipes, notes,
// rawFiles, failed } for the shared export pipeline.
// ---------------------------------------------------------------------------

// app.mealime.com: cookie session. Unchanged from 0.1: one call, full recipes inline.
const appSource = {
  site: 'app.mealime.com',
  loginUrl: 'https://app.mealime.com/',
  async check(tab) {
    const [{ result } = {}] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      world: 'MAIN',
      func: async (url) => {
        try {
          const r = await fetch(url, { credentials: 'include', headers: { Accept: 'application/json' } });
          return { ok: r.ok, status: r.status, text: await r.text() };
        } catch (e) { return { ok: false, status: 0, text: String(e) }; }
      },
      args: [APP_API],
    });
    const loginMsg = 'You don\'t seem to be logged in to Mealime in that tab. Log in, then try again.';
    if (!result || !result.ok) throw new NotReady(result && result.status === 0 ? 'Couldn\'t reach Mealime. Check your connection and try again.' : loginMsg);
    let body;
    try { body = JSON.parse(result.text); } catch { throw new NotReady(loginMsg); }
    if (!body || !Array.isArray(body.favourites)) throw new NotReady(loginMsg);
    const n = body.favourites.length;
    return {
      data: { body, text: result.text },
      total: n,
      summary: n ? `Found ${n} favourite${n === 1 ? '' : 's'} in your Mealime account.` : 'Your Mealime favourites list is empty.',
    };
  },
  async load({ body, text }) {
    return {
      raw: T.extractRecipes(body),
      mealPlanRaw: [],
      userRecipes: [],
      notes: {},
      rawFiles: { 'raw/mealime-favourites-api.json': text },
      failed: [],
    };
  },
};

// my.mealime.com: token auth against api.mealime.com; favourites are references
// that resolve to full recipes on the public recipe CDN.
const mySource = {
  site: 'my.mealime.com',
  loginUrl: 'https://my.mealime.com/',
  async check(tab) {
    // Runs in the extension's isolated world inside the user's my.mealime.com tab. The login token is
    // read and used only there, exactly as the site itself does, and only recipe data is returned,
    // so the token and account details (email, subscription, etc.) never reach this page.
    const [{ result } = {}] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: async (apiUrl) => {
        const stored = localStorage.getItem('mealimeAuthToken');
        let token = stored;
        try { token = JSON.parse(stored); } catch (e) { /* stored as a bare string */ }
        if (typeof token !== 'string' || !token) return { error: 'no_token' };
        let res;
        try {
          res = await fetch(apiUrl, {
            method: 'POST',
            credentials: 'omit',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: `Token token=${token}` },
            body: '{}',
          });
        } catch (e) { return { error: 'network' }; }
        if (res.status === 401 || res.status === 403) return { error: 'expired' };
        if (!res.ok) return { error: 'http', status: res.status };
        let u;
        try { u = await res.json(); } catch (e) { return { error: 'bad_json' }; }
        // Allow-list: copy only what the export needs.
        const plan = u.current_meal_plan || {};
        const recipesOf = (meals) => (Array.isArray(meals) ? meals : []).map((m) => m && m.recipe).filter(Boolean);
        return {
          data: {
            favourites: (u.favourites || []).map((f) => ({
              id: f.id, recipe_variant_id: f.recipe_variant_id, published_recipe_uuid: f.published_recipe_uuid,
            })),
            meal_plan_recipes: recipesOf(plan.meals).concat(recipesOf(plan.previous_meal_plan_meals)),
            user_recipes: (u.user_recipes || []).map((r) => ({
              uid: r.uid, name: r.name, body: r.body, ingredients: r.ingredients, is_deleted: r.is_deleted,
              import_url: r.import_url, thumbnail_image_url: r.thumbnail_image_url,
              presentation_image_url: r.presentation_image_url, base_servings: r.base_servings,
            })),
            recipe_notes: u.recipe_notes && typeof u.recipe_notes === 'object' ? u.recipe_notes : {},
          },
        };
      },
      args: [MY_API],
    });
    if (!result) throw new Error('Couldn\'t run in the Mealime tab. Reload it and try again.');
    if (result.error === 'no_token') throw new NotReady('Please log in to my.mealime.com, then try again.');
    if (result.error === 'expired') throw new NotReady('Your Mealime session has expired. Log in to my.mealime.com again, then try again.');
    if (result.error === 'network') throw new NotReady('Couldn\'t reach Mealime. Check your connection and try again.');
    if (result.error) throw new NotReady(`Mealime returned an unexpected response (${result.status || result.error}). Reload my.mealime.com and try again.`);

    const d = result.data;
    const favs = d.favourites.filter((f) => f.published_recipe_uuid).length;
    const plan = T.dedupeRaw(d.meal_plan_recipes).length;
    const mine = d.user_recipes.filter((r) => r && r.is_deleted !== true).length;
    const notes = Object.values(d.recipe_notes).filter((v) => typeof v === 'string' && v.trim()).length;
    const parts = [
      `${favs} favourite${favs === 1 ? '' : 's'}`,
      plan ? `${plan} meal-plan recipe${plan === 1 ? '' : 's'}` : '',
      mine ? `${mine} of your own recipe${mine === 1 ? '' : 's'}` : '',
      notes ? `${notes} recipe note${notes === 1 ? '' : 's'}` : '',
    ].filter(Boolean);
    const total = favs + plan + mine;
    return {
      data: d,
      total,
      summary: total ? `Found ${parts.slice(0, -1).join(', ')}${parts.length > 1 ? ' and ' : ''}${parts[parts.length - 1]}.` : 'There are no recipes in your Mealime account to export.',
    };
  },
  async load(d, progress) {
    const refs = d.favourites.filter((f) => f.published_recipe_uuid);
    const favRaw = new Array(refs.length);
    const failed = [];
    let done = 0;
    await pool(refs.map((f, i) => async () => {
      const recipe = await fetchJsonWithRetry(`${MY_CDN}${encodeURIComponent(f.published_recipe_uuid)}.json`);
      if (recipe && recipe.name) favRaw[i] = recipe;
      else failed.push(f.published_recipe_uuid);
      progress(++done, refs.length);
    }), RECIPE_CONCURRENCY);
    const fetched = favRaw.filter(Boolean);
    return {
      raw: fetched,
      mealPlanRaw: d.meal_plan_recipes,
      userRecipes: d.user_recipes,
      notes: d.recipe_notes,
      rawFiles: {
        'raw/my-mealime-account.json': JSON.stringify(d, null, 2),
        'raw/cdn-recipes.json': JSON.stringify(fetched, null, 2),
      },
      failed,
    };
  },
};

const SOURCES = { 'app.mealime.com': appSource, 'my.mealime.com': mySource };

// ---------------------------------------------------------------------------

async function pool(tasks, n) {
  const queue = tasks.slice();
  await Promise.all(Array.from({ length: Math.min(n, queue.length) }, async () => {
    while (queue.length) await queue.shift()();
  }));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchJsonWithRetry(url) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url, { credentials: 'omit', headers: { Accept: 'application/json' } });
      if (res.ok) return await res.json();
    } catch (e) { /* retry below */ }
    if (attempt === 0) await sleep(600 + Math.random() * 600);
  }
  return null;
}

async function fetchImage(urls) {
  for (const url of urls.filter(Boolean)) {
    try {
      const res = await fetch(url, { credentials: 'omit' });
      if (!res.ok) continue;
      const blob = await res.blob();
      if (blob.size && /^image\//.test(blob.type || 'image/')) return blob;
    } catch (e) { /* try next url */ }
  }
  return null;
}

function setProgress(fraction, message) {
  $('status').hidden = false;
  $('fill').style.width = `${Math.round(Math.max(0, Math.min(1, fraction)) * 100)}%`;
  if (message) $('msg').textContent = message;
}

function showError(err) {
  $('error').hidden = false;
  $('errmsg').textContent = err.message || String(err);
  $('openMealime').hidden = !(err instanceof NotReady);
  $('openMealime').href = (source && source.loginUrl) || 'https://app.mealime.com/';
}

// The export only ever talks to the Mealime tab the user launched it from.
async function getSourceTab() {
  if (!Number.isInteger(sourceTabId)) throw new NotReady(NOT_ON_MEALIME);
  let tab;
  try { tab = await chrome.tabs.get(sourceTabId); } catch { throw new NotReady('The Mealime tab you started from was closed. ' + NOT_ON_MEALIME); }
  let host = null;
  try { host = new URL(tab.url).host; } catch { /* no access to this tab's URL: not a Mealime site */ }
  source = SOURCES[host] || null;
  if (!source || !tab.url.startsWith('https://')) throw new NotReady(NOT_ON_MEALIME);
  return tab;
}

// Checks the source tab on load (and when the user comes back to this page) and enables Export.
async function check() {
  if ($('go').dataset.running) return;
  $('error').hidden = true;
  $('go').disabled = true;
  $('ready').textContent = 'Checking your Mealime tab…';
  try {
    const tab = await getSourceTab();
    const found = await source.check(tab);
    cached = found;
    $('ready').textContent = found.summary;
    $('go').disabled = !found.total;
  } catch (err) {
    cached = null;
    $('ready').textContent = '';
    showError(err);
  }
}

async function runExport() {
  $('go').disabled = true;
  $('go').dataset.running = '1';
  $('error').hidden = true;
  $('done').hidden = true;
  try {
    if (!cached) { const tab = await getSourceTab(); cached = await source.check(tab); }
    const isMy = source === mySource;
    setProgress(0.02, isMy ? 'Fetching your recipes from Mealime…' : 'Fetching your favourites from Mealime…');
    const loaded = await source.load(cached.data, (n, total) =>
      setProgress(0.02 + 0.4 * (n / total), `Fetched ${n} / ${total} recipes…`));
    const photoStart = isMy ? 0.45 : 0.05;

    // Favourites first, then meal-plan recipes not already favourited (by variant id).
    const favRaw = T.dedupeRaw(loaded.raw);
    const raw = T.dedupeRaw(favRaw, loaded.mealPlanRaw);
    const userList = (loaded.userRecipes || []).filter((u) => u && u.is_deleted !== true && u.name);
    if (!raw.length && !userList.length) throw new Error('There are no recipes to export.');
    const slugs = T.uniqueSlugs([...raw, ...userList.map((u) => ({ name: u.name }))]);
    const rawSlugs = slugs.slice(0, raw.length);
    const userSlugs = slugs.slice(raw.length);

    const withPhotos = $('photos').checked;
    const blobs = {};
    if (withPhotos) {
      const jobs = [
        ...raw.map((r, i) => ({ slug: rawSlugs[i], urls: [r.presentation_image_url, r.thumbnail_image_url] })),
        ...userList.map((u, i) => ({ slug: userSlugs[i], urls: [u.presentation_image_url, u.thumbnail_image_url] })),
      ].filter((j) => j.urls.some(Boolean));
      let done = 0;
      setProgress(photoStart, `Downloading photos (0 of ${jobs.length})…`);
      await pool(jobs.map((j) => async () => {
        blobs[j.slug] = await fetchImage(j.urls);
        done++;
        setProgress(photoStart + (0.85 - photoStart) * (done / jobs.length), `Downloading photos (${done} of ${jobs.length})…`);
      }), IMAGE_CONCURRENCY);
    }
    const typeOf = (s) => (blobs[s] ? blobs[s].type : null);
    const recipes = T.normalize(raw, Object.fromEntries(rawSlugs.map((s) => [s, typeOf(s)])), rawSlugs, loaded.notes);
    const custom = T.normalizeCustom(userList, Object.fromEntries(userSlugs.map((s) => [s, typeOf(s)])), userSlugs);
    const all = [...recipes, ...custom];
    // Custom recipes without any photo aren't "missing" a photo; Mealime recipes are listed as before.
    const missing = withPhotos ? all.filter((r) => !r.image && (r.uid === undefined || r.source_image_url)).map((r) => r.name) : [];

    setProgress(0.88, 'Building your cookbook…');
    const version = chrome.runtime.getManifest().version;
    const meta = { exporter: `mealime-exporter ${version}` };
    let groups = null;
    let extra;
    if (isMy) {
      const favIds = new Set(favRaw.map((r) => r.id));
      const planIds = new Set((loaded.mealPlanRaw || []).filter(Boolean).map((r) => r.id));
      groups = {
        favourites: recipes.filter((r, i) => favIds.has(raw[i].id)).map((r) => r.slug),
        meal_plan: recipes.filter((r, i) => planIds.has(raw[i].id)).map((r) => r.slug),
        mine: custom.map((r) => r.slug),
      };
      meta.source = 'Mealime (my.mealime.com): favourites, meal plan and custom recipes';
      meta.collections = { favourites: groups.favourites, meal_plan: groups.meal_plan };
      const exportedIds = new Set(recipes.map((r) => String(r.id)));
      meta.unmatchedNotes = Object.fromEntries(Object.entries(loaded.notes || {})
        .filter(([id, v]) => !exportedIds.has(String(id)) && typeof v === 'string' && v.trim())
        .map(([id, v]) => [id, v.trim()]));
      extra = {
        heading: `Mealime export from my.mealime.com (${recipes.length} recipes + ${custom.length} of your own)`,
        customCount: custom.length,
        notesCount: recipes.filter((r) => r.note).length,
        unmatchedNotesCount: Object.keys(meta.unmatchedNotes).length,
        failedRecipes: loaded.failed,
        rawNote: 'Recipe data as Mealime returned it. Account details (email, login token, subscription) are deliberately left out.',
      };
    }

    const zip = new JSZip();
    const root = zip.folder('mealime-recipes');
    root.file('index.html', MealimeCookbook.buildCookbook(all, T.NUTRITION_UNITS, undefined, groups || undefined));
    root.file('recipes.json', JSON.stringify(T.toRecipesJson(recipes, meta, custom), null, 2));
    for (const [p, body] of Object.entries(loaded.rawFiles)) root.file(p, body);
    root.file('README.txt', T.readme(recipes, missing, extra));
    for (const r of all) {
      root.file(`markdown/${r.slug}.md`, T.toMarkdown(r));
      root.file(`schema-org/${r.slug}.json`, JSON.stringify(T.toSchemaOrg(r), null, 2));
      if (r.image) root.file(r.image, blobs[r.slug], { compression: 'STORE' });
    }
    lastZip = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } },
      (m) => setProgress(0.88 + 0.1 * (m.percent / 100)));
    lastName = `mealime-recipes-${new Date().toISOString().slice(0, 10)}.zip`;

    await download();
    setProgress(1, 'Done.');
    const size = lastZip.size >= 1e6 ? `${(lastZip.size / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(lastZip.size / 1e3))} KB`;
    const what = isMy
      ? `${recipes.length} recipes${custom.length ? ` and ${custom.length} of your own` : ''}`
      : `${recipes.length} recipes`;
    $('donemsg').textContent = `Saved ${what} to ${lastName} (${size}) in your downloads folder.` +
      (loaded.failed.length ? ` ${loaded.failed.length} recipe(s) couldn't be downloaded; they're listed in README.txt.` : '') +
      (missing.length ? ` ${missing.length} photo(s) couldn't be downloaded; they're listed in README.txt.` : '');
    $('done').hidden = false;
  } catch (err) {
    console.error(err);
    showError(err);
  } finally {
    delete $('go').dataset.running;
    $('go').disabled = !cached;
  }
}

async function download() {
  const url = URL.createObjectURL(lastZip);
  try {
    await chrome.downloads.download({ url, filename: lastName, saveAs: false });
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
}

$('go').addEventListener('click', runExport);
$('again').addEventListener('click', () => lastZip && download());
document.addEventListener('visibilitychange', () => { if (!document.hidden && !cached) check(); });
check();
