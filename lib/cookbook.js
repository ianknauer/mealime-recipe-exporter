// Builds the self-contained offline cookbook (index.html) from normalised recipes.
(function (root) {
  'use strict';

  const CSS = `
:root{--bg:#F3EBDD;--card:#FFFAF0;--ink:#2B1E16;--mut:#7B6A58;--line:#E4D6C0;--acc:#C63F2A;--chip:#FBEBC0}
@media (prefers-color-scheme:dark){:root{--bg:#1B1511;--card:#2A211B;--ink:#F4E7D2;--mut:#A8957E;--line:#3E3229;--acc:#E8664E;--chip:#3A301C}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
header{position:sticky;top:0;z-index:2;background:var(--bg);border-bottom:1px solid var(--line);padding:14px 16px;display:flex;gap:12px;align-items:center;flex-wrap:wrap}
h1{font-size:20px;margin:0;flex:1 1 auto}h1 small{color:var(--mut);font-weight:400;font-size:14px;margin-left:6px}
input{flex:1 1 260px;max-width:420px;padding:9px 12px;border:1px solid var(--line);border-radius:10px;background:var(--card);color:var(--ink);font-size:15px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:16px;padding:16px;max-width:1300px;margin:0 auto}
.c{background:var(--card);border:1px solid var(--line);border-radius:14px;overflow:hidden;cursor:pointer;text-align:left;padding:0;color:inherit;font:inherit;display:flex;flex-direction:column}
.c:hover{border-color:var(--acc)}.c img,.c .ph{width:100%;aspect-ratio:4/3;object-fit:cover;display:block;background:var(--line)}
.c div{padding:10px 12px 12px;font-size:14px;font-weight:600}.c span{display:block;color:var(--mut);font-weight:400;font-size:13px;margin-top:4px}
#d{max-width:880px;margin:0 auto;padding:16px 16px 60px}#d[hidden],.grid[hidden]{display:none}
.back{border:1px solid var(--line);background:var(--card);color:var(--ink);border-radius:10px;padding:7px 12px;cursor:pointer;font:inherit}
.hero{width:100%;border-radius:14px;margin:14px 0;max-height:460px;object-fit:cover}
h2{font-size:26px;line-height:1.25;margin:6px 0}h3{margin:28px 0 10px;font-size:17px;border-bottom:1px solid var(--line);padding-bottom:6px}
.meta{color:var(--mut)}.meta b{color:var(--ink)}ul.ing{list-style:none;padding:0;columns:2 240px;margin:0}ul.ing li{padding:5px 0;break-inside:avoid;border-bottom:1px dashed var(--line)}ul.ing b{font-weight:600}
ol.st{padding-left:22px}ol.st li{margin:0 0 14px}.u{display:flex;flex-wrap:wrap;gap:6px;margin-top:6px}.u i{font-style:normal;font-size:13px;background:var(--chip);border-radius:20px;padding:2px 9px}
.macros{display:grid;grid-template-columns:repeat(auto-fill,minmax(110px,1fr));gap:10px}.macros div{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:10px}.macros b{display:block;font-size:20px}.macros small{color:var(--mut)}
.tabs{display:flex;gap:8px;flex-wrap:wrap;padding:12px 16px 0;max-width:1300px;margin:0 auto}.tabs[hidden]{display:none}
.tabs button{font:inherit;font-size:14px;border:1px solid var(--line);background:var(--card);color:var(--ink);border-radius:20px;padding:5px 12px;cursor:pointer}
.tabs button[aria-pressed=true]{background:var(--acc);border-color:var(--acc);color:var(--bg)}
.note{background:var(--chip);border-radius:10px;padding:10px 14px;margin:14px 0 0;white-space:pre-wrap}.note b{display:block;font-size:13px;color:var(--mut);margin-bottom:2px}
a{color:var(--acc)}.none{color:var(--mut);font-style:italic}
details{margin-top:12px}summary{cursor:pointer;color:var(--acc)}table{border-collapse:collapse;width:100%;font-size:14px;margin-top:8px}td{padding:4px 6px;border-bottom:1px solid var(--line)}td:last-child{text-align:right}
`;

  // Runs inside the exported page. Kept as a real function so it is linted/tested, then stringified.
  function app(R, U, G) {
    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const f = (v) => (v == null ? '–' : (Math.round(v * 10) / 10).toLocaleString());
    const g = document.getElementById('g'), d = document.getElementById('d'), q = document.getElementById('q');
    const T = document.getElementById('t');
    const LABELS = { favourites: 'Favourites', meal_plan: 'Meal plan', mine: 'My recipes' };
    const groups = Object.keys(LABELS).filter((k) => G && G[k] && G[k].length);
    let active = 'all';
    if (groups.length > 1) {
      T.hidden = false;
      T.innerHTML = [['all', 'All']].concat(groups.map((k) => [k, LABELS[k]])).map(([k, l]) =>
        '<button data-g="' + k + '" aria-pressed="' + (k === active) + '">' + l + ' <small>' + (k === 'all' ? R.length : G[k].length) + '</small></button>').join('');
      T.onclick = (e) => {
        const b = e.target.closest('button'); if (!b) return;
        active = b.dataset.g;
        T.querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
        list();
      };
    }
    const inGroup = (r) => active === 'all' || G[active].indexOf(r.slug) !== -1;
    const safeUrl = (u) => (/^https?:\/\//i.test(u || '') ? u : null);
    const img = (r, cls) => (r.image
      ? '<img ' + (cls ? 'class="' + cls + '" ' : '') + 'loading="lazy" alt="" src="' + esc(r.image) + '">'
      : (cls ? '' : '<span class="ph"></span>'));
    function list() {
      const t = q.value.toLowerCase().trim();
      const rs = R.filter(inGroup).filter((r) => !t || r.name.toLowerCase().includes(t) || r.ingredients.some((i) => i.name.toLowerCase().includes(t)));
      document.getElementById('count').textContent = rs.length + ' recipes';
      g.innerHTML = rs.map((r) => '<button class="c" data-s="' + esc(r.slug) + '">' + img(r) + '<div>' + esc(r.name) +
        '<span>' + [r.cook_minutes != null ? r.cook_minutes + ' min' : '', r.nutrition_per_serving && r.nutrition_per_serving.energy != null ? Math.round(r.nutrition_per_serving.energy) + ' kcal' : '', r.uid != null ? 'My recipe' : ''].filter(Boolean).join(' · ') + '</span></div></button>').join('');
    }
    function show(s) {
      const r = R.find((x) => x.slug === s);
      if (!r) { d.hidden = true; g.hidden = false; return; }
      const n = r.nutrition_per_serving || {};
      const M = [['energy', 'Calories'], ['protein', 'Protein'], ['carbs', 'Carbs'], ['fat', 'Fat'], ['fiber', 'Fiber'], ['sugars', 'Sugars'], ['saturated', 'Sat. fat'], ['sodium', 'Sodium']];
      d.innerHTML = '<button class="back" id="back">← All recipes</button>' + img(r, 'hero') +
        '<h2>' + esc(r.name) + '</h2><div class="meta">' + [r.servings != null ? '<b>' + esc(r.servings) + '</b> servings' : '', r.cook_minutes != null ? '<b>' + esc(r.cook_minutes) + '</b> min' : '',
          safeUrl(r.import_url) ? '<a href="' + esc(r.import_url) + '" target="_blank" rel="noopener noreferrer">Original source</a>' : ''].filter(Boolean).join(' · ') + '</div>' +
        (r.note ? '<p class="note"><b>My note</b>' + esc(r.note) + '</p>' : '') +
        '<h3>Ingredients</h3>' + (r.ingredients.length ? '' : '<p class="none">None listed.</p>') + '<ul class="ing">' + r.ingredients.map((i) => '<li><b>' + esc(i.quantity) + '</b> ' + esc(i.name) + '</li>').join('') + '</ul>' +
        '<h3>Instructions</h3>' + (r.steps.length ? '' : '<p class="none">None listed.</p>') + '<ol class="st">' + r.steps.map((x) => '<li>' + esc(x.text) + (x.uses.length ? '<div class="u">' + x.uses.map((u) => '<i>' + esc(u) + '</i>').join('') + '</div>' : '') + '</li>').join('') + '</ol>' +
        (Object.keys(n).length ? '<h3>Nutrition per serving</h3><div class="macros">' + M.map(([k, l]) => '<div><b>' + f(n[k]) + '</b><small>' + (k === 'energy' ? '' : (U[k] || '')) + ' ' + l + '</small></div>').join('') + '</div>' +
          '<details><summary>Full nutrient breakdown</summary><table>' + Object.entries(n).map(([k, v]) => '<tr><td>' + esc(k.replace(/_/g, ' ')) + '</td><td>' + f(v) + (U[k] ? ' ' + U[k] : '') + '</td></tr>').join('') + '</table></details>' : '') +
        (r.cookware.length ? '<h3>Cookware</h3><div class="u">' + r.cookware.map((c) => '<i>' + esc(c) + '</i>').join('') + '</div>' : '');
      document.getElementById('back').onclick = () => { location.hash = ''; };
      g.hidden = true; d.hidden = false; window.scrollTo(0, 0);
    }
    g.onclick = (e) => { const b = e.target.closest('.c'); if (b) location.hash = b.dataset.s; };
    q.oninput = list;
    window.onhashchange = () => show(decodeURIComponent(location.hash.slice(1)));
    list(); show(decodeURIComponent(location.hash.slice(1)));
  }

  const safeJson = (v) => JSON.stringify(v).replace(/[<\u2028\u2029]/g, (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));

  // groups (optional): { favourites: slug[], meal_plan: slug[], mine: slug[] }. Filter buttons appear only
  // when two or more groups are non-empty.
  function buildCookbook(recipes, units, title, groups) {
    const t = String(title || 'My Recipe Box').replace(/[<&]/g, '');
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${t}</title><style>${CSS}</style></head><body>
<header><h1>${t}<small id="count"></small></h1><input id="q" type="search" placeholder="Search recipes or ingredients…"></header>
<nav class="tabs" id="t" hidden></nav><main class="grid" id="g"></main><article id="d" hidden></article>
<script>(${app.toString()})(${safeJson(recipes)}, ${safeJson(units)}, ${safeJson(groups || {})});</script></body></html>`;
  }

  const api = { buildCookbook };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.MealimeCookbook = api;
})(typeof self !== 'undefined' ? self : this);
