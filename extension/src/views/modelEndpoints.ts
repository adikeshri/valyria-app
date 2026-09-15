/**
 * External model endpoints (§ M6) and signed catalog refresh — Command
 * Palette flows, the same shape as `modelInstall.ts`'s license-acceptance
 * prompt: these are occasional admin actions, not something that needs a
 * persistent webview form. The extension never talks to an endpoint's
 * server directly and never verifies a catalog signature itself — both
 * are entirely Core's job (`model_endpoints` / `catalog_refresh`
 * capabilities); this file only collects the inputs and forwards them.
 */
import * as vscode from "vscode";
import type { BridgeHost } from "../bridge/host";

interface EndpointWire {
  id: string;
  base_url: string;
  display_name: string;
  remote_model_name: string;
  context_length: number;
  supports_native_tools: boolean;
  supports_grammar: boolean;
  active_roles?: string[];
}

interface CatalogRefreshOutcome {
  previous_version: number;
  new_version: number;
  model_count: number;
}

async function listEndpoints(host: BridgeHost): Promise<EndpointWire[]> {
  const r = (await host.client.request("model/endpointList", {})) as {
    endpoints?: EndpointWire[];
  };
  return r.endpoints ?? [];
}

/** Prompt for id/base_url/(optional) remote model name, register it. */
export async function promptAndAddModelEndpoint(host: BridgeHost): Promise<void> {
  const id = await vscode.window.showInputBox({
    title: "Add Model Endpoint (1/3)",
    prompt: "A short local name for this server (must not match a catalog model id)",
    placeHolder: "e.g. ollama-local",
    validateInput: (v) => (v.trim() ? undefined : "required"),
  });
  if (!id) return;

  const baseUrl = await vscode.window.showInputBox({
    title: "Add Model Endpoint (2/3)",
    prompt: "Base URL of the running OpenAI-compatible server",
    placeHolder: "e.g. http://127.0.0.1:11434/v1",
    validateInput: (v) =>
      /^https?:\/\/.+/.test(v.trim()) ? undefined : "must start with http:// or https://",
  });
  if (!baseUrl) return;

  const remoteModelName = await vscode.window.showInputBox({
    title: "Add Model Endpoint (3/3)",
    prompt:
      "The exact model name this server expects in each request (leave blank to default to the id above — only correct if the server happens to use that same name)",
    placeHolder: id,
  });

  try {
    const trimmedRemoteModelName = remoteModelName?.trim();
    await host.client.request("model/endpointAdd", {
      id,
      baseUrl,
      ...(trimmedRemoteModelName ? { remoteModelName: trimmedRemoteModelName } : {}),
    });
    void vscode.window.showInformationMessage(`Valyria: registered endpoint "${id}".`);
  } catch (e) {
    void vscode.window.showErrorMessage(`Valyria: could not add endpoint — ${String(e)}`);
  }
}

/** Pick a registered endpoint from a QuickPick and unregister it. */
export async function promptAndRemoveModelEndpoint(host: BridgeHost): Promise<void> {
  let endpoints: EndpointWire[];
  try {
    endpoints = await listEndpoints(host);
  } catch (e) {
    void vscode.window.showErrorMessage(`Valyria: could not list endpoints — ${String(e)}`);
    return;
  }
  if (endpoints.length === 0) {
    void vscode.window.showInformationMessage("Valyria: no registered endpoints.");
    return;
  }

  const picked = await vscode.window.showQuickPick(
    endpoints.map((e) => ({
      label: e.id,
      description: e.base_url,
      detail: e.active_roles?.length ? `active: ${e.active_roles.join(", ")}` : "",
    })),
    { title: "Remove Model Endpoint", placeHolder: "Select an endpoint to remove" }
  );
  if (!picked) return;

  const REMOVE = "Remove";
  const choice = await vscode.window.showWarningMessage(
    `Remove endpoint "${picked.label}"? Any role currently pointing at it will be unbound.`,
    { modal: true },
    REMOVE
  );
  if (choice !== REMOVE) return;

  try {
    await host.client.request("model/endpointRemove", { id: picked.label });
    void vscode.window.showInformationMessage(`Valyria: removed endpoint "${picked.label}".`);
  } catch (e) {
    void vscode.window.showErrorMessage(`Valyria: remove failed — ${String(e)}`);
  }
}

/** Read-only listing, rendered as a QuickPick so it's dismissable and
 *  searchable like everything else in the palette — picking a row just
 *  shows its full detail rather than doing anything destructive. */
export async function showModelEndpoints(host: BridgeHost): Promise<void> {
  let endpoints: EndpointWire[];
  try {
    endpoints = await listEndpoints(host);
  } catch (e) {
    void vscode.window.showErrorMessage(`Valyria: could not list endpoints — ${String(e)}`);
    return;
  }
  if (endpoints.length === 0) {
    void vscode.window.showInformationMessage("Valyria: no registered endpoints.");
    return;
  }
  const picked = await vscode.window.showQuickPick(
    endpoints.map((e) => ({
      label: e.id,
      description: e.base_url,
      detail: `model=${e.remote_model_name} ctx=${e.context_length}${
        e.active_roles?.length ? `  active: ${e.active_roles.join(", ")}` : ""
      }`,
    })),
    { title: "Model Endpoints" }
  );
  if (picked) {
    void vscode.window.showInformationMessage(
      `${picked.label} — ${picked.description}\n${picked.detail}`
    );
  }
}

/** Prompt for a catalog URL + its detached signature URL, verify + accept. */
export async function promptAndRefreshCatalog(host: BridgeHost): Promise<void> {
  const catalogUrl = await vscode.window.showInputBox({
    title: "Refresh Catalog (1/2)",
    prompt: "URL of the candidate catalog.json",
    placeHolder: "https://example.com/catalog.json",
    validateInput: (v) =>
      /^https?:\/\/.+/.test(v.trim()) ? undefined : "must start with http:// or https://",
  });
  if (!catalogUrl) return;

  const signatureUrl = await vscode.window.showInputBox({
    title: "Refresh Catalog (2/2)",
    prompt: "URL of its detached ed25519 signature",
    placeHolder: `${catalogUrl}.sig`,
    value: `${catalogUrl}.sig`,
    validateInput: (v) =>
      /^https?:\/\/.+/.test(v.trim()) ? undefined : "must start with http:// or https://",
  });
  if (!signatureUrl) return;

  try {
    const outcome = (await host.client.request("catalog/refresh", {
      catalogUrl,
      signatureUrl,
    })) as CatalogRefreshOutcome;
    void vscode.window.showInformationMessage(
      `Valyria: catalog refreshed (version ${outcome.previous_version} → ${outcome.new_version}, ${outcome.model_count} models). Core verified the signature against its own trusted key — nothing here re-checks it.`
    );
  } catch (e) {
    void vscode.window.showErrorMessage(`Valyria: catalog refresh failed — ${String(e)}`);
  }
}
