import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles.css";

const SERVICE_WORKER_PATH = "/sw.js";
const LOCAL_SW_HOSTS = new Set(["localhost", "127.0.0.1"]);
const shouldEnableServiceWorker = import.meta.env.PROD || import.meta.env.VITE_PWA_DEV === "true";

const canRegisterServiceWorker = () =>
  typeof window !== "undefined"
  && "serviceWorker" in navigator
  && (window.isSecureContext || LOCAL_SW_HOSTS.has(window.location.hostname));

const collectPwaAssetUrls = (): string[] => {
  const urls = new Set<string>([
    "/",
    "/index.html",
    "/manifest.webmanifest",
    "/pwa-icon.svg?v=logo2",
    "/pwa-icon-192.png?v=logo2",
    "/pwa-icon-512.png?v=logo2",
    "/apple-touch-icon.png?v=logo2",
    "/offline.html",
  ]);

  document.querySelectorAll<HTMLScriptElement>("script[src]").forEach((node) => {
    if (node.src) urls.add(node.src);
  });
  document.querySelectorAll<HTMLLinkElement>("link[href]").forEach((node) => {
    if (node.href) urls.add(node.href);
  });

  performance.getEntriesByType("resource").forEach((entry) => {
    if ("name" in entry && typeof entry.name === "string" && entry.name) {
      urls.add(entry.name);
    }
  });

  return [...urls];
};

const warmPwaCache = async (registration: ServiceWorkerRegistration) => {
  const worker = registration.active || registration.waiting || registration.installing;
  if (!worker) return;
  worker.postMessage({ type: "CACHE_URLS", payload: collectPwaAssetUrls() });
};

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

if (canRegisterServiceWorker()) {
  window.addEventListener("load", () => {
    if (!shouldEnableServiceWorker) {
      void navigator.serviceWorker.getRegistrations().then((registrations) =>
        Promise.all(
          registrations
            .filter((registration) => registration.scope.startsWith(window.location.origin))
            .map((registration) => registration.unregister()),
        ),
      );
      return;
    }

    void navigator.serviceWorker
      .register(SERVICE_WORKER_PATH)
      .then(async (registration) => {
        await registration.update();
        await warmPwaCache(registration);
        const readyRegistration = await navigator.serviceWorker.ready;
        await readyRegistration.update();
        await warmPwaCache(readyRegistration);
      })
      .catch((error) => {
        console.warn("PWA service worker registration skipped:", error);
      });
  });
}
