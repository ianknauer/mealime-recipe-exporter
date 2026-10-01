const assert = require('node:assert/strict');
const test = require('node:test');
const T = require('../lib/transform');
const { buildCookbook } = require('../lib/cookbook');
const fx = require('./fixture');

test('extract + unique slugs', () => {
  const raw = T.extractRecipes(fx);
  assert.equal(raw.length, 5);
  assert.deepEqual(T.uniqueSlugs(raw).slice(1, 3), ['perfect-shrimp-pad-thai', 'perfect-shrimp-pad-thai-2']);
  assert.throws(() => T.extractRecipes({ nope: 1 }), /favourites/);
});

test('normalize shape', () => {
  const raw = T.extractRecipes(fx);
  const types = { 'vietnamese-grilled-steak-banh-mi': 'image/jpeg', 'perfect-shrimp-pad-thai': 'image/png', 'perfect-shrimp-pad-thai-2': 'image/jpeg', 'no-photo-soup': null, 'broken-photo-salad': null };
  const r = T.normalize(raw, types);
  assert.equal(r[0].id, 857);
  assert.equal(r[0].image, 'images/vietnamese-grilled-steak-banh-mi.jpg');
  assert.equal(r[1].image, 'images/perfect-shrimp-pad-thai.png');
  assert.equal(r[3].image, null);
  assert.deepEqual(r[0].steps[0].uses, ['½ shallot', '2 cloves garlic']);
  assert.deepEqual(r[0].steps[1].uses, []);
  assert.equal(r[0].ingredients[1].quantity, '');
});

test('schema.org output', () => {
  const [r] = T.normalize(T.extractRecipes(fx));
  const s = T.toSchemaOrg(r);
  assert.equal(s['@type'], 'Recipe');
  assert.equal(s.totalTime, 'PT30M');
  assert.equal(s.recipeIngredient[0], '½ head butter (Boston) lettuce');
  assert.equal(s.recipeIngredient[1], 'salt');
  assert.equal(s.nutrition.calories, '682.6 kcal');
  assert.equal(s.nutrition.sodiumContent, '1203.7 mg');
  assert.equal(s.recipeInstructions.length, 2);
});

test('markdown + cookbook escaping', () => {
  const rs = T.normalize(T.extractRecipes(fx));
  assert.match(T.toMarkdown(rs[0]), /\| energy \| 682.6 kcal \|/);
  const html = buildCookbook(rs, T.NUTRITION_UNITS);
  assert.ok(!html.includes('</script><b>'), 'recipe text must not break out of the script tag');
  assert.equal((html.match(/<\/script>/g) || []).length, 1);
});

const my = require('./my-fixture');

test('dedupeRaw keeps first occurrence by variant id', () => {
  const plan = my.getUser.current_meal_plan.meals.map((m) => m.recipe);
  const merged = T.dedupeRaw([my.cdn['uuid-banh-mi'], my.cdn['uuid-pad-thai']], plan);
  assert.deepEqual(merged.map((r) => r.recipe_id), [857, 858, 870]);
});

test('notes attach by recipe_id only when non-blank', () => {
  const rs = T.normalize([my.cdn['uuid-pad-thai'], my.getUser.current_meal_plan.meals[1].recipe], null, null, my.getUser.recipe_notes);
  assert.equal(rs[0].note, 'Use extra lime.\nKids like it mild.');
  assert.ok(!('note' in rs[1]), 'blank note is dropped');
  assert.match(T.toMarkdown(rs[0]), /## My note\n\n> Use extra lime\.\n> Kids like it mild\./);
});

test('app normalisation has no note field at all', () => {
  const rs = T.normalize(T.extractRecipes(fx));
  assert.ok(rs.every((r) => !('note' in r)));
});

test('custom recipes: skip deleted, split body, keep import url', () => {
  const c = T.normalizeCustom(my.getUser.user_recipes, { 'grandma-s-perogies': 'image/jpeg', 'imported-dal': null });
  assert.deepEqual(c.map((r) => r.name), ["Grandma's Perogies", 'Imported Dal']);
  assert.deepEqual(c[0].steps.map((s) => s.text), ['Make the dough', 'Fill with potato & cheddar', 'Boil, then fry in butter']);
  assert.deepEqual(c[0].ingredients[0], { quantity: '', name: '2 cups flour' });
  assert.equal(c[0].image, 'images/grandma-s-perogies.jpg');
  assert.equal(c[1].image, null);
  assert.equal(c[1].servings, null);
  assert.equal(c[1].steps.length, 0);
  const s = T.toSchemaOrg(c[1]);
  assert.equal(s.isBasedOn, 'https://example.com/dal');
  assert.ok(!s.nutrition);
  assert.match(T.toMarkdown(c[1]), /_None listed\._/);
});

test('splitBody leaves quantities alone', () => {
  assert.deepEqual(T.splitBody('1-2 tbsp oil\n1.5 cups stock\n4 - Serve'), ['1-2 tbsp oil', '1.5 cups stock', 'Serve']);
});

test('recipes.json only gains extra keys when there is extra data', () => {
  const rs = T.normalize(T.extractRecipes(fx));
  const plain = T.toRecipesJson(rs, { exportedAt: 'x' });
  assert.deepEqual(Object.keys(plain), ['schema_version', 'exported_at', 'source', 'exporter', 'count', 'nutrition_basis', 'nutrition_units', 'recipes']);
  const c = T.normalizeCustom(my.getUser.user_recipes);
  const full = T.toRecipesJson(rs, { exportedAt: 'x', collections: { favourites: [], meal_plan: [] } }, c);
  assert.equal(full.custom_recipes.length, 2);
  assert.ok(full.collections);
});
