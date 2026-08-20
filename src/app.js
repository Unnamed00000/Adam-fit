import { exerciseText, tr } from "./i18n.js?v=1.0.8";
import { dateKey, daySummary, defaultProfile, normalizeProfile, todayWorkout, weekPlan } from "./fitness.js?v=1.0.8";
import { store } from "./storage.js?v=1.0.8";
import { firebaseConfig, initFirebase } from "./firebase.js?v=1.0.8";

const root = document.querySelector("#app");
const ADMIN_UIDS = new Set(["paEGMjUNBac2suEeYF96dFIAIAY2"]);
const LANGUAGE_KEY = "adam-fit-5ec39:language:v2";
const supportedLanguages = ["ru", "en", "da"];
const languageNames = { ru: "Русский", en: "English", da: "Dansk" };

function storedLanguage() {
  try {
    const language = localStorage.getItem(LANGUAGE_KEY);
    return supportedLanguages.includes(language) ? language : defaultProfile.language;
  } catch {
    return defaultProfile.language;
  }
}

const state = {
  booting: true,
  authMode: "login",
  message: "",
  language: storedLanguage(),
  firebase: { ready: false, mode: "local" },
  user: null,
  profile: null,
  dayKey: dateKey(),
  day: null,
  weights: [],
  adminUsers: [],
  adminMessage: "",
  adminLoading: false,
  screen: "today",
  session: null,
  restTimer: null
};

const lists = {
  genders: ["male", "female"],
  goals: ["lose", "gain", "maintain"],
  activity: ["low", "moderate", "high"],
  places: ["home", "gym", "outdoor"],
  duration: [15, 30, 45, 60],
  equipment: ["bodyweight", "dumbbells", "barbell", "machines", "bands"],
  meals: ["breakfast", "lunch", "dinner", "snack"],
  days: ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"],
  languages: supportedLanguages
};

const html = (value) => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
const clamp = (min, value, max) => Math.max(min, Math.min(max, value));
const t = (key, values) => tr(activeLanguage(), key, values);
const ex = (key, index) => exerciseText(activeLanguage(), key, index);

function activeLanguage() {
  const language = state.profile?.language || state.language || defaultProfile.language;
  return supportedLanguages.includes(language) ? language : defaultProfile.language;
}

function setLanguage(language) {
  if (!supportedLanguages.includes(language)) return;
  state.language = language;
  try {
    localStorage.setItem(LANGUAGE_KEY, language);
  } catch {
    // Ignore private-mode storage failures; the current session still updates.
  }
}

function roleFor(uid, profile = {}) {
  return ADMIN_UIDS.has(uid) ? "admin" : profile.role || "user";
}

function isAdmin() {
  return state.profile?.role === "admin" || ADMIN_UIDS.has(state.user?.id);
}

function errorMessage(error) {
  const code = error?.code || error?.message || "";
  if (code.includes("email-already-in-use") || code === "authExists") return t("authExists");
  if (code.includes("weak-password")) return t("authWeakPassword");
  if (code.includes("invalid-email") || code === "authMissing") return t("authMissing");
  if (code.includes("invalid-credential") || code.includes("wrong-password") || code.includes("user-not-found") || code === "authInvalid") return t("authInvalid");
  if (code === "adminFunctionsUnavailable") return t("adminFunctionsUnavailable");
  if (code.includes("network") || code.includes("unavailable")) return t("authUnavailable");
  return error?.message || t("authUnavailable");
}

function firebaseUser(user) {
  if (!user) return null;
  return {
    id: user.uid,
    email: user.email || "",
    createdAt: user.metadata?.creationTime || new Date().toISOString()
  };
}

function waitForAuthUser() {
  if (!state.firebase.ready) return Promise.resolve(null);
  return new Promise((resolve) => {
    const unsubscribe = state.firebase.auth.onAuthStateChanged((user) => {
      unsubscribe();
      resolve(firebaseUser(user));
    });
  });
}

async function refresh() {
  if (!state.user) return;
  await ensureUserDocument(state.user.id);
  state.profile = await getProfile(state.user.id);
  if (state.profile) {
    setLanguage(state.profile.language);
    state.day = await getDay(state.user.id, state.dayKey);
    state.weights = await getWeights(state.user.id);
    if (isAdmin()) await loadAdminUsers();
  }
}

function callable(name) {
  if (!state.firebase.ready || !state.firebase.functions) {
    throw new Error("adminFunctionsUnavailable");
  }
  return state.firebase.functions.httpsCallable(name);
}

async function loadAdminUsers(options = {}) {
  if (!isAdmin() || !state.firebase.ready || !state.firebase.functions) return;
  try {
    state.adminLoading = true;
    const result = await callable("adminListUsers")();
    state.adminUsers = Array.isArray(result.data?.users) ? result.data.users : [];
    state.adminMessage = "";
  } catch (error) {
    await loadAdminUsersFromFirestore();
    if (!options.preserveMessage) state.adminMessage = errorMessage(error);
  } finally {
    state.adminLoading = false;
  }
}

