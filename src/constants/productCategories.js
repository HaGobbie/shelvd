// src/constants/productCategories.js
//
// Single source of truth for product/service categories, shared by:
//   - ProductFormModal.jsx   (category <select>, service-toggle logic)
//   - StoreDetails.jsx       (service badge emoji on the public map)
//   - services/geminiScanner.js (validates AI Snap & Fill's guess)
//
// Pulled into its own file specifically so geminiScanner.js can import
// this list without importing ProductFormModal.jsx itself — Product
// FormModal also imports scanProductImage from geminiScanner.js, and
// having both files import categories FROM EACH OTHER would be a
// circular import (fragile in ES modules: whichever file finishes
// evaluating second can see `undefined` for values it imported from the
// other, depending on module load order). Everyone importing from this
// one shared, dependency-free file avoids that entirely.

export const SERVICE_CATEGORY_EMOJI = {
  "Water Refill": "💧",
  "E-Load": "📱",
  "LPG / Cooking Gas": "🔥",
  "Ice": "🧊",
};

export const SERVICE_CATEGORIES = Object.keys(SERVICE_CATEGORY_EMOJI);

export const CATEGORIES = [
  "Pantry", "Grains", "Canned Goods", "Beverages", "Condiments",
  "Dairy & Eggs", "Household", "Personal Care", "Snacks", "Frozen Goods",
  ...SERVICE_CATEGORIES,
  "Other",
];
