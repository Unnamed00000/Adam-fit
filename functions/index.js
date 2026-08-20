const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { setGlobalOptions } = require("firebase-functions/v2");
const admin = require("firebase-admin");

admin.initializeApp();
setGlobalOptions({ region: "europe-west1", maxInstances: 10 });

const ADMIN_UIDS = new Set(["paEGMjUNBac2suEeYF96dFIAIAY2"]);
const db = admin.firestore();

async function requireAdmin(request) {
  const uid = request.auth?.uid;
  if (!uid) {
    throw new HttpsError("unauthenticated", "Sign in as an admin.");
  }

  if (ADMIN_UIDS.has(uid)) {
    return uid;
  }

  const snap = await db.collection("users").doc(uid).get();
  if (snap.exists && snap.data().role === "admin") {
    return uid;
  }

  throw new HttpsError("permission-denied", "Admin role is required.");
}

function assertEmail(email) {
  if (!email || typeof email !== "string" || !email.includes("@")) {
    throw new HttpsError("invalid-argument", "Valid email is required.");
  }
}

function assertPassword(password) {
  if (!password || typeof password !== "string" || password.length < 6) {
    throw new HttpsError("invalid-argument", "Password must contain at least 6 characters.");
  }
}

async function readProfiles() {
  const snap = await db.collection("users").get();
  const profiles = new Map();
  snap.forEach((doc) => profiles.set(doc.id, { id: doc.id, ...doc.data() }));
  return profiles;
}

async function deleteCollection(path, batchSize = 200) {
  const collectionRef = db.collection(path);
  let snap = await collectionRef.limit(batchSize).get();
  while (!snap.empty) {
    const batch = db.batch();
    snap.docs.forEach((doc) => batch.delete(doc.ref));
    await batch.commit();
    snap = await collectionRef.limit(batchSize).get();
  }
}

exports.adminListUsers = onCall(async (request) => {
  await requireAdmin(request);
  const [authUsers, profiles] = await Promise.all([
    admin.auth().listUsers(1000),
    readProfiles()
  ]);

  return {
    users: authUsers.users.map((user) => {
      const profile = profiles.get(user.uid) || {};
      return {
        uid: user.uid,
        email: user.email || profile.email || "",
        displayName: user.displayName || profile.name || "",
        disabled: Boolean(user.disabled),
        role: profile.role || "user",
        profileComplete: Boolean(profile.profileComplete),
        createdAt: user.metadata.creationTime || profile.createdAt || "",
        lastSignInAt: user.metadata.lastSignInTime || ""
      };
    })
  };
});

exports.adminCreateUser = onCall(async (request) => {
  await requireAdmin(request);
  const email = String(request.data?.email || "").trim().toLowerCase();
  const password = String(request.data?.password || "");
  const name = String(request.data?.name || "").trim();
  const role = request.data?.role === "admin" ? "admin" : "user";

  assertEmail(email);
  assertPassword(password);

  const user = await admin.auth().createUser({
    email,
    password,
    displayName: name || undefined,
    emailVerified: false,
    disabled: false
  });

  await db.collection("users").doc(user.uid).set({
    authUid: user.uid,
    email,
    name,
    role,
    language: "en",
    profileComplete: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  }, { merge: true });

  return { uid: user.uid };
});

exports.adminSetUserPassword = onCall(async (request) => {
  await requireAdmin(request);
  const uid = String(request.data?.uid || "");
  const password = String(request.data?.password || "");
  if (!uid) {
    throw new HttpsError("invalid-argument", "User uid is required.");
  }
  assertPassword(password);

  await admin.auth().updateUser(uid, { password });
  return { uid };
});

exports.adminDeleteUser = onCall(async (request) => {
  const adminUid = await requireAdmin(request);
  const uid = String(request.data?.uid || "");
  if (!uid) {
    throw new HttpsError("invalid-argument", "User uid is required.");
  }
  if (uid === adminUid) {
    throw new HttpsError("failed-precondition", "Admin cannot delete own account.");
  }

  await Promise.all([
    deleteCollection(`users/${uid}/days`),
    deleteCollection(`users/${uid}/weights`)
  ]);
  await db.collection("users").doc(uid).delete();
  await admin.auth().deleteUser(uid);
  return { uid };
});