async function loadAdminUsersFromFirestore() {
  if (!isAdmin() || !state.firebase.ready) return;
  const snap = await state.firebase.firestore.collection("users").get();
  state.adminUsers = snap.docs.map((doc) => {
    const profile = doc.data() || {};
    return {
      uid: doc.id,
      email: profile.email || "",
      displayName: profile.name || "",
      disabled: false,
      role: profile.role || "user",
      profileComplete: Boolean(profile.profileComplete),
      createdAt: profile.createdAt || "",
      lastSignInAt: ""
    };
  });
}

async function adminCreateUser(data) {
  const payload = {
    email: data.email,
    password: data.password,
    name: data.name,
    role: data.role === "admin" ? "admin" : "user"
  };

  try {
    const createUser = callable("adminCreateUser");
    await createUser(payload);
  } catch (error) {
    if (!canCreateUserWithoutFunctions(error)) throw error;
    await adminCreateUserWithClientAuth(payload);
  }

  state.adminMessage = t("adminUserCreated");
  await loadAdminUsers({ preserveMessage: true });
}

function canCreateUserWithoutFunctions(error) {
  const code = String(error?.code || error?.message || "");
  return code === "adminFunctionsUnavailable"
    || code.includes("functions/not-found")
    || code.includes("not-found")
    || code.includes("NOT_FOUND")
    || code.includes("internal");
}

async function adminCreateUserWithClientAuth(data) {
  if (!state.firebase.ready || !window.firebase?.initializeApp) {
    throw new Error("adminFunctionsUnavailable");
  }

  const email = String(data.email || "").trim().toLowerCase();
  const name = String(data.name || "").trim();
  const role = data.role === "admin" ? "admin" : "user";
  const appName = `adam-fit-admin-create-${Date.now()}`;
  const app = window.firebase.initializeApp(firebaseConfig, appName);
  const auth = window.firebase.auth(app);
  let credential = null;

  try {
    await auth.setPersistence(window.firebase.auth.Auth.Persistence.NONE);
    try {
      credential = await auth.createUserWithEmailAndPassword(email, data.password);
    } catch (error) {
      if (!String(error?.code || error?.message || "").includes("email-already-in-use")) throw error;
      credential = await auth.signInWithEmailAndPassword(email, data.password);
    }

    if (name) await credential.user.updateProfile({ displayName: name });
    await upsertUserProfileDocument(credential.user.uid, {
      email,
      name,
      role,
      profileComplete: false
    });
    await auth.signOut();
    return credential.user.uid;
  } finally {
    await app.delete().catch(() => {});
  }
}

async function adminSetPassword(data) {
  const setPassword = callable("adminSetUserPassword");
  await setPassword({ uid: data.uid, password: data.password });
  state.adminMessage = t("adminPasswordChanged");
}

async function adminDeleteUser(uid) {
  const deleteUser = callable("adminDeleteUser");
  await deleteUser({ uid });
  state.adminMessage = t("adminUserDeleted");
  await loadAdminUsers();
}

async function ensureUserDocument(uid) {
  if (!state.firebase.ready) return;
  const ref = state.firebase.firestore.collection("users").doc(uid);
  const snap = await ref.get();
  const role = roleFor(uid, snap.exists ? snap.data() : {});
  const isBootstrap = ADMIN_UIDS.has(uid);
  const base = {
    authUid: uid,
    email: state.user?.email || "",
    role,
    updatedAt: new Date().toISOString()
  };

  if (!snap.exists) {
    await ref.set(isBootstrap ? adminBootstrapProfile(base) : {
      ...base,
      profileComplete: false,
      createdAt: new Date().toISOString()
    }, { merge: true });
    return;
  }

  if (snap.data().role !== role || !snap.data().authUid || (isBootstrap && !snap.data().profileComplete)) {
    await ref.set(isBootstrap ? adminBootstrapProfile({ ...snap.data(), ...base }) : base, { merge: true });
  }
}

function adminBootstrapProfile(base) {
  return normalizeProfile({
    ...defaultProfile,
    ...base,
    name: base.name || state.user?.email?.split("@")[0] || "Admin",
    role: "admin",
    language: defaultProfile.language,
    profileComplete: true,
    createdAt: base.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString()
  });
}

async function upsertUserProfileDocument(uid, profile) {
  await state.firebase.firestore.collection("users").doc(uid).set({
    authUid: uid,
    language: defaultProfile.language,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...profile
  }, { merge: true });
}

async function getProfile(uid) {
  if (!state.firebase.ready) return store.profile(uid);
  const snap = await state.firebase.firestore.collection("users").doc(uid).get();
  if (!snap.exists) return store.profile(uid);
  if (!snap.data().profileComplete) return null;
  const profile = normalizeProfile({ ...defaultProfile, ...snap.data() });
  store.saveProfile(uid, profile);
  return profile;
}

