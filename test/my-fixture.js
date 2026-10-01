// Mirrors POST https://api.mealime.com/api/v2/get_user and the recipe CDN (shapes from the handoff notes).
const { recipe } = require('./fixture.js');

const SECRET_TOKEN = 'tok_SECRET_do_not_export_123';
const SECRET_EMAIL = 'secret.person@example.com';

const cdn = {
  'uuid-banh-mi': recipe(857, 'Vietnamese Grilled Steak Banh Mi', 'vietnamese-grilled-steak-banh-mi'),
  'uuid-pad-thai': recipe(858, 'Perfect Shrimp Pad Thai', 'perfect-shrimp-pad-thai'),
  'uuid-flaky': recipe(862, 'Flaky CDN Chili', 'flaky-cdn-chili'),      // fails once, then succeeds (retry)
  // 'uuid-gone' is never served (fails twice -> reported, export continues)
};

const getUser = {
  id: 42, email: SECRET_EMAIL, first_name: 'Secret', auth_token: SECRET_TOKEN,
  subscription_status: 'pro', stripe_customer_id: 'cus_SECRET',
  profile: { unit_family_id: 1, serving_count: 2 },
  favourites: [
    { id: 1, recipe_variant_id: 7857, published_recipe_uuid: 'uuid-banh-mi' },
    { id: 2, recipe_variant_id: 7858, published_recipe_uuid: 'uuid-pad-thai' },
    { id: 3, recipe_variant_id: 7862, published_recipe_uuid: 'uuid-flaky' },
    { id: 4, recipe_variant_id: 7999, published_recipe_uuid: 'uuid-gone' },
  ],
  current_meal_plan: {
    id: 9, created_at: '2026-09-28', serving_count: 2,
    meals: [
      { id: 1, recipe: recipe(857, 'Vietnamese Grilled Steak Banh Mi', 'vietnamese-grilled-steak-banh-mi') }, // also a favourite
      { id: 2, recipe: recipe(870, 'White Bean-Chicken Chili', 'white-bean-chicken-chili') },
    ],
    previous_meal_plan_meals: [{ id: 3, recipe: recipe(871, 'Grilled Turmeric Chicken', 'grilled-turmeric-chicken') }],
    items: [{ id: 1, name: 'lemon' }], sections: [], user_meals: [], schedule: {},
  },
  user_recipes: [
    { uid: 'u1', name: "Grandma's Perogies", body: '1. Make the dough\n\n2. Fill with potato & cheddar\nStep 3: Boil, then fry in butter',
      ingredients: ['2 cups flour', '1 egg', '1 cup mashed potato'], is_deleted: false,
      import_url: null, thumbnail_image_url: null, presentation_image_url: 'https://cdn-uploads.mealime.com/uploads/user_recipe/u1.jpeg', base_servings: 4 },
    { uid: 'u2', name: 'Imported Dal', body: '', ingredients: ['1 cup red lentils'], is_deleted: false,
      import_url: 'https://example.com/dal', thumbnail_image_url: null, presentation_image_url: null, base_servings: null },
    { uid: 'u3', name: 'Deleted Thing', body: 'x', ingredients: [], is_deleted: true,
      import_url: null, thumbnail_image_url: null, presentation_image_url: null, base_servings: 2 },
  ],
  recipe_notes: { 858: 'Use extra lime.\nKids like it mild.', 870: '  ', 9999: 'note for a recipe not exported' },
};

module.exports = { getUser, cdn, SECRET_TOKEN, SECRET_EMAIL };
