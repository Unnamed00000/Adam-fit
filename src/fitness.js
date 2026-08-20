const activityMap = { low: 1.25, moderate: 1.45, high: 1.65 };
const calorieDelta = { lose: -450, gain: 300, maintain: 0 };
const proteinFactor = { lose: 1.8, gain: 2, maintain: 1.6 };

export const defaultProfile = {
  name: "Adam",
  gender: "male",
  age: 30,
  height: 178,
  currentWeight: 90,
  targetWeight: 82,
  goal: "lose",
  activity: "moderate",
  trainingDays: 3,
  place: "gym",
  duration: 45,
  equipment: ["dumbbells", "barbell", "machines"],
  language: "ru",
  theme: "light"
};

export function dateKey(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function targets(profile) {
  const weight = Number(profile.currentWeight) || 75;
  const height = Number(profile.height) || 175;
  const age = Number(profile.age) || 30;
  const genderOffset = profile.gender === "female" ? -161 : 5;
  const bmr = (10 * weight) + (6.25 * height) - (5 * age) + genderOffset;
  const calories = Math.max(1300, Math.round((bmr * (activityMap[profile.activity] || 1.45)) + (calorieDelta[profile.goal] || 0)));
  return {
    calorieTarget: calories,
    proteinTarget: Math.round(weight * (proteinFactor[profile.goal] || 1.6)),
    waterTarget: Math.round((weight * 35) / 250) * 250,
    stepTarget: profile.goal === "lose" ? 8500 : profile.goal === "gain" ? 7000 : 8000
  };
}

export function normalizeProfile(profile) {
  const clean = { ...defaultProfile, ...profile };
  clean.age = Number(clean.age) || 30;
  clean.height = Number(clean.height) || 175;
  clean.currentWeight = Number(clean.currentWeight) || 75;
  clean.targetWeight = Number(clean.targetWeight) || clean.currentWeight;
  clean.trainingDays = Math.max(1, Math.min(6, Number(clean.trainingDays) || 3));
  clean.duration = Number(clean.duration) || 45;
  clean.equipment = Array.isArray(clean.equipment) ? clean.equipment : [];
  return { ...clean, ...targets(clean) };
}

const templates = {
  strengthA: ["strengthA", [["squat", 3, 10, 90], ["press", 3, 10, 90], ["row", 3, 10, 90], ["plank", 3, 40, 60]]],
  strengthB: ["strengthB", [["deadlift", 3, 10, 90], ["lunges", 3, 12, 75], ["press", 3, 10, 90], ["plank", 3, 45, 60]]],
  cardio: ["cardio", [["walk", 1, 30, 0], ["climbers", 3, 30, 60], ["plank", 3, 40, 60]]],
  upper: ["upper", [["press", 4, 8, 120], ["row", 4, 10, 90], ["plank", 3, 45, 60]]],
  lower: ["lower", [["squat", 4, 8, 120], ["deadlift", 3, 10, 90], ["lunges", 3, 12, 75]]]
};
const weekSlots = { 1: [0], 2: [0, 3], 3: [0, 2, 4], 4: [0, 1, 3, 5], 5: [0, 1, 2, 4, 5], 6: [0, 1, 2, 3, 4, 5] };
const weekTemplates = { 1: ["strengthA"], 2: ["strengthA", "cardio"], 3: ["strengthA", "strengthB", "cardio"], 4: ["upper", "lower", "strengthA", "cardio"], 5: ["upper", "lower", "strengthA", "strengthB", "cardio"], 6: ["upper", "lower", "strengthA", "cardio", "strengthB", "lower"] };

export function weekPlan(profile, t, ex) {
  const slots = weekSlots[profile.trainingDays] || weekSlots[3];
  const selected = weekTemplates[profile.trainingDays] || weekTemplates[3];
  return Array.from({ length: 7 }, (_, day) => {
    const planIndex = slots.indexOf(day);
    if (planIndex === -1) return { day, rest: true, title: t("restDay"), exercises: [] };
    const [titleKey, exerciseRows] = templates[selected[planIndex]];
    return {
      day,
      rest: false,
      id: selected[planIndex],
      title: t(titleKey),
      duration: profile.duration,
      kcal: Math.round(260 * (profile.duration / 45)),
      exercises: exerciseRows.map(([key, sets, reps, rest]) => ({
        key,
        name: ex(key, 0),
        instruction: ex(key, 1),
        sets,
        reps,
        rest,
        weight: ["plank", "walk", "climbers"].includes(key) ? 0 : profile.gender === "female" ? 8 : 18
      }))
    };
  });
}

export function todayWorkout(profile, t, ex, date = new Date()) {
  const day = date.getDay() === 0 ? 6 : date.getDay() - 1;
  return weekPlan(profile, t, ex)[day];
}

export function daySummary(day, profile) {
  const meals = Array.isArray(day.meals) ? day.meals : [];
  const calories = meals.reduce((sum, item) => sum + Number(item.calories || 0), 0);
  const protein = meals.reduce((sum, item) => sum + Number(item.protein || 0), 0);
  return {
    calories,
    protein,
    water: Number(day.water) || 0,
    steps: Number(day.steps) || 0,
    calorieLeft: Math.max(0, profile.calorieTarget - calories),
    proteinLeft: Math.max(0, profile.proteinTarget - protein),
    waterLeft: Math.max(0, profile.waterTarget - (Number(day.water) || 0)),
    stepsLeft: Math.max(0, profile.stepTarget - (Number(day.steps) || 0))
  };
}