async function saveProfile(uid, profile) {
  const saved = normalizeProfile({
    ...defaultProfile,
    ...state.profile,
    ...profile,
    language: profile.language || state.profile?.language || state.language || defaultProfile.language,
    role: roleFor(uid, profile),
    profileComplete: true
  });
  store.saveProfile(uid, saved);
  if (state.firebase.ready) {
    await state.firebase.firestore.collection("users").doc(uid).set({
      ...saved,
      authUid: uid,
      email: state.user?.email || "",
      updatedAt: new Date().toISOString()
    }, { merge: true });
  }
  return saved;
}

async function getDay(uid, key) {
  if (!state.firebase.ready) return store.day(uid, key);
  const snap = await state.firebase.firestore.collection("users").doc(uid).collection("days").doc(key).get();
  if (!snap.exists) return store.day(uid, key);
  const day = { meals: [], water: 0, steps: 0, workoutDone: false, workouts: [], ...snap.data() };
  store.saveDay(uid, key, day);
  return day;
}

async function saveDay(uid, key, day) {
  const saved = store.saveDay(uid, key, day);
  if (state.firebase.ready) {
    await state.firebase.firestore.collection("users").doc(uid).collection("days").doc(key).set(saved, { merge: true });
  }
  return saved;
}

async function getWeights(uid) {
  if (!state.firebase.ready) return store.weights(uid);
  const snap = await state.firebase.firestore.collection("users").doc(uid).collection("weights").orderBy("createdAt", "asc").get();
  const weights = snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
  if (!weights.length) return store.weights(uid);
  return weights;
}

async function addFood(food) {
  const day = state.day || await getDay(state.user.id, state.dayKey);
  const meals = Array.isArray(day.meals) ? day.meals : [];
  return saveDay(state.user.id, state.dayKey, {
    ...day,
    meals: [...meals, {
      id: crypto.randomUUID?.() || String(Date.now()),
      ...food,
      calories: Number(food.calories) || 0,
      protein: Number(food.protein) || 0
    }]
  });
}

async function addWater(amount) {
  const day = state.day || await getDay(state.user.id, state.dayKey);
  return saveDay(state.user.id, state.dayKey, {
    ...day,
    water: Math.max(0, Number(day.water || 0) + Number(amount || 0))
  });
}

async function setSteps(steps) {
  const day = state.day || await getDay(state.user.id, state.dayKey);
  return saveDay(state.user.id, state.dayKey, {
    ...day,
    steps: Math.max(0, Number(steps) || 0)
  });
}

async function addWeight(weight) {
  const item = {
    id: crypto.randomUUID?.() || String(Date.now()),
    date: dateKey(),
    weight: Number(weight),
    createdAt: new Date().toISOString()
  };
  const weights = [...store.weights(state.user.id), item].filter((entry) => Number.isFinite(entry.weight));
  localStorage.setItem(`adam-fit-5ec39:${state.user.id}:weights`, JSON.stringify(weights));
  if (state.firebase.ready && Number.isFinite(item.weight)) {
    await state.firebase.firestore.collection("users").doc(state.user.id).collection("weights").doc(item.id).set(item);
  }
  return weights;
}

async function completeWorkoutLog(log) {
  const day = state.day || await getDay(state.user.id, state.dayKey);
  const workouts = Array.isArray(day.workouts) ? day.workouts : [];
  return saveDay(state.user.id, state.dayKey, {
    ...day,
    workoutDone: true,
    workouts: [...workouts, { ...log, completedAt: new Date().toISOString() }]
  });
}

function render() {
  const theme = state.profile?.theme || "light";
  document.body.classList.toggle("dark", theme === "dark");
  document.documentElement.lang = activeLanguage();

  if (state.booting) {
    root.innerHTML = `<main class="splash"><img src="icon.svg" alt=""><h1>Adam Fit</h1><p>${t("slogan")}</p><span>${t("subtitle")}</span></main>`;
    return;
  }
  if (!state.user) {
    root.innerHTML = viewAuth();
    return;
  }
  if (!state.profile) {
    const setupProfile = { ...defaultProfile, language: activeLanguage() };
    root.innerHTML = `<main class="setup"><header><img src="icon.svg" alt=""><div><p>Adam Fit</p><h1>${t("profileSetup")}</h1><span>${t("setupText")}</span></div>${languageSelector("language-public", "compact")}</header>${profileForm(setupProfile, t("savePlan"))}</main>`;
    return;
  }
  root.innerHTML = shell();
}

function viewAuth() {
  const action = state.authMode;
  return `<main class="auth">
    <section class="brand"><img src="icon.svg" alt=""><h1>Adam Fit</h1><p>${t("subtitle")}</p><strong>${t("slogan")}</strong></section>
    <section class="card auth-card">
      ${languageSelector("language-public")}
      <div class="tabs">
        <button class="${action === "login" ? "active" : ""}" data-action="auth-mode" data-mode="login">${t("login")}</button>
        <button class="${action === "register" ? "active" : ""}" data-action="auth-mode" data-mode="register">${t("register")}</button>
      </div>
      ${state.message ? `<p class="notice">${html(state.message)}</p>` : ""}
      <form data-form="${action}">
        ${field(t("email"), "email", "", "email", "required autocomplete=\"email\"")}
        ${field(t("password"), "password", "", "password", "required autocomplete=\"current-password\"")}
        <button class="primary">${action === "login" ? t("signIn") : t("createAccount")}</button>
      </form>
      <button class="ghost" data-action="reset">${t("resetPassword")}</button>
    </section>
  </main>`;
}

