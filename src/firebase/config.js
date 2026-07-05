// src/firebase/config.js
// Firebase boilerplate — replace the firebaseConfig object with your
// actual project credentials from the Firebase Console.
// All Firestore calls are wired through this single export.

import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getAuth } from "firebase/auth";

// ─── The project's config ───────────────────────────────────────
const firebaseConfig = {
  apiKey: "AIzaSyC88_AuixqVXpFANTqFkOdd1Y8JzNVpBg0",
  authDomain: "giswebdev-673f8.firebaseapp.com",
  projectId: "giswebdev-673f8",
  storageBucket: "giswebdev-673f8.firebasestorage.app",
  messagingSenderId: "361805785527",
  appId: "1:361805785527:web:fe05f71ca7b06a9ddc2032",
  measurementId: "G-VSN33B8F5F"
};
// ──────────────────────────────────────────────────────────────────────────────

const app = initializeApp(firebaseConfig);

/** Firestore database instance — import this wherever you need DB access */
export const db = getFirestore(app);

/** Firebase Auth instance — used by the Owner Dashboard login flow */
export const auth = getAuth(app);

export default app;
