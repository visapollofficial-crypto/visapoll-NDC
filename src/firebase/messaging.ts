import { deleteToken, getMessaging, getToken, isSupported, onMessage } from "firebase/messaging";
import { httpsCallable } from "firebase/functions";
import { app, functions } from "./config";

const TOKEN_KEY = "fcmToken";

export type PushState = "unsupported" | "blocked" | "off" | "on";

export async function pushState(): Promise<PushState> {
  if (!(await isSupported().catch(() => false))) return "unsupported";
  if (Notification.permission === "denied") return "blocked";
  return Notification.permission === "granted" && localStorage.getItem(TOKEN_KEY) ? "on" : "off";
}

async function registerWorker() {
  const e = import.meta.env;
  const qs = new URLSearchParams({
    apiKey: e.VITE_FIREBASE_API_KEY ?? "", authDomain: e.VITE_FIREBASE_AUTH_DOMAIN ?? "", projectId: e.VITE_FIREBASE_PROJECT_ID ?? "",
    messagingSenderId: e.VITE_FIREBASE_MESSAGING_SENDER_ID ?? "", appId: e.VITE_FIREBASE_APP_ID ?? "",
  });
  return navigator.serviceWorker.register(`/firebase-messaging-sw.js?${qs}`);
}

/** Asks permission (must be triggered by a tap), gets a device token, and hands it to the server. */
export async function enablePush(): Promise<PushState> {
  if (!(await isSupported().catch(() => false))) return "unsupported";
  const permission = await Notification.requestPermission();
  if (permission !== "granted") return permission === "denied" ? "blocked" : "off";
  const token = await getToken(getMessaging(app), { vapidKey: import.meta.env.VITE_FIREBASE_VAPID_KEY, serviceWorkerRegistration: await registerWorker() });
  if (!token) throw new Error("no token");
  await httpsCallable(functions, "registerFcmToken")({ token });
  localStorage.setItem(TOKEN_KEY, token);
  return "on";
}

export async function disablePush(): Promise<void> {
  const token = localStorage.getItem(TOKEN_KEY);
  if (token) await httpsCallable(functions, "unregisterFcmToken")({ token }).catch(() => undefined);
  await deleteToken(getMessaging(app)).catch(() => undefined);
  localStorage.removeItem(TOKEN_KEY);
}

/** Messages that arrive while the app is open are shown in-app instead of as system notifications. */
export async function onForegroundMessage(cb: (title: string, body: string, link: string) => void): Promise<() => void> {
  if (!(await isSupported().catch(() => false))) return () => undefined;
  return onMessage(getMessaging(app), (m) => cb(m.notification?.title ?? "", m.notification?.body ?? "", (m.data?.link as string) ?? ""));
}
