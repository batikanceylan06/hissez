import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";

export const firebaseConfig = {
  apiKey: "AIzaSyBKtAjrF_uyFIoP73WcFvgySCmTAwLV9v8",
  authDomain: "hissez.firebaseapp.com",
  databaseURL: "https://hissez-default-rtdb.firebaseio.com",
  projectId: "hissez",
  storageBucket: "hissez.firebasestorage.app",
  messagingSenderId: "737413772792",
  appId: "1:737413772792:web:0b239e7ebffee4e5b0d20d",
  measurementId: "G-RDL2RD4HJT"
};

export const adminEmails = [
  // TEST GİRİŞ MAİLİ
  // Daha sonra panel yetkisini değiştirmek istersen buradaki maili değiştir.
  // Firebase Realtime Database Rules içindeki mail ile birebir aynı olmalı.
  "batikanceylan06@gmail.com",
  "kocasezinkoca@icloud.com"
];

export const app = initializeApp(firebaseConfig);
