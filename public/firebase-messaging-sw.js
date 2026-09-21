/* Firebase Cloud Messaging service worker.
   Config arrives as query parameters (the app registers this file with them), so no keys are hard-coded here.
   Messages that include a notification payload are displayed by the browser automatically, and clicking one
   opens the link the server attached. */
importScripts("https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.14.1/firebase-messaging-compat.js");

const q = new URL(self.location.href).searchParams;
firebase.initializeApp({
  apiKey: q.get("apiKey"),
  authDomain: q.get("authDomain"),
  projectId: q.get("projectId"),
  messagingSenderId: q.get("messagingSenderId"),
  appId: q.get("appId"),
});
firebase.messaging();
