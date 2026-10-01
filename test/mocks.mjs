import fs from 'node:fs'; import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
export const appFixture = require('./fixture.js');
export const png = fs.readFileSync(new URL('../icons/icon128.png', import.meta.url));
const html = (t) => ({ status: 200, contentType: 'text/html', body: `<title>${t}</title><h1>${t}</h1>` });

export const cdnUploads = ['https://cdn-uploads.mealime.com/**', (r) => r.request().url().includes('/861/')
  ? r.fulfill({ status: 404, body: 'nope' }) : r.fulfill({ status: 200, contentType: 'image/png', body: png })];

export function appRoutes({ loggedOut = false } = {}) {
  return [['https://app.mealime.com/**', (r) => {
    const req = r.request();
    if (!req.url().includes('/api/')) return r.fulfill(html('Mealime'));
    if ((req.headers().origin || '').startsWith('chrome-extension://')) return r.fulfill({ status: 403, body: 'extension origin' });
    if (loggedOut) return r.fulfill({ status: 401, body: '{"error":"unauthorized"}' });
    return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(appFixture) });
  }], cdnUploads];
}

export const my = require('./my-fixture.js');
const CORS = {
  'access-control-allow-origin': 'https://my.mealime.com',
  'access-control-allow-headers': 'authorization, content-type, accept',
  'access-control-allow-methods': 'POST, OPTIONS',
};

// log: collects { url, origin, auth } for every API / CDN request so tests can assert on them.
export function myRoutes({ expired = false, log = [] } = {}) {
  const flaky = { n: 0 };
  return [
    ['https://my.mealime.com/**', (r) => r.fulfill(html('My Mealime'))],
    ['https://api.mealime.com/**', (r) => {
      const req = r.request(); const h = req.headers();
      if (req.method() === 'OPTIONS') return r.fulfill({ status: 204, headers: CORS });
      log.push({ url: req.url(), origin: h.origin, auth: h.authorization || null });
      if (h.origin !== 'https://my.mealime.com') return r.fulfill({ status: 403, body: 'bad origin' });
      if (expired || h.authorization !== `Token token=${my.SECRET_TOKEN}`) return r.fulfill({ status: 401, headers: CORS, body: '{"error":"unauthorized"}' });
      return r.fulfill({ status: 200, contentType: 'application/json', headers: CORS, body: JSON.stringify(my.getUser) });
    }],
    ['https://cdn-recipes.mealime.com/**', (r) => {
      const req = r.request(); const h = req.headers();
      log.push({ url: req.url(), origin: h.origin || null, auth: h.authorization || null, cookie: h.cookie || null });
      const uuid = decodeURIComponent(new URL(req.url()).pathname.slice(1).replace(/\.json$/, ''));
      if (uuid === 'uuid-flaky' && flaky.n++ === 0) return r.fulfill({ status: 500, body: 'oops' });
      const body = my.cdn[uuid];
      return body ? r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) }) : r.fulfill({ status: 404, body: 'not found' });
    }],
    cdnUploads,
  ];
}

export const setToken = (value) => async (page) => {
  await page.evaluate((v) => { if (v === null) localStorage.removeItem('mealimeAuthToken'); else localStorage.setItem('mealimeAuthToken', v); }, value);
};
