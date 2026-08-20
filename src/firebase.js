const SDK_VERSION = "10.12.5";

export const firebaseConfig = {
  apiKey: "AIzaSyBBUuXadHZHzRIOJlJnp55btyPjTTJ1Z9I",
  authDomain: "adam-fit-5ec39.firebaseapp.com",
  projectId: "adam-fit-5ec39",
  storageBucket: "adam-fit-5ec39.firebasestorage.app",
  messagingSenderId: "378822282443",
  appId: "1:378822282443:web:38325cb01b3e280082df4e",
  measurementId: "G-RT9YFP5TGL"
};

export async function initFirebase() {
  try {
    await load(`https://www.gstatic.com/firebasejs/${SDK_VERSION}/firebase-app-compat.js`);
    await load(`https://www.gstatic.com/firebasejs/${SDK_VERSION}/firebase-auth-compat.js`);
    await load(`https://www.gstatic.com/firebasejs/${SDK_VERSION}/firebase-firestore-compat.js`);
    await load(`https://www.gstatic.com/firebasejs/${SDK_VERSION}/firebase-functions-compat.js`);
    await load(`https://www.gstatic.com/firebasejs/${SDK_VERSION}/firebase-analytics-compat.js`);

    const app = window.firebase.apps?.length
      ? window.firebase.apps[0]
      : window.firebase.initializeApp(firebaseConfig);
    const auth = window.firebase.auth(app);
    const firestore = window.firebase.firestore(app);
    const functions = window.firebase.app().functions("europe-west1");

    await auth.setPersistence(window.firebase.auth.Auth.Persistence.LOCAL);

    let analytics = null;
    if (location.protocol === "https:" && window.firebase.analytics?.isSupported) {
      const supported = await window.firebase.analytics.isSupported();
      analytics = supported ? window.firebase.analytics(app) : null;
    }

    return {
      ready: true,
      mode: "firebase",
      projectId: firebaseConfig.projectId,
      app,
      auth,
      firestore,
      functions,
      analytics
    };
  } catch (error) {
    console.warn("Adam Fit Firebase fallback", error);
    return {
      ready: false,
      mode: "local",
      projectId: firebaseConfig.projectId,
      error
    };
  }
}

function load(src) {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${src}"]`);
    if (existing) {
      if (existing.dataset.loaded === "true") {
        resolve();
        return;
      }
      existing.addEventListener("load", resolve, { once: true });
      existing.addEventListener("error", reject, { once: true });
      return;
    }

    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.onload = () => {
      script.dataset.loaded = "true";
      resolve();
    };
    script.onerror = reject;
    document.head.appendChild(script);
  });
}