function shell() {
  const views = { today: viewToday, nutrition: viewNutrition, workouts: viewWorkouts, progress: viewProgress, profile: viewProfile, adminPanel: viewAdmin };
  const navItems = ["today", "nutrition", "workouts", "progress", "profile"];
  if (isAdmin()) navItems.push("adminPanel");
  return `<main class="phone">
    <section class="content">${views[state.screen]?.() || viewToday()}</section>
    <nav class="${navItems.length > 5 ? "wide-nav" : ""}">${navItems.map((item) => `<button class="${state.screen === item ? "active" : ""}" data-action="nav" data-screen="${item}"><span>${icon(item)}</span>${t(item)}</button>`).join("")}</nav>
  </main>`;
}

function icon(item) {
  return { today: "●", nutrition: "+", workouts: "△", progress: "⌁", profile: "◐", adminPanel: "★" }[item];
}

function viewToday() {
  const summary = daySummary(state.day, state.profile);
  const workout = todayWorkout(state.profile, t, ex);
  const hour = new Date().getHours();
  const greet = hour < 12 ? t("morning") : hour < 18 ? t("afternoon") : t("evening");
  const status = summary.stepsLeft === 0 && summary.proteinLeft === 0 ? t("statusDone") : t("status", { steps: summary.stepsLeft, protein: summary.proteinLeft });
  return `<header class="top"><div><p>${new Intl.DateTimeFormat(activeLanguage(), { weekday: "long", day: "numeric", month: "long" }).format(new Date())}</p><h1>${greet}, ${html(state.profile.name)}</h1></div><img src="icon.svg" alt=""></header>
    <section class="metrics">
      ${metric(t("calories"), summary.calories, state.profile.calorieTarget, "kcal", summary.calorieLeft)}
      ${metric(t("protein"), summary.protein, state.profile.proteinTarget, "g", summary.proteinLeft)}
      ${metric(t("steps"), summary.steps, state.profile.stepTarget, "", summary.stepsLeft)}
      ${metric(t("water"), Math.round(summary.water / 100) / 10, Math.round(state.profile.waterTarget / 100) / 10, "L", Math.round(summary.waterLeft / 100) / 10)}
    </section>
    <section class="quick">
      <button data-action="water" data-amount="250">+250 ml</button>
      <button data-action="water" data-amount="500">+500 ml</button>
      <form data-form="steps"><input name="steps" type="number" min="0" value="${summary.steps}"><button>${t("steps")}</button></form>
    </section>
    <section class="card workout">
      <div><p>${t("workoutToday")}</p><h2>${html(workout.title)}</h2><span>${workout.rest ? t("restDay") : `${workout.duration} min · ${workout.exercises.length} ${t("workouts")} · ${workout.kcal} kcal`}</span></div>
      <button class="primary" data-action="start-workout" ${workout.rest ? "disabled" : ""}>${state.day.workoutDone ? t("workoutDone") : t("startWorkout")}</button>
    </section>
    <section class="status">${status}</section>
    <button class="sticky" data-action="continue">${t("continueDay")}</button>`;
}

function metric(title, value, target, unit, left) {
  const pct = target ? Math.max(0, Math.min(100, Math.round((value / target) * 100))) : 0;
  return `<article class="metric"><div><span>${title}</span><strong>${pct}%</strong></div><b>${value}<small> / ${target} ${unit}</small></b><i><em style="width:${pct}%"></em></i><p>${left} ${t("left")}</p></article>`;
}

function viewNutrition() {
  const meals = state.day.meals || [];
  return `<header class="plain"><h1>${t("nutrition")}</h1><p>${t("futureFood")}</p></header>
    <form class="card form" data-form="food">
      ${select(t("meal"), "meal", lists.meals)}
      ${field(t("foodName"), "name", "", "text", "required")}
      <div class="grid">${field(t("grams"), "grams", "", "number")}${field(t("calories"), "calories", "", "number", "required")}${field(t("protein"), "protein", "", "number", "required step=\"0.1\"")}${field(t("fat"), "fat", "", "number")}${field(t("carbs"), "carbs", "", "number")}</div>
      <button class="primary">${t("addFood")}</button>
    </form>
    <section class="list">${lists.meals.map((meal) => {
      const items = meals.filter((item) => item.meal === meal);
      return `<article class="card meal"><div><h2>${t(meal)}</h2><span>${items.reduce((sum, item) => sum + Number(item.calories || 0), 0)} kcal</span></div>${items.length ? items.map((item) => `<p><strong>${html(item.name)}</strong><span>${item.calories} kcal · ${item.protein} g</span></p>`).join("") : `<small>${t("noItems")}</small>`}</article>`;
    }).join("")}</section>`;
}

