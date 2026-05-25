export async function mountDeveloperDiagnosticsPanel() {
  if ((typeof window === "undefined") || (typeof document === "undefined") || (typeof customElements === "undefined")) return;

  try {
    await import("../wc/DeveloperDiagnostics/ErrorPanel.mjs");
  } catch (error) {
    console.error("Developer diagnostics panel failed to load.", error);
    return;
  }

  const mount = () => {
    if (!document.body) return;
    if (typeof document.querySelector === "function" && document.querySelector("dgm-dev-error-panel")) return;
    document.body.appendChild(document.createElement("dgm-dev-error-panel"));
  };

  if (document.body) {
    mount();
  } else {
    document.addEventListener("DOMContentLoaded", mount, { once: true });
  }
}
