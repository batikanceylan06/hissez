import { initializeApp } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js";
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app-check.js";

export const firebaseConfig = {
  apiKey: "AIzaSyBKtAjrF_uyFIoP73WcFvgySCmTAwLV9v8",
  authDomain: "hissez.firebaseapp.com",
  projectId: "hissez",
  storageBucket: "hissez.firebasestorage.app",
  messagingSenderId: "737413772792",
  appId: "1:737413772792:web:0b239e7ebffee4e5b0d20d",
  measurementId: "G-RDL2RD4HJT",
  appCheckSiteKey: "REPLACE_WITH_RECAPTCHA_ENTERPRISE_SITE_KEY"
};

export const app = initializeApp(firebaseConfig);

const localHostnames = new Set(["localhost", "127.0.0.1", "[::1]"]);
const isLocalDevelopment = typeof window !== "undefined"
  && (localHostnames.has(window.location.hostname) || window.location.protocol === "file:");
const hasConfiguredAppCheckKey = Boolean(firebaseConfig.appCheckSiteKey)
  && !firebaseConfig.appCheckSiteKey.startsWith("REPLACE_WITH_");

// App Check is intentionally skipped for local/emulator work. Enforcement is a
// Firebase Console setting and must be enabled only after production attestation
// traffic has been verified.
export const appCheck = !isLocalDevelopment && hasConfiguredAppCheckKey
  ? initializeAppCheck(app, {
      provider: new ReCaptchaEnterpriseProvider(firebaseConfig.appCheckSiteKey),
      isTokenAutoRefreshEnabled: true
    })
  : null;
