// End-to-end: loads the unpacked extension in Chromium with Mealime mocked and runs every scenario.
// Usage: node test/e2e.mjs [baselineDir]   (baselineDir = app.mealime.com export from a previous build)
import assert from 'node:assert/strict';
import fs from 'node:fs'; import path from 'node:path';
import { run, dump } from './harness.mjs';
import { appRoutes, myRoutes, my, setToken } from './mocks.mjs';

const ext = path.resolve(new URL('..', import.meta.url).pathname);
const baseline = process.argv[2];
const shots = process.env.SHOTS || null;
const results = [];
async function scenario(name, fn) {
  try { await fn(); results.push(['PASS', name]); } catch (e) { results.push(['FAIL', name, e.message]); }
}
const text = (files, n) => files[`mealime-recipes/${n}`].toString('utf8');
const noSecrets = (files) => {
  for (const [n, b] of Object.entries(files)) {
    const s = b.toString('latin1');
    for (const secret of [my.SECRET_TOKEN, my.SECRET_EMAIL, 'cus_SECRET', 'auth_token', 'subscription_status']) {
      assert.ok(!s.includes(secret), `${n} contains ${secret}`);
    }
  }
};

await scenario('app.mealime.com: export matches the previous version', async () => {
  const r = await run({ ext, sourceUrl: 'https://app.mealime.com/#!/favourites', routes: appRoutes() });
  assert.deepEqual(r.errors, []);
  assert.equal(r.ready, 'Found 5 favourites in your Mealime account.');
  assert.match(r.message, /^Saved 5 recipes to mealime-recipes-\d{4}-\d\d-\d\d\.zip \(\d+ KB\)/);
  if (baseline) {
    const out = '/tmp/out-new-app'; dump(r.files, out);
    const list = (d) => { const o = []; (function walk(p) { for (const f of fs.readdirSync(p)) { const q = path.join(p, f); fs.statSync(q).isDirectory() ? walk(q) : o.push(path.relative(d, q)); } })(d); return o.sort(); };
    assert.deepEqual(list(out), list(baseline), 'same set of files');
    const strip = (s) => s.replace(/"exported_at": "[^"]+"/, '').replace(/"exporter": "[^"]+"/, '');
    for (const f of list(baseline)) {
      if (f.endsWith('index.html')) continue; // template gained optional filter UI; compared separately below
      const a = fs.readFileSync(path.join(baseline, f)), b = fs.readFileSync(path.join(out, f));
      if (f.endsWith('recipes.json')) assert.equal(strip(b.toString()), strip(a.toString()), f);
      else assert.ok(a.equals(b), `${f} differs`);
    }
    const dataOf = (f) => fs.readFileSync(f, 'utf8').match(/\}\)\((\[.*?\]), \{/s)[1];
    assert.equal(dataOf(path.join(out, 'mealime-recipes/index.html')), dataOf(path.join(baseline, 'mealime-recipes/index.html')), 'cookbook data identical');
  }
});

await scenario('app.mealime.com: logged out', async () => {
  const r = await run({ ext, sourceUrl: 'https://app.mealime.com/', routes: appRoutes({ loggedOut: true }), expect: 'error' });
  assert.equal(r.message, 'You don\'t seem to be logged in to Mealime in that tab. Log in, then try again.');
});

await scenario('launched from another site', async () => {
  const r = await run({ ext, sourceUrl: 'https://example.com/', routes: [['https://example.com/**', (x) => x.fulfill({ status: 200, contentType: 'text/html', body: '<h1>x</h1>' })]], expect: 'error' });
  assert.equal(r.message, 'Go to app.mealime.com or my.mealime.com, log in, and click the extension icon from that tab.');
});