function viewWorkouts() {
  if (state.session) return viewSession();
  const plan = weekPlan(state.profile, t, ex);
  return `<header class="plain"><h1>${t("workouts")}</h1><p>${t("weekPlan")}</p></header>
    <section class="list">${plan.map((item, index) => `<article class="card plan ${item.rest ? "rest-day" : ""}"><span>${t(lists.days[index])}</span><strong>${html(item.title)}</strong><small>${item.rest ? t("restDay") : `${item.duration} min · ${item.exercises.length} exercises`}</small></article>`).join("")}</section>
    <button class="primary wide" data-action="start-workout" ${todayWorkout(state.profile, t, ex).rest ? "disabled" : ""}>${t("startWorkout")}</button>`;
}

function viewSession() {
  const exercise = state.session.workout.exercises[state.session.exerciseIndex];
  if (!exercise) return `<section class="card session"><h1>${t("workoutDone")}</h1><button class="primary" data-action="finish-workout">${t("finishWorkout")}</button></section>`;
  return `<section class="card session">
    <p>${state.session.exerciseIndex + 1} / ${state.session.workout.exercises.length}</p>
    <h1>${html(exercise.name)}</h1>
    <div class="visual">${html(exercise.name).slice(0, 2).toUpperCase()}</div>
    <p>${html(exercise.instruction)}</p>
    <strong>${t("sets", { sets: exercise.sets, reps: exercise.reps })}</strong>
    <form data-form="set" class="grid">${field(t("weight"), "weight", exercise.weight, "number", "step=\"0.5\"")}${field(t("reps"), "reps", exercise.reps, "number")}<button class="primary">${t("done")}</button></form>
    ${state.session.restLeft ? `<div class="rest">${t("rest")} — ${String(Math.floor(state.session.restLeft / 60)).padStart(2, "0")}:${String(state.session.restLeft % 60).padStart(2, "0")}</div>` : ""}
  </section>`;
}

function viewProgress() {
  const weights = state.weights;
  const first = weights[0]?.weight;
  const last = weights.at(-1)?.weight;
  const change = Number.isFinite(first) && Number.isFinite(last) ? (last - first).toFixed(1) : "0";
  return `<header class="plain"><h1>${t("progress")}</h1><p>${t("smartHint")}</p></header>
    <section class="card chart"><div><span>${t("weightChart")}</span><strong>${t("change")}: ${change} kg</strong></div>${chart(weights)}<form data-form="weight"><input name="weight" type="number" step="0.1" value="${state.profile.currentWeight}"><button>${t("addWeight")}</button></form></section>
    ${bodyPreview(weights)}
    <section class="list">${weights.slice(-8).reverse().map((item) => `<article class="row"><strong>${item.date}</strong><span>${item.weight} kg</span></article>`).join("") || `<p>${t("noItems")}</p>`}</section>`;
}

function bodyPreview(weights) {
  const currentWeight = Number(weights.at(-1)?.weight || state.profile.currentWeight);
  const targetWeight = Number(state.profile.targetWeight || currentWeight);
  const height = Number(state.profile.height || defaultProfile.height);
  const delta = (targetWeight - currentWeight).toFixed(1);
  return `<section class="card body-card">
    <div class="body-head">
      <div><span>${t("bodyPreview")}</span><strong>${height} ${t("cmUnit")} · ${t("change")}: ${delta} ${t("kgUnit")}</strong></div>
      <small>${t("bodyPreviewHint")}</small>
    </div>
    <div class="body-stage">
      ${bodyFigure(t("currentShape"), currentWeight, height, "current")}
      <div class="body-arrow">→</div>
      ${bodyFigure(t("goalShape"), targetWeight, height, "goal")}
    </div>
  </section>`;
}

function bodyFigure(label, weight, height, mode) {
  const bmi = height ? weight / ((height / 100) ** 2) : 0;
  const body = clamp(0.72, 0.78 + ((bmi - 21) * 0.026), 1.38);
  const shoulders = clamp(0.78, body + (state.profile.gender === "male" ? 0.08 : -0.02), 1.4);
  const hips = clamp(0.76, body + (state.profile.gender === "female" ? 0.08 : 0), 1.42);
  const heightScale = clamp(0.9, height / 178, 1.12);
  const typeKey = bmi < 18.5 ? "bodyLean" : bmi < 25 ? "bodyFit" : bmi < 30 ? "bodySolid" : "bodyStrong";
  const shoulder = 25 * shoulders;
  const waist = 15 * body;
  const hip = 23 * hips;
  const thigh = 12 * body;
  const armWidth = clamp(9, 10.5 * body, 17);
  const legWidth = clamp(10, 11 * body, 18);
  const gradientId = `personGradient-${mode}`;
  const torsoPath = `M ${80 - shoulder} 69 C ${80 - shoulder - 4} 91 ${80 - waist - 7} 112 ${80 - hip} 143 C ${80 - hip + 8} 154 ${80 - thigh} 171 ${80 - thigh} 196 L ${80 + thigh} 196 C ${80 + thigh} 171 ${80 + hip - 8} 154 ${80 + hip} 143 C ${80 + waist + 7} 112 ${80 + shoulder + 4} 91 ${80 + shoulder} 69 C ${80 + shoulder - 13} 60 ${80 - shoulder + 13} 60 ${80 - shoulder} 69 Z`;
  const leftArm = `M ${80 - shoulder + 4} 78 C ${80 - shoulder - 14} 103 ${80 - shoulder - 18} 134 ${80 - shoulder - 11} 164`;
  const rightArm = `M ${80 + shoulder - 4} 78 C ${80 + shoulder + 14} 103 ${80 + shoulder + 18} 134 ${80 + shoulder + 11} 164`;
  const leftLeg = `M ${80 - thigh - 2} 194 C ${80 - thigh - 10} 211 ${80 - legWidth - 8} 236 ${80 - legWidth - 4} 250 C ${80 - legWidth + 5} 254 ${80 - 5} 253 ${80 - 4} 245 C ${80 - 1} 224 ${80 - 2} 208 ${80 - 1} 194 Z`;
  const rightLeg = `M ${80 + thigh + 2} 194 C ${80 + thigh + 10} 211 ${80 + legWidth + 8} 236 ${80 + legWidth + 4} 250 C ${80 + legWidth - 5} 254 ${80 + 5} 253 ${80 + 4} 245 C ${80 + 1} 224 ${80 + 2} 208 ${80 + 1} 194 Z`;
  return `<article class="body-figure ${mode}" style="--person-height:${heightScale.toFixed(2)}">
    <svg class="person-svg" viewBox="0 0 160 260" aria-hidden="true">
      <defs>
        <linearGradient id="${gradientId}" x1="38" y1="18" x2="122" y2="250" gradientUnits="userSpaceOnUse">
          <stop offset="0" stop-color="var(--lime)"/>
          <stop offset=".56" stop-color="var(--brand)"/>
          <stop offset="1" stop-color="#166342"/>
        </linearGradient>
      </defs>
      <ellipse class="person-shadow" cx="80" cy="252" rx="${Math.round(34 * body)}" ry="8"/>
      <circle class="person-part head-shape" cx="80" cy="28" r="${clamp(15, 16 + body, 20).toFixed(1)}"/>
      <path class="person-part neck-shape" d="M ${72 - body} 45 C 76 51 84 51 ${88 + body} 45 L ${90 + body} 62 C 84 67 76 67 ${70 - body} 62 Z"/>
      <path class="person-part arm-shape" d="${leftArm}" stroke-width="${armWidth.toFixed(1)}"/>
      <path class="person-part arm-shape" d="${rightArm}" stroke-width="${armWidth.toFixed(1)}"/>
      <path class="person-part torso-shape" d="${torsoPath}"/>
      <path class="person-part leg-shape" d="${leftLeg}"/>
      <path class="person-part leg-shape" d="${rightLeg}"/>
      <path class="person-highlight" d="M 69 72 C 64 98 65 127 72 151"/>
    </svg>
    <div class="body-meta">
      <strong>${label}</strong>
      <span>${Math.round(weight * 10) / 10} ${t("kgUnit")} · BMI ${bmi.toFixed(1)}</span>
      <small>${t(typeKey)}</small>
    </div>
  </article>`;
}

function viewProfile() {
  return `<header class="plain"><h1>${t("profile")}</h1><p>${t("smartHint")}</p></header>
    <section class="targets">${["calories", "protein", "water", "steps"].map((key) => `<article><span>${t(key)}</span><strong>${state.profile[key === "calories" ? "calorieTarget" : `${key}Target`]}${key === "calories" ? " kcal" : ""}</strong></article>`).join("")}<article><span>${t("role")}</span><strong>${t(state.profile.role || "user")}</strong></article><article><span>${t("dataMode")}</span><strong>${state.firebase.ready ? t("firebase") : t("local")}</strong></article></section>
    ${profileForm(state.profile, t("save"))}
    <section class="settings">${languageSelector("language")}<label>${t("theme")}<select data-action="theme"><option value="light" ${state.profile.theme === "light" ? "selected" : ""}>${t("light")}</option><option value="dark" ${state.profile.theme === "dark" ? "selected" : ""}>${t("dark")}</option></select></label><button class="danger" data-action="sign-out">${t("signOut")}</button></section>`;
}

