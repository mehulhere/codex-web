let reloadingForServiceWorkerUpdate = false;

export async function registerPwa(): Promise<void> {
  if (!("serviceWorker" in navigator)) {
    return;
  }
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (reloadingForServiceWorkerUpdate) {
      return;
    }
    reloadingForServiceWorkerUpdate = true;
    window.location.reload();
  });
  await navigator.serviceWorker.register("/service-worker.js", {
    scope: "/",
    updateViaCache: "none"
  });
}
