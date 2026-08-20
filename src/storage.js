import { dateKey, defaultProfile, normalizeProfile } from "./fitness.js";

const prefix = "adam-fit-5ec39:";
const sessionKey = `${prefix}session`;
const usersKey = `${prefix}users`;

const read = (key, fallback) => {
  try { return JSON.parse(localStorage.getItem(key) || "null") ?? fallback; } catch { return fallback; }
};
const write = (key, value) => localStorage.setItem(key, JSON.stringify(value));
const uidFromEmail = (email) => email.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "local-user";
const userKey = (uid, path) => `${prefix}${uid}:${path}`;
const hash = (password) => btoa(unescape(encodeURIComponent(password)));

export const store = {
  session: () => read(sessionKey, null),
  signOut: () => localStorage.removeItem(sessionKey),
  register(email, password) {
    if (!email || !password) throw new Error("authMissing");
    const users = read(usersKey, {});
    const normalized = email.trim().toLowerCase();
    if (users[normalized]) throw new Error("authExists");
    const user = { id: uidFromEmail(normalized), email: normalized, createdAt: new Date().toISOString() };
    users[normalized] = { ...user, passwordHash: hash(password) };
    write(usersKey, users);
    write(sessionKey, user);
    return user;
  },
  login(email, password) {
    const users = read(usersKey, {});
    const saved = users[email.trim().toLowerCase()];
    if (!saved || saved.passwordHash !== hash(password)) throw new Error("authInvalid");
    const user = { id: saved.id, email: saved.email, createdAt: saved.createdAt };
    write(sessionKey, user);
    return user;
  },
  profile(uid) {
    return read(userKey(uid, "profile"), null);
  },
  saveProfile(uid, profile) {
    const saved = { ...normalizeProfile({ ...defaultProfile, ...profile }), updatedAt: new Date().toISOString() };
    write(userKey(uid, "profile"), saved);
    return saved;
  },
  day(uid, key = dateKey()) {
    return { meals: [], water: 0, steps: 0, workoutDone: false, workouts: [], ...read(userKey(uid, `day:${key}`), {}) };
  },
  saveDay(uid, key, day) {
    const saved = { meals: [], water: 0, steps: 0, workoutDone: false, workouts: [], ...day, updatedAt: new Date().toISOString() };
    write(userKey(uid, `day:${key}`), saved);
    return saved;
  },
  addFood(uid, key, food) {
    const day = this.day(uid, key);
    return this.saveDay(uid, key, {
      ...day,
      meals: [...day.meals, { id: crypto.randomUUID?.() || String(Date.now()), ...food, calories: Number(food.calories) || 0, protein: Number(food.protein) || 0 }]
    });
  },
  addWater(uid, key, amount) {
    const day = this.day(uid, key);
    return this.saveDay(uid, key, { ...day, water: Math.max(0, Number(day.water || 0) + Number(amount || 0)) });
  },
  setSteps(uid, key, steps) {
    const day = this.day(uid, key);
    return this.saveDay(uid, key, { ...day, steps: Math.max(0, Number(steps) || 0) });
  },
  completeWorkout(uid, key, log) {
    const day = this.day(uid, key);
    return this.saveDay(uid, key, { ...day, workoutDone: true, workouts: [...day.workouts, { ...log, completedAt: new Date().toISOString() }] });
  },
  weights(uid) {
    return read(userKey(uid, "weights"), []);
  },
  addWeight(uid, weight) {
    const next = [...this.weights(uid), { id: crypto.randomUUID?.() || String(Date.now()), date: dateKey(), weight: Number(weight), createdAt: new Date().toISOString() }]
      .filter((item) => Number.isFinite(item.weight));
    write(userKey(uid, "weights"), next);
    return next;
  }
};
