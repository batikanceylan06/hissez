import { applicationDefault, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";

const [email, action = "grant"] = process.argv.slice(2);

if (!email || !["grant", "revoke"].includes(action)) {
  console.error("Kullanım: node scripts/set-admin-claim.mjs <e-posta> [grant|revoke]");
  process.exitCode = 1;
} else {
  initializeApp({ credential: applicationDefault() });

  const auth = getAuth();
  const user = await auth.getUserByEmail(email.trim().toLowerCase());
  const customClaims = { ...(user.customClaims || {}) };

  if (action === "grant") customClaims.admin = true;
  else delete customClaims.admin;

  await auth.setCustomUserClaims(user.uid, customClaims);
  await auth.revokeRefreshTokens(user.uid);
  console.log(`${email} için admin yetkisi ${action === "grant" ? "verildi" : "kaldırıldı"}.`);
  console.log("Kullanıcı yeni token almak için panelden çıkış yapıp tekrar giriş yapmalıdır.");
}
