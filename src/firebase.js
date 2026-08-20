export async function initFirebase() {
  const isFirebaseHost = location.hostname.endsWith(".web.app") || location.hostname.endsWith(".firebaseapp.com");
  if (!isFirebaseHost) return { ready: false, mode: "local", projectId: "adam-fit-5ec39" };
  try {
    await load("/__/firebase/10.12.5/firebase-app-compat.js");
    await load("/__/firebase/10.12.5/firebase-auth-compat.js");
    await load("/__/firebase/10.12.5/firebase-firestore-compat.js");
    await load("/__/firebase/10.12.5/firebase-storage-compat.js");
    await load("/__/firebase/init.js");
    return {
      ready: Boolean(window.firebase?.apps?.length),
      mode: "firebase",
      projectId: "adam-fit-5ec39",
      auth: window.firebase?.auth?.() || null,
      firestore: window.firebase?.firestore?.() || null,
      storage: window.firebase?.storage?.() || null
    };
  } catch (error) {
    console.warn("Adam Fit Firebase fallback", error);
    return { ready: false, mode: "local", projectId: "adam-fit-5ec39" };
  }
}

function load(src) {
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = src;
    script.onload = resolve;
    script.onerror = reject;
    document.head.appendChild(script);
  });
}
