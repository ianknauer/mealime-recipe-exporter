// Pure data transforms: Mealime API response -> export formats.
// No browser APIs here so it can be unit-tested in Node.
(function (root) {
  'use strict';

  // Units for the nutrients Mealime returns without units. Others are left bare.
  const NUTRITION_UNITS = {
    energy: 'kcal', water: 'g', alcohol: 'g',
    carbs: 'g', fiber: 'g', starch: 'g', sugars: 'g',
    fat: 'g', saturated: 'g', monounsaturated: 'g', polyunsaturated: 'g', transfats: 'g',
    protein: 'g',
    cholesterol: 'mg', sodium: 'mg', potassium: 'mg', calcium: 'mg', iron: 'mg',
    magnesium: 'mg', zinc: 'mg', vitamin_c: 'mg',
  };

  const SCHEMA_VERSION = 1;

  function extFromType(type) {
    if (/png/i.test(type || '')) return 'png';
    if (/webp/i.test(type || '')) return 'webp';
    return 'jpg';
  }

  // Accepts either the raw API body ({favourites:[{recipe}]}) or an array.
  function extractRecipes(apiBody) {
    const list = Array.isArray(apiBody) ? apiBody : apiBody && apiBody.favourites;
    if (!Array.isArray(list)) throw new Error('Unexpected response shape: no "favourites" array');
    return list.map((f) => (f && f.recipe) || f).filter((r) => r && r.name);
  }

  function uniqueSlugs(recipes) {
    const seen = new Map();
    return recipes.map((r) => {
      const base = String(r.slug || r.name || 'recipe')
        .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'recipe';
      const n = (seen.get(base) || 0) + 1;
      seen.set(base, n);
      return n === 1 ? base : `${base}-${n}`;
    });
  }

  // imageTypes: optional map slug -> mime type of the downloaded photo (null if none).
  // slugs: optional precomputed unique slugs (needed when custom recipes share the namespace).
  // notes: optional { "<recipe_id>": "text" }; a `note` field is added only when one exists.
  function normalize(rawRecipes, imageTypes, slugs, notes) {
    slugs = slugs || uniqueSlugs(rawRecipes);
    return rawRecipes.map((r, i) => {
      const slug = slugs[i];
      const hasImage = !imageTypes || imageTypes[slug] !== null;
      const type = imageTypes && imageTypes[slug];
      return {
        id: r.recipe_id != null ? r.recipe_id : r.id,
        name: r.name,
        slug,
        servings: r.serving_count != null ? r.serving_count : null,
        cook_minutes: r.cooking_minutes != null ? r.cooking_minutes : null,
        units: r.units || null,
        image: hasImage ? `images/${slug}.${extFromType(type)}` : null,
        source_image_url: r.presentation_image_url || r.thumbnail_image_url || null,
        cookware: (r.cookwares || []).map((c) => c.name).filter(Boolean),
        ingredients: (r.line_items || []).map((l) => ({
          quantity: l.quantity || '',
          name: l.ingredient_name || '',
        })),
        steps: (r.instructions || []).map((s) => ({
          text: s.primary_message || '',
          uses: String(s.secondary_message || '').split('\n').map((x) => x.trim()).filter(Boolean),
        })),
        nutrition_per_serving: r.nutrition || null,
      };
    }).map((out) => withNote(out, notes));
  }

  function withNote(r, notes) {
    const note = notes && r.id != null ? notes[String(r.id)] : null;
    return typeof note === 'string' && note.trim() ? Object.assign(r, { note: note.trim() }) : r;
  }

  // Merge recipe lists, keeping the first occurrence of each variant id (`id`).
  function dedupeRaw(...lists) {
    const seen = new Set();
    const out = [];
    for (const list of lists) {
      for (const r of list || []) {
        if (!r || !r.name) continue;
        const key = r.id != null ? `id:${r.id}` : `name:${r.name}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(r);
      }
    }
    return out;
  }

  // Free-text instructions -> steps. Drops blank lines and leading "1." / "Step 1:" numbering.
  function splitBody(body) {
    return String(body || '').split(/\r?\n/)
      .map((l) => l.replace(/^\s*(?:step\s*)?\d+\s*(?:[.):]|\s-)\s+/i, '').trim())
      .filter(Boolean);
  }

  // my.mealime.com custom recipes -> the same normalised shape as Mealime recipes, plus uid/import_url.
  function normalizeCustom(userRecipes, imageTypes, slugs) {
    const list = (userRecipes || []).filter((u) => u && u.is_deleted !== true && u.name);
    slugs = slugs || uniqueSlugs(list);
    return list.map((u, i) => {
      const slug = slugs[i];
      const hasImage = !imageTypes || imageTypes[slug] !== null;
      const type = imageTypes && imageTypes[slug];
      const src = u.presentation_image_url || u.thumbnail_image_url || null;
      return {
        uid: u.uid != null ? u.uid : null,
        name: u.name,
        slug,
        servings: u.base_servings != null ? u.base_servings : null,
        cook_minutes: null,
        image: src && hasImage ? `images/${slug}.${extFromType(type)}` : null,
        source_image_url: src,
        import_url: u.import_url || null,
        cookware: [],
        ingredients: (u.ingredients || []).map((x) => String(x || '').trim()).filter(Boolean).map((name) => ({ quantity: '', name })),
        steps: splitBody(u.body).map((text) => ({ text, uses: [] })),
        nutrition_per_serving: null,
      };
    });
  }

  const round1 = (v) => (v == null || isNaN(v) ? null : Math.round(Number(v) * 10) / 10);

  function toMarkdown(r) {
    const n = r.nutrition_per_serving || {};
    const lines = [`# ${r.name}`, ''];
    if (r.image) lines.push(`![${r.name}](../${r.image})`, '');
    if (r.servings != null) lines.push(`- **Servings:** ${r.servings}`);
    if (r.cook_minutes != null) lines.push(`- **Time:** ${r.cook_minutes} min`);
    if (r.import_url) lines.push(`- **Source:** ${r.import_url}`);
    if (r.note) lines.push('', '## My note', '', ...r.note.split(/\r?\n/).map((l) => `> ${l}`));
    lines.push('', '## Ingredients', '');
    if (!r.ingredients.length) lines.push('_None listed._');
    r.ingredients.forEach((i) => lines.push(`- ${i.quantity ? i.quantity + ' ' : ''}${i.name}`));
    lines.push('', '## Instructions', '');
    if (!r.steps.length) lines.push('_None listed._');
    r.steps.forEach((s, k) => {
      lines.push(`${k + 1}. ${s.text}`);
      if (s.uses.length) lines.push(`   _(${s.uses.join(', ')})_`);
    });
    if (r.cookware.length) {
      lines.push('', '## Cookware', '');
      r.cookware.forEach((c) => lines.push(`- ${c}`));
    }
    const entries = Object.entries(n);
    if (entries.length) {
      lines.push('', '## Nutrition (per serving)', '', '| Nutrient | Amount |', '|---|---|');
      entries.forEach(([k, v]) => {
        const u = NUTRITION_UNITS[k];
        lines.push(`| ${k.replace(/_/g, ' ')} | ${round1(v) ?? ''}${u ? ' ' + u : ''} |`);
      });
    }
    return lines.join('\n') + '\n';
  }

  // schema.org Recipe — importable by Mealie, Tandoor, Paprika and similar.
  function toSchemaOrg(r) {
    const n = r.nutrition_per_serving || {};
    const q = (k, unit) => (n[k] == null ? undefined : `${round1(n[k])} ${unit}`);
    const nutrition = {
      '@type': 'NutritionInformation',
      servingSize: '1 serving',
      calories: q('energy', 'kcal'),
      proteinContent: q('protein', 'g'),
      carbohydrateContent: q('carbs', 'g'),
      fatContent: q('fat', 'g'),
      saturatedFatContent: q('saturated', 'g'),
      transFatContent: q('transfats', 'g'),
      unsaturatedFatContent:
        n.monounsaturated != null || n.polyunsaturated != null
          ? `${round1((n.monounsaturated || 0) + (n.polyunsaturated || 0))} g` : undefined,
      fiberContent: q('fiber', 'g'),
      sugarContent: q('sugars', 'g'),
      sodiumContent: q('sodium', 'mg'),
      cholesterolContent: q('cholesterol', 'mg'),
    };
    Object.keys(nutrition).forEach((k) => nutrition[k] === undefined && delete nutrition[k]);
    const out = {
      '@context': 'https://schema.org',
      '@type': 'Recipe',
      name: r.name,
      image: r.image ? [`../${r.image}`] : undefined,
      recipeYield: r.servings != null ? `${r.servings} servings` : undefined,
      totalTime: r.cook_minutes != null ? `PT${r.cook_minutes}M` : undefined,
      recipeIngredient: r.ingredients.map((i) => `${i.quantity ? i.quantity + ' ' : ''}${i.name}`.trim()),
      recipeInstructions: r.steps.map((s) => ({ '@type': 'HowToStep', text: s.text })),
      tool: r.cookware.length ? r.cookware.map((c) => ({ '@type': 'HowToTool', name: c })) : undefined,
      nutrition: Object.keys(nutrition).length > 2 ? nutrition : undefined,
      isBasedOn: r.import_url || undefined,
      comment: r.note ? { '@type': 'Comment', text: r.note } : undefined,
    };
    Object.keys(out).forEach((k) => out[k] === undefined && delete out[k]);
    return out;
  }

  // meta.collections ({ favourites: slug[], meal_plan: slug[] }) and customRecipes are optional and
  // only appear in the output when present, so app.mealime.com exports keep their original shape.
  function toRecipesJson(recipes, meta, customRecipes) {
    const out = {
      schema_version: SCHEMA_VERSION,
      exported_at: (meta && meta.exportedAt) || new Date().toISOString(),
      source: (meta && meta.source) || 'Mealime favourites',
      exporter: (meta && meta.exporter) || 'mealime-exporter',
      count: recipes.length,
      nutrition_basis: 'per serving',
      nutrition_units: NUTRITION_UNITS,
      recipes,
    };
    if (meta && meta.collections) out.collections = meta.collections;
    if (customRecipes && customRecipes.length) {
      out.custom_recipes_count = customRecipes.length;
      out.custom_recipes = customRecipes;
    }
    if (meta && meta.unmatchedNotes && Object.keys(meta.unmatchedNotes).length) out.unmatched_notes = meta.unmatchedNotes;
    return out;
  }

  const listBlock = (title, items) => (items && items.length
    ? `\n${title} (${items.length}):\n${items.map((x) => '  - ' + x).join('\n')}\n` : '');

  // extra: { heading, customCount, notesCount, unmatchedNotesCount, failedRecipes: string[], rawNote } (my.mealime.com only)
  function readme(recipes, missingImages, extra) {
    const miss = listBlock('Photos that could not be downloaded', missingImages) +
      listBlock('Recipes that could not be downloaded (recipe id / uuid)', extra && extra.failedRecipes);
    const extraLines = extra ? [
      extra.customCount ? `\nIncludes ${extra.customCount} of your own recipes (custom_recipes in recipes.json).` : '',
      extra.notesCount ? `\nIncludes ${extra.notesCount} recipe note(s) (the "note" field, and "My note" in the Markdown).` : '',
      extra.unmatchedNotesCount ? `\n${extra.unmatchedNotesCount} note(s) belong to recipes that aren't favourites or in your meal plan; they're kept under unmatched_notes in recipes.json, keyed by Mealime recipe id.` : '',
    ].join('') : '';
    return `${(extra && extra.heading) || `Mealime favourites export (${recipes.length} recipes)`}${extraLines ? '\n' + extraLines.trim() : ''}

index.html   Open in any browser. Searchable offline cookbook (keep it next to images/).
recipes.json Clean, normalised data for your own app. Image paths are relative to this folder.
schema-org/  One schema.org Recipe per file, for importing into Mealie, Tandoor, Paprika, etc.
markdown/    One .md per recipe (Obsidian / Notes friendly).
images/      One photo per recipe.
raw/         ${(extra && extra.rawNote) || 'The untouched Mealime API response, in case you need a field that was dropped.'}

Nutrition values are per serving. Units for common nutrients are listed under
nutrition_units in recipes.json; the rest are exactly as Mealime supplied them.
${miss}
Made by BellaNora (https://bellanora.ca), a Canadian meal planner.
Unofficial tool, not affiliated with or endorsed by Mealime.
`;
  }

  const api = { NUTRITION_UNITS, SCHEMA_VERSION, extFromType, extractRecipes, uniqueSlugs, normalize, normalizeCustom, dedupeRaw, splitBody, withNote, toMarkdown, toSchemaOrg, toRecipesJson, readme };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.MealimeTransform = api;
})(typeof self !== 'undefined' ? self : this);
