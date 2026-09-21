// Usage: GOOGLE_APPLICATION_CREDENTIALS=serviceAccount.json node scripts/importRoster.js roster.csv
// CSV header: studentId,fullName,department,session   (department: Science|Commerce|Humanities)
const fs = require("fs");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
initializeApp();
const db = getFirestore();
const norm = (s) => s.normalize("NFKC").toUpperCase().replace(/[^A-Z0-9]/g, "");
(async () => {
  const rows = fs.readFileSync(process.argv[2], "utf8").trim().split(/\r?\n/).slice(1);
  let batch = db.batch(), n = 0;
  for (const line of rows) {
    const [studentId, fullName, department, session] = line.split(",").map((x) => x.trim());
    if (!studentId) continue;
    batch.set(db.doc(`studentRoster/${norm(studentId)}`), { fullName, department, session, active: true });
    if (++n % 400 === 0) { await batch.commit(); batch = db.batch(); }
  }
  await batch.commit();
  console.log("Imported", n, "students");
})();
