import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

const firebaseConfig = {
    apiKey: "AIzaSyCfr3-YRSBzsXWbjBvhLBlb85l9WhFd3MI",
    authDomain: "hartopia-emblem-exchange.firebaseapp.com",
    projectId: "hartopia-emblem-exchange",
    storageBucket: "hartopia-emblem-exchange.firebasestorage.app",
    messagingSenderId: "977409423638",
    appId: "1:977409423638:web:8bc023b4bfff4dbe9ab837",
    measurementId: "G-377KZ0W0ZT",
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

export { app, auth, db, firebaseConfig };
