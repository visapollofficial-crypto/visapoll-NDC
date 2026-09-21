// Usage: GOOGLE_APPLICATION_CREDENTIALS=serviceAccount.json node scripts/setSuperAdmin.js <uid>
const { initializeApp } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");
initializeApp();
const uid = process.argv[2];
if (!uid) { console.error("Provide the user's UID"); process.exit(1); }
getAuth().setCustomUserClaims(uid, { role: "superadmin" }).then(() => { console.log("superadmin set for", uid); process.exit(0); });
