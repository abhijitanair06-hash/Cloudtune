/* Register the app-shell service worker only in secure contexts (HTTPS or localhost). */
(() => {
    if (!("serviceWorker" in navigator)) return;

    const isSecureContext = window.isSecureContext
        || ["localhost", "127.0.0.1", "::1"].includes(window.location.hostname);
    if (!isSecureContext) return;

    window.addEventListener("load", () => {
        navigator.serviceWorker.register("./service-worker.js", { scope: "./" })
            .then(registration => {
                if (registration.waiting && navigator.serviceWorker.controller) {
                    console.info("CloudTune update is waiting to activate after the next page load.");
                }
            })
            .catch(error => {
                console.warn("CloudTune offline shell could not be registered:", error);
            });
    });
})();