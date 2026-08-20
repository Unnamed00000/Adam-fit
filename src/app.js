import { exerciseText, tr } from "./i18n.js";
import { dateKey, daySummary, defaultProfile, normalizeProfile, todayWorkout, weekPlan } from "./fitness.js";
import { store } from "./storage.js";
import { initFirebase } from "./firebase.js";

const root = document.querySelector("#app");
const state = {
  booting: true,
  authMode: "login",
  message: "",
  firebase: { ready: false, mode: "local" },
  user: null,
  profile: null,
  dayKey: dateKey(),
  day: null,
  weights: [],
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
  days: ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]
};

const html = (value) => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
const t = (key, values) => tr(state.profile?.language || defaultProfile.language, key, values);
const ex = (key, index) => exerciseText(state.profile?.language || defaultProfile.language, key, index);

function refresh() {
  if (!state.user) return;
  state.profile = store.profile(state.user.id);
  if (state.profile) {
    state.day = store.day(state.user.id, state.dayKey);
    state.weights = store.weights(state.user.id);
  }
}

function render() {
  const theme = state.profile?.theme || "light";
  document.body.classList.toggle("dark", theme === "dark");
  document.documentElement.lang = state.profile?.language || "ru";

  if (state.booting) {
    root.innerHTML = `<main class="splash"><img src="icon.svg" alt=""><h1>Adam Fit</h1><p>${t("slogan")}</p><span>${t("subtitle")}</span></main>`;
    return;
  }
  if (!state.user) {
    root.innerHTML = viewAuth();
    return;
  }
  if (!state.profile) {
    root.innerHTML = `<main class="setup"><header><img src="icon.svg" alt=""><div><p>Adam Fit</p><h1>${t("profileSetup")}</h1><span>${t("setupText")}</span></div></header>${profileForm(defaultProfile, t("savePlan"))}</main>`;
    return;
  }
  root.innerHTML = shell();
}

function viewAuth() {
  const action = state.authMode;
  return `<main class="auth">
    <section class="brand"><img src="icon.svg" alt=""><h1>Adam Fit</h1><p>${t("subtitle")}</p><strong>${t("slogan")}</strong></section>
    <section class="card auth-card">
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
  const views = { today: viewToday, nutrition: viewNutrition, workouts: viewWorkouts, progress: viewProgress, profile: viewProfile };
  return `<main class="phone">
    <section class="content">${views[state.screen]?.() || viewToday()}</section>
    <nav>${["today", "nutrition", "workouts", "progress", "profile"].map((item) => `<button class="${state.screen === item ? "active" : ""}" data-action="nav" data-screen="${item}"><span>${icon(item)}</span>${t(item)}</button>`).join("")}</nav>
  </main>`;
}

function icon(item) {
  return { today: "●", nutrition: "+", workouts: "△", progress: "⌁", profile: "◐" }[item];
}

function viewToday() {
  const summary = daySummary(state.day, state.profile);
  const workout = todayWorkout(state.profile, t, ex);
  const hour = new Date().getHours();
  const greet = hour < 12 ? t("morning") : hour < 18 ? t("afternoon") : t("evening");
  const status = summary.stepsLeft === 0 && summary.proteinLeft === 0 ? t("statusDone") : t("status", { steps: summary.stepsLeft, protein: summary.proteinLeft });
  return `<header class="top"><div><p>${new Intl.DateTimeFormat(state.profile.language, { weekday: "long", day: "numeric", month: "long" }).format(new Date())}</p><h1>${greet}, ${html(state.profile.name)}</h1></div><img src="icon.svg" alt=""></header>
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
    <section class="list">${weights.slice(-8).reverse().map((item) => `<article class="row"><strong>${item.date}</strong><span>${item.weight} kg</span></article>`).join("") || `<p>${t("noItems")}</p>`}</section>`;
}

function viewProfile() {
  return `<header class="plain"><h1>${t("profile")}</h1><p>${t("smartHint")}</p></header>
    <section class="targets">${["calories", "protein", "water", "steps"].map((key) => `<article><span>${t(key)}</span><strong>${state.profile[key === "calories" ? "calorieTarget" : `${key}Target`]}${key === "calories" ? " kcal" : ""}</strong></article>`).join("")}<article><span>${t("dataMode")}</span><strong>${state.firebase.ready ? t("firebase") : t("local")}</strong></article></section>
    ${profileForm(state.profile, t("save"))}
    <section class="settings"><label>${t("language")}<select data-action="language">${["ru", "en", "da"].map((lang) => `<option value="${lang}" ${state.profile.language === lang ? "selected" : ""}>${lang.toUpperCase()}</option>`).join("")}</select></label><label>${t("theme")}<select data-action="theme"><option value="light" ${state.profile.theme === "light" ? "selected" : ""}>${t("light")}</option><option value="dark" ${state.profile.theme === "dark" ? "selected" : ""}>${t("dark")}</option></select></label><button class="danger" data-action="sign-out">${t("signOut")}</button></section>`;
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

function chart(weights) {
  if (weights.length < 2) return `<div class="empty"></div>`;
  const min = Math.min(...weights.map((item) => item.weight));
  const max = Math.max(...weights.map((item) => item.weight));
  const range = Math.max(1, max - min);
  const points = weights.map((item, index) => `${(index / (weights.length - 1)) * 320},${150 - (((item.weight - min) / range) * 130) - 10}`).join(" ");
  return `<svg viewBox="0 0 320 150"><polyline points="${points}" fill="none" stroke="currentColor" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}

