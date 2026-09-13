// Firebase setup for the Akshuto portfolio site.
// This file just connects to your Firebase project — the actual
// site logic lives in site-data.js (public pages) and admin.js (admin page).

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getFirestore
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {
  getAuth
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

const firebaseConfig = {
  apiKey: "AIzaSyCUj2IhTNWEJwbQSrTTNxdfNJTYpxSnhbU",
  authDomain: "akshuto-portfolio.firebaseapp.com",
  projectId: "akshuto-portfolio",
  storageBucket: "akshuto-portfolio.firebasestorage.app",
  messagingSenderId: "289928580886",
  appId: "1:289928580886:web:832561b3a982a82dd14a37"
};

export const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const auth = getAuth(app);

// Media uploads (images/videos) are hosted on Cloudinary instead of
// Firebase Storage, so this site never needs a billing account.
export const CLOUDINARY_CLOUD_NAME = "u2hsxcjj";
export const CLOUDINARY_UPLOAD_PRESET = "akshuto_uploads";