function viewAdmin() {
  if (!isAdmin()) {
    return `<section class="card"><h1>${t("adminPanel")}</h1><p>${t("adminOnly")}</p></section>`;
  }

  return `<header class="plain"><h1>${t("adminPanel")}</h1><p>${t("adminIntro")}</p></header>
    ${state.adminMessage ? `<p class="notice">${html(state.adminMessage)}</p>` : ""}
    <form class="card form" data-form="admin-create-user">
      <h2>${t("adminCreateUser")}</h2>
      ${field(t("name"), "name", "")}
      ${field(t("email"), "email", "", "email", "required")}
      ${field(t("password"), "password", "", "password", "required minlength=\"6\"")}
      ${select(t("role"), "role", ["user", "admin"], "user")}
      <button class="primary">${t("adminCreateUser")}</button>
    </form>
    <section class="list admin-list">
      <div class="list-head">
        <h2>${t("adminUsers")}</h2>
        <button class="ghost" data-action="admin-refresh">${state.adminLoading ? t("loading") : t("refresh")}</button>
      </div>
      ${state.adminUsers.length ? state.adminUsers.map((user) => adminUserCard(user)).join("") : `<article class="card"><p>${state.adminLoading ? t("loading") : t("noItems")}</p></article>`}
    </section>`;
}

function adminUserCard(user) {
  return `<article class="card admin-user">
    <div>
      <h3>${html(user.email || user.uid)}</h3>
      <span>${html(user.uid)}</span>
    </div>
    <p><strong>${t("role")}:</strong> ${t(user.role || "user")} · <strong>${t("profile")}:</strong> ${user.profileComplete ? t("completed") : t("notCompleted")}</p>
    <form data-form="admin-password" class="admin-actions">
      <input type="hidden" name="uid" value="${html(user.uid)}">
      <input name="password" type="password" minlength="6" placeholder="${t("newPassword")}" required>
      <button>${t("changePassword")}</button>
    </form>
    <button class="danger" data-action="admin-delete" data-uid="${html(user.uid)}" ${user.uid === state.user.id ? "disabled" : ""}>${t("deleteUser")}</button>
  </article>`;
}

function profileForm(profile, button) {
  return `<form class="card form" data-form="profile">
    ${field(t("name"), "name", profile.name)}
    ${select(t("gender"), "gender", lists.genders, profile.gender)}
    <div class="grid">${field(t("age"), "age", profile.age, "number")}${field(t("height"), "height", profile.height, "number")}${field(t("currentWeight"), "currentWeight", profile.currentWeight, "number", "step=\"0.1\"")}${field(t("targetWeight"), "targetWeight", profile.targetWeight, "number", "step=\"0.1\"")}</div>
    ${select(t("goal"), "goal", lists.goals, profile.goal)}
    <div class="grid">${select(t("activity"), "activity", lists.activity, profile.activity)}${field(t("trainingDays"), "trainingDays", profile.trainingDays, "number", "min=\"1\" max=\"6\"")}${select(t("place"), "place", lists.places, profile.place)}${select(t("duration"), "duration", lists.duration, profile.duration, (value) => `${value}+ min`)}</div>
    <label><span>${t("equipment")}</span><div class="chips">${lists.equipment.map((item) => `<label><input name="equipment" type="checkbox" value="${item}" ${(profile.equipment || []).includes(item) ? "checked" : ""}><span>${t(item)}</span></label>`).join("")}</div></label>
    <button class="primary">${button}</button>
  </form>`;
}

function field(label, name, value, type = "text", attrs = "") {
  return `<label><span>${label}</span><input name="${name}" type="${type}" value="${html(value)}" ${attrs}></label>`;
}

function select(label, name, values, selected = values[0], labeler = t) {
  return `<label><span>${label}</span><select name="${name}">${values.map((value) => `<option value="${value}" ${String(value) === String(selected) ? "selected" : ""}>${labeler(value)}</option>`).join("")}</select></label>`;
}

function languageSelector(action = "language", mode = "") {
  const classes = ["language-switch", mode].filter(Boolean).join(" ");
  return `<label class="${classes}"><span>${t("language")}</span><select data-action="${action}">${lists.languages.map((language) => `<option value="${language}" ${activeLanguage() === language ? "selected" : ""}>${languageNames[language]}</option>`).join("")}</select></label>`;
}

