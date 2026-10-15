import { takeSharedFile } from "./share-store.js";

export function setupPWA({ onFile, onStatus, canReload }) {
  const install = document.getElementById("btnInstall");
  const help = document.getElementById("installHelp");
  const message = document.getElementById("pwaStatus");
  const update = document.getElementById("btnUpdateApp");
  let prompt = null,
    registration = null,
    reloading = false;
  const standalone = matchMedia("(display-mode: standalone)");
  const showInstalled = () => {
    const installed = standalone.matches || navigator.standalone === true;
    install.hidden = installed;
    document.getElementById("pwaTitle").textContent = installed
      ? "Visor instalado"
      : "Lleva el visor a tu teléfono";
  };
  showInstalled();
  standalone.addEventListener("change", showInstalled);
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    prompt = event;
    install.textContent = "Instalar app";
  });
  window.addEventListener("appinstalled", () => {
    prompt = null;
    install.hidden = true;
    document.getElementById("pwaTitle").textContent = "Visor instalado";
  });
  document
    .getElementById("btnInstallHelp")
    .addEventListener("click", () => help.showModal());
  install.addEventListener("click", async () => {
    if (!prompt) {
      help.showModal();
      return;
    }
    const pending = prompt;
    prompt = null;
    try {
      await pending.prompt();
      await pending.userChoice;
    } catch {
      help.showModal();
    }
  });
  update.addEventListener("click", () => {
    if (!canReload()) {
      message.textContent =
        "Termina o cancela la operación antes de actualizar.";
      return;
    }
    if (registration?.waiting) {
      reloading = true;
      registration.waiting.postMessage({ type: "ACTIVATE_UPDATE" });
    }
  });

  if ("serviceWorker" in navigator && window.isSecureContext) {
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (reloading) location.reload();
    });
    navigator.serviceWorker
      .register(new URL("./sw.js", import.meta.url), {
        type: "module",
        updateViaCache: "none",
      })
      .then((result) => {
        registration = result;
        const offerUpdate = () => {
          if (result.waiting && navigator.serviceWorker.controller) {
            update.hidden = false;
            message.textContent =
              "Hay una versión nueva. Actualizar recargará el visor.";
          }
        };
        offerUpdate();
        result.addEventListener("updatefound", () => {
          const worker = result.installing;
          worker?.addEventListener("statechange", () => {
            if (worker.state === "installed") offerUpdate();
            if (worker.state === "redundant")
              message.textContent =
                "No se pudo preparar el modo sin conexión. Reabre el visor con internet.";
          });
        });
        navigator.serviceWorker.ready.then(() => {
          if (!result.waiting)
            message.textContent =
              "Listo sin conexión. En Android: Compartir → Visor 3D IBERO.";
        });
      })
      .catch(() => {
        message.textContent =
          "No se pudo preparar la instalación. Puedes seguir usando Cargar STL.";
      });
  } else {
    message.textContent =
      "Para instalar y usar sin conexión, abre la página mediante HTTPS en Chrome.";
  }

  const url = new URL(location.href),
    id = url.searchParams.get("shared"),
    error = url.searchParams.get("share-error");
  if (id || error) {
    url.searchParams.delete("shared");
    url.searchParams.delete("share-error");
    history.replaceState(history.state, "", url);
    if (error) {
      const errors = {
        multiple: "Comparte un solo archivo STL a la vez.",
        missing:
          "La aplicación de origen no entregó el archivo. Guárdalo en Descargas y usa Cargar STL.",
        type: "El archivo compartido debe ser un STL no vacío, con extensión .stl.",
        storage:
          "No se pudo recibir el archivo compartido. Guárdalo en Descargas y usa Cargar STL.",
      };
      onStatus(errors[error] || errors.missing, true);
    } else {
      takeSharedFile(id)
        .then((file) => {
          if (file) onFile(file);
          else
            onStatus(
              "El archivo compartido ya se abrió o dejó de estar disponible. Compártelo de nuevo o usa Cargar STL.",
              true,
            );
        })
        .catch(() =>
          onStatus(
            "No se pudo recuperar el archivo compartido. Usa Cargar STL.",
            true,
          ),
        );
    }
  }
}
