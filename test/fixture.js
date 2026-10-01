// Mirrors the shape of https://app.mealime.com/api/favourites (observed Sept 2026).
const nutrition = { energy: 682.59, alcohol: 0, carbs: 36.89, fiber: 5.8, sugars: 16.02, fat: 38.1, saturated: 7.2,
  monounsaturated: 18.4, polyunsaturated: 9.9, transfats: 0.1, cholesterol: 102.4, protein: 45.3, sodium: 1203.7, b12_cobalamin: 3.1 };
const recipe = (id, name, slug, img = true) => ({
  id: 7000 + id, recipe_id: id, serving_count: 2, cooking_minutes: 30, name, slug, units: 'Metric',
  thumbnail_image_url: img ? `https://cdn-uploads.mealime.com/uploads/recipe/thumbnail/${id}/thumbnail_x.jpeg` : null,
  presentation_image_url: img ? `https://cdn-uploads.mealime.com/uploads/recipe/thumbnail/${id}/presentation_x.jpeg` : null,
  cookwares: [{ id: 1, name: 'cutting board', slug: 'cutting-board' }, { id: 2, name: "chef's knife", slug: 'chef-s-knife' }],
  instructions: [
    { id: 1, primary_message: 'Peel and mince shallot. Peel and mince the garlic.', secondary_message: '½ shallot\n2 cloves garlic' },
    { id: 2, primary_message: 'Heat a skillet over medium-high heat.', secondary_message: null },
  ],
  line_items: [{ id: 1, quantity: '½ head', ingredient_name: 'butter (Boston) lettuce' }, { id: 2, quantity: '', ingredient_name: 'salt' }],
  nutrition,
});
const fixture = {
  favourites: [
    { id: 1, is_recommended: false, recipe: recipe(857, 'Vietnamese Grilled Steak Banh Mi', 'vietnamese-grilled-steak-banh-mi') },
    { id: 2, is_recommended: false, recipe: recipe(858, 'Perfect Shrimp Pad Thai', 'perfect-shrimp-pad-thai') },
    { id: 3, is_recommended: false, recipe: recipe(859, 'Pad Thai </script><b>again</b>', 'perfect-shrimp-pad-thai') },
    { id: 4, is_recommended: false, recipe: recipe(860, 'No Photo Soup', 'no-photo-soup', false) },
    { id: 5, is_recommended: false, recipe: recipe(861, 'Broken Photo Salad', 'broken-photo-salad') },
  ],
};
module.exports = fixture;
Object.defineProperty(fixture, 'recipe', { value: recipe, enumerable: false });