function chart(weights) {
  if (weights.length < 2) return `<div class="empty"></div>`;
  const min = Math.min(...weights.map((item) => item.weight));
  const max = Math.max(...weights.map((item) => item.weight));
  const range = Math.max(1, max - min);
  const points = weights.map((item, index) => `${(index / (weights.length - 1)) * 320},${150 - (((item.weight - min) / range) * 130) - 10}`).join(" ");
  return `<svg viewBox="0 0 320 150"><polyline points="${points}" fill="none" stroke="currentColor" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}

async function submit(event) {
  const form = event.target.closest("form");
  if (!form?.dataset.form) return;
  event.preventDefault();
  const data = Object.fromEntries(new FormData(form).entries());
  data.equipment = new FormData(form).getAll("equipment");
  try {
    if (form.dataset.form === "login") {
      if (state.firebase.ready) {
        const credential = await state.firebase.auth.signInWithEmailAndPassword(data.email, data.password);
        state.user = firebaseUser(credential.user);
      } else {
        state.user = store.login(data.email, data.password);
      }
    }
    if (form.dataset.form === "register") {
      if (state.firebase.ready) {
        const credential = await state.firebase.auth.createUserWithEmailAndPassword(data.email, data.password);
        state.user = firebaseUser(credential.user);
      } else {
        state.user = store.register(data.email, data.password);
      }
    }
    if (form.dataset.form === "profile") state.profile = await saveProfile(state.user.id, { ...state.profile, ...data });
    if (form.dataset.form === "food") state.day = await addFood(data);
    if (form.dataset.form === "steps") state.day = await setSteps(data.steps);
    if (form.dataset.form === "weight") {
      state.weights = await addWeight(data.weight);
      state.profile = await saveProfile(state.user.id, { ...state.profile, currentWeight: Number(data.weight) || state.profile.currentWeight });
    }
    if (form.dataset.form === "admin-create-user") await adminCreateUser(data);
    if (form.dataset.form === "admin-password") await adminSetPassword(data);
    if (form.dataset.form === "set") completeSet(data);
    await refresh();
    state.message = "";
  } catch (error) {
    state.message = errorMessage(error);
  }
  render();
}

async function click(event) {
  const node = event.target.closest("[data-action]");
  if (!node) return;
  if (node.dataset.action === "auth-mode") state.authMode = node.dataset.mode;
  if (node.dataset.action === "reset") state.message = t("resetHint");
  if (node.dataset.action === "nav") state.screen = node.dataset.screen;
  if (node.dataset.action === "nav" && node.dataset.screen === "adminPanel") await loadAdminUsers();
  if (node.dataset.action === "continue") state.screen = "nutrition";
  if (node.dataset.action === "admin-refresh") await loadAdminUsers();
  if (node.dataset.action === "admin-delete") {
    const email = node.closest(".admin-user")?.querySelector("h3")?.textContent || node.dataset.uid;
    if (confirm(t("confirmDeleteUser", { email }))) await adminDeleteUser(node.dataset.uid);
  }
  if (node.dataset.action === "water") state.day = await addWater(node.dataset.amount);
  if (node.dataset.action === "start-workout") startWorkout();
  if (node.dataset.action === "finish-workout") await finishWorkout();
  if (node.dataset.action === "sign-out") {
    clearInterval(state.restTimer);
    if (state.firebase.ready) await state.firebase.auth.signOut();
    else store.signOut();
    Object.assign(state, { user: null, profile: null, day: null, weights: [], screen: "today", session: null });
  }
  render();
}

async function change(event) {
  const node = event.target.closest("[data-action]");
  if (!node) return;
  if (node.dataset.action === "language-public") {
    setLanguage(node.value);
    render();
    return;
  }
  if (!state.profile) return;
  if (node.dataset.action === "language") {
    setLanguage(node.value);
    state.profile = await saveProfile(state.user.id, { ...state.profile, language: node.value });
  }
  if (node.dataset.action === "theme") state.profile = await saveProfile(state.user.id, { ...state.profile, theme: node.value });
  render();
}

function startWorkout() {
  const workout = todayWorkout(state.profile, t, ex);
  if (workout.rest) return;
  state.session = { workout, exerciseIndex: 0, setIndex: 0, restLeft: 0, logs: [], startedAt: new Date().toISOString() };
  state.screen = "workouts";
}

function completeSet(data) {
  const exercise = state.session?.workout.exercises[state.session.exerciseIndex];
  if (!exercise) return;
  state.session.logs.push({ exercise: exercise.name, set: state.session.setIndex + 1, reps: Number(data.reps) || exercise.reps, weight: Number(data.weight) || 0 });
  state.session.setIndex += 1;
  if (state.session.setIndex >= exercise.sets) {
    state.session.exerciseIndex += 1;
    state.session.setIndex = 0;
  }
  startRest(exercise.rest);
}

function startRest(seconds) {
  clearInterval(state.restTimer);
  state.session.restLeft = seconds || 0;
  if (!seconds) return;
  state.restTimer = setInterval(() => {
    if (!state.session) return clearInterval(state.restTimer);
    state.session.restLeft = Math.max(0, state.session.restLeft - 1);
    if (!state.session.restLeft) clearInterval(state.restTimer);
    render();
  }, 1000);
}

async function finishWorkout() {
  clearInterval(state.restTimer);
  state.day = await completeWorkoutLog({
    title: state.session.workout.title,
    duration: state.session.workout.duration,
    sets: state.session.logs
  });
  state.session = null;
  state.screen = "today";
}

async function boot() {
  state.firebase = await initFirebase();
  state.user = state.firebase.ready ? await waitForAuthUser() : store.session();
  await refresh();
  render();
  setTimeout(() => { state.booting = false; render(); }, 700);
  if ("serviceWorker" in navigator && location.protocol !== "file:") navigator.serviceWorker.register("./service-worker.js").catch(console.warn);
}

root.addEventListener("submit", submit);
root.addEventListener("click", click);
root.addEventListener("change", change);
boot();
