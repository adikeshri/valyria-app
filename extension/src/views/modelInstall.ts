/**
 * The shared "accept the license, then install" flow (§20 / §4.21). Used by
 * the Model Manager and the first-run model step so the license prompt and
 * the `model/install` call are written once.
 *
 * The extension never downloads weights — this only opens the license text,
 * takes the user's explicit acceptance, and forwards `model/install` (with
 * `acceptLicense: true`) to Core, which owns every byte.
 */
import * as vscode from "vscode";
import type { BridgeHost } from "../bridge/host";

interface InspectResult {
  id: string;
  display_name: string;
  license_name: string;
  license_url?: string | null;
  license_text?: string | null;
  size_bytes: number;
}

/**
 * Inspect `id`, show its license in an editor tab and a modal, and — on
 * acceptance — start the install. Returns `true` when the install was
 * started, `false` when the user cancelled or it failed.
 */
export async function promptAndInstallModel(host: BridgeHost, id: string): Promise<boolean> {
  let inspect: InspectResult;
  try {
    inspect = (await host.client.request("model/inspect", { id })) as InspectResult;
  } catch (e) {
    void vscode.window.showErrorMessage(`Valyria: could not read ${id} — ${String(e)}`);
    return false;
  }

  const body =
    inspect.license_text?.trim() ||
    (inspect.license_url ? `Full text: ${inspect.license_url}` : "No license text is available offline.");
  const doc = await vscode.workspace.openTextDocument({
    content: `${inspect.display_name} — ${inspect.license_name}\n${"=".repeat(60)}\n\n${body}\n`,
    language: "plaintext",
  });
  await vscode.window.showTextDocument(doc, { preview: true });

  const ACCEPT = "Accept & install";
  const choice = await vscode.window.showWarningMessage(
    `Install ${inspect.display_name}?`,
    {
      modal: true,
      detail:
        `License: ${inspect.license_name}. The full text is open in the editor. ` +
        `Accepting records your agreement; Core then downloads the weights ` +
        `(${(inspect.size_bytes / 1e9).toFixed(1)} GB) locally.`,
    },
    ACCEPT
  );
  if (choice !== ACCEPT) return false;

  try {
    await host.client.request("model/install", { id, acceptLicense: true });
    void vscode.window.showInformationMessage(`Valyria: installing ${inspect.display_name}.`);
    return true;
  } catch (e) {
    void vscode.window.showErrorMessage(`Valyria: install failed — ${String(e)}`);
    return false;
  }
}
