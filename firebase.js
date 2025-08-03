// Инициализация Firebase (CDN ES-модули) + Anonymous Auth + serverTimeOffset.
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-app.js";
import { getAuth, signInAnonymously, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-auth.js";
import {
  getDatabase, ref, set, get, onValue, update, runTransaction, push, serverTimestamp,
  onDisconnect, child, query, orderByChild, equalTo
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-database.js";

// Мой рабочий конфиг:
const firebaseConfig = {
  apiKey: "AIzaSyCkrtcVt88eCQ9_eIiiTbpSZs9JL5xneBE",
  authDomain: "rock-cb6c0.firebaseapp.com",
  databaseURL: "https://rock-cb6c0-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "rock-cb6c0",
  storageBucket: "rock-cb6c0.appspot.com",
  messagingSenderId: "490380358093",
  appId: "1:490380358093:web:a4c99070d6d1fc1d9e1484",
  measurementId: "G-43276C8J1F"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getDatabase(app);

// Анонимная авторизация и ожидание готовности auth
export const ready = (async () => {
  await signInAnonymously(auth);
  await new Promise((res) => onAuthStateChanged(auth, () => res(), { onlyOnce: true }));
})();

// Серверное время
let serverOffset = 0;
onValue(ref(db, "/.info/serverTimeOffset"), snap => { serverOffset = snap.val() || 0; });
export const getServerNow = () => Date.now() + serverOffset;

// Экспорты как ожидает app.js
export {
  app, auth, db,
  ref, set, get, onValue, update, runTransaction, push, serverTimestamp,
  onDisconnect, child, query, orderByChild, equalTo
};
