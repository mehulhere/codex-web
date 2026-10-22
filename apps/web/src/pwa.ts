let reloadingForServiceWorkerUpdate = false;

export async function registerPwa(): Promise<void> {
  if (!("serviceWorker" in navigator)) {
    return;
  }
  let hadController = Boolean(navigator.serviceWorker.controller);
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    const replacingWorker = hadController;
    hadController = true;
    // First activation claims this page without replacing its loaded app shell.
    // Reloading here can erase a password or draft entered during installation.
    if (!replacingWorker || reloadingForServiceWorkerUpdate) {
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
