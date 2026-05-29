import { initializeBrowserApplicationShell } from "./browser-shell.js";
import { initializeWorkspaceApp } from "./workspace.js";

if (typeof document !== "undefined") {
  void initializeBrowserApplicationShell({ pageController: (shell) => initializeWorkspaceApp(shell, "player workspace") });
}