function submit(event) {
  const form = event.target.closest("form");
  if (!form?.dataset.form) return;
  event.preventDefault();
  const data = Object.fromEntries(new FormData(form).entries());
  data.equipment = new FormData(form).getAll("equipment");
  try {
    if (form.dataset.form === "login") state.user = store.login(data.email, data.password);
    if (form.dataset.form === "register") state.user = store.register(data.email, data.password);
    if (form.dataset.form === "profile") state.profile = store.saveProfile(state.user.id, data);
    if (form.dataset.form === "food") state.day = store.addFood(state.user.id, state.dayKey, data);
    if (form.dataset.form === "steps") state.day = store.setSteps(state.user.id, state.dayKey, data.steps);
    if (form.dataset.form === "weight") {
      state.weights = store.addWeight(state.user.id, data.weight);
      state.profile = store.saveProfile(state.user.id, { ...state.profile, currentWeight: Number(data.weight) || state.profile.currentWeight });
    }
    if (form.dataset.form === "set") completeSet(data);
    refresh();
    state.message = "";
  } catch (error) {
    state.message = t(error.message || "authInvalid");
  }
  render();
}

function click(event) {
  const node = event.target.closest("[data-action]");
  if (!node) return;
  if (node.dataset.action === "auth-mode") state.authMode = node.dataset.mode;
  if (node.dataset.action === "reset") state.message = t("resetHint");
  if (node.dataset.action === "nav") state.screen = node.dataset.screen;
  if (node.dataset.action === "continue") state.screen = "nutrition";
  if (node.dataset.action === "water") state.day = store.addWater(state.user.id, state.dayKey, node.dataset.amount);
  if (node.dataset.action === "start-workout") startWorkout();
  if (node.dataset.action === "finish-workout") finishWorkout();
  if (node.dataset.action === "sign-out") {
    clearInterval(state.restTimer);
    store.signOut();
    Object.assign(state, { user: null, profile: null, day: null, weights: [], screen: "today", session: null });
  }
  render();
}

function change(event) {
  const node = event.target.closest("[data-action]");
  if (!node || !state.profile) return;
  if (node.dataset.action === "language") state.profile = store.saveProfile(state.user.id, { ...state.profile, language: node.value });
  if (node.dataset.action === "theme") state.profile = store.saveProfile(state.user.id, { ...state.profile, theme: node.value });
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

function finishWorkout() {
  clearInterval(state.restTimer);
  state.day = store.completeWorkout(state.user.id, state.dayKey, {
    title: state.session.workout.title,
    duration: state.session.workout.duration,
    sets: state.session.logs
  });
  state.session = null;
  state.screen = "today";
}

async function boot() {
  state.firebase = await initFirebase();
  state.user = store.session();
  refresh();
  render();
  setTimeout(() => { state.booting = false; render(); }, 700);
  if ("serviceWorker" in navigator && location.protocol !== "file:") navigator.serviceWorker.register("./service-worker.js").catch(console.warn);
}

root.addEventListener("submit", submit);
root.addEventListener("click", click);
root.addEventListener("change", change);
boot();