await scenario('my.mealime.com: full export', async () => {
  const log = [];
  const r = await run({ ext, sourceUrl: 'https://my.mealime.com/', routes: myRoutes({ log }), beforeLaunch: setToken(JSON.stringify(my.SECRET_TOKEN)),
    screenshot: shots && path.join(shots, 'my-done.png') });
  assert.deepEqual(r.errors, []);
  assert.equal(r.ready, 'Found 4 favourites, 3 meal-plan recipes, 2 of your own recipes and 2 recipe notes.');
  assert.match(r.message, /Saved 5 recipes and 2 of your own .* 1 recipe\(s\) couldn't be downloaded/);
  const rj = JSON.parse(text(r.files, 'recipes.json'));
  assert.deepEqual(rj.recipes.map((x) => x.id), [857, 858, 862, 870, 871], 'favourites then meal plan, deduped');
  assert.deepEqual(rj.custom_recipes.map((x) => x.name), ["Grandma's Perogies", 'Imported Dal']);
  assert.equal(rj.recipes.find((x) => x.id === 858).note, 'Use extra lime.\nKids like it mild.');
  assert.deepEqual(rj.unmatched_notes, { 9999: 'note for a recipe not exported' }, 'notes for other recipes are kept, blank ones dropped');
  assert.match(text(r.files, 'README.txt'), /1 note\(s\) belong to recipes that aren't favourites/);
  assert.deepEqual(rj.collections.favourites, ['vietnamese-grilled-steak-banh-mi', 'perfect-shrimp-pad-thai', 'flaky-cdn-chili']);
  assert.deepEqual(rj.collections.meal_plan, ['vietnamese-grilled-steak-banh-mi', 'white-bean-chicken-chili', 'grilled-turmeric-chicken']);
  assert.ok(r.files['mealime-recipes/images/grandma-s-perogies.png'], 'custom recipe photo');
  assert.ok(r.files['mealime-recipes/markdown/imported-dal.md']);
  assert.match(text(r.files, 'README.txt'), /Recipes that could not be downloaded \(recipe id \/ uuid\) \(1\):\n {2}- uuid-gone/);
  assert.ok(!/Imported Dal/.test(text(r.files, 'README.txt').split('Photos that could not')[1] || ''), 'photo-less custom recipe not listed as missing');
  noSecrets(r.files);
  const api = log.filter((x) => x.url.includes('api.mealime.com'));
  assert.ok(api.length >= 1 && api.every((x) => x.origin === 'https://my.mealime.com'), 'API called from the page origin');
  const cdn = log.filter((x) => x.url.includes('cdn-recipes'));
  assert.equal(cdn.filter((x) => x.url.includes('uuid-flaky')).length, 2, 'flaky recipe retried once');
  assert.equal(cdn.filter((x) => x.url.includes('uuid-gone')).length, 2, 'missing recipe tried twice then skipped');
  assert.ok(cdn.every((x) => !x.auth && !x.cookie), 'no credentials sent to the CDN');
  if (shots) dump(r.files, path.join(shots, 'my-export'));
});

await scenario('my.mealime.com: token stored as a bare string', async () => {
  const r = await run({ ext, sourceUrl: 'https://my.mealime.com/', routes: myRoutes(), beforeLaunch: setToken(my.SECRET_TOKEN) });
  assert.match(r.message, /^Saved 5 recipes and 2 of your own/);
});

await scenario('my.mealime.com: not logged in (no token)', async () => {
  const r = await run({ ext, sourceUrl: 'https://my.mealime.com/', routes: myRoutes(), beforeLaunch: setToken(null), expect: 'error',
    screenshot: shots && path.join(shots, 'my-notoken.png') });
  assert.equal(r.message, 'Please log in to my.mealime.com, then try again.');
  assert.deepEqual(r.errors, []);
});

await scenario('my.mealime.com: session expired (401)', async () => {
  const r = await run({ ext, sourceUrl: 'https://my.mealime.com/', routes: myRoutes({ expired: true }), beforeLaunch: setToken(JSON.stringify(my.SECRET_TOKEN)), expect: 'error' });
  assert.equal(r.message, 'Your Mealime session has expired. Log in to my.mealime.com again, then try again.');
});

for (const [s, n, e] of results) console.log(`${s}  ${n}${e ? `\n      ${e}` : ''}`);
process.exitCode = results.some(([s]) => s === 'FAIL') ? 1 : 0;
