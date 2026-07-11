import { assertWorkspaceDom } from "./dom-contract.js";
import { createWorkspaceState } from "./state.js";
import { createRouter } from "./router.js";
import { createShellController } from "./shell-controller.js";
import { createFilesController } from "./files-controller.js";
import { createAccountController } from "./account-controller.js";

assertWorkspaceDom();

const hooks = {};
const state = createWorkspaceState();
const router = createRouter({ state, hooks });
const shell = createShellController({ state, router, hooks });
const files = createFilesController({ hooks });
const account = createAccountController({ state, router, hooks });

Object.assign(hooks, {
  shell,
  filesController: files,
  accountController: account,
  requestedAccountTab: ["files", "integrations", "settings", "feedback"].includes(location.hash.slice(1))
    ? location.hash.slice(1)
    : "",
});

const runtime = {
  state,
  router,
  shell,
  files,
  account,
  hooks,
  registerHooks(next) { Object.assign(hooks, next || {}); },
};

window.__quiloWorkspaceRuntime = runtime;
window.QuiloSetView = shell.setView;

await import("../app.js");

shell.init();
files.init();
await account.init();

