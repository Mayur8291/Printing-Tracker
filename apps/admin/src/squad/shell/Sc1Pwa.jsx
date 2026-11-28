// Offline, new-version and install messages, shown only inside the Scott One shell.
import { useState, useSyncExternalStore } from "react";
import { Sheet, Button, Icon } from "../../scott-one-ui";
import { subscribePwa, pwaSnapshot, promptInstall, applyUpdate, isStandalone, isIos } from "../../pwa";

const DISMISS_KEY = "sc1.install.dismissed";
const dismissedRecently = () => { try { return Date.now() - Number(localStorage.getItem(DISMISS_KEY) || 0) < 14 * 864e5; } catch { return false; } };

export const usePwa = () => useSyncExternalStore(subscribePwa, pwaSnapshot, pwaSnapshot);
export const installAvailable = (pwa) => !isStandalone() && (pwa.canInstall || isIos());

export function IosInstallSheet({ open, onOpenChange }) {
  return <Sheet open={open} onOpenChange={onOpenChange} title="Install Scott One" description="Add it to your home screen to open it like an app. You sign in once more inside the installed app." footer={<Button onClick={() => onOpenChange(false)}>Got it</Button>}>
    <ol className="sc1-install-steps">
      <li>Open this page in Safari.</li>
      <li><Icon name="share" size={20} /> Tap the Share button.</li>
      <li><Icon name="plus" size={20} /> Choose “Add to Home Screen”, then “Add”.</li>
    </ol>
  </Sheet>;
}

export function Sc1PwaStatus({ tabRoot }) {
  const pwa = usePwa();
  const [hidden, setHidden] = useState(dismissedRecently), [help, setHelp] = useState(false), [laterUpdate, setLaterUpdate] = useState(false);
  const dismiss = () => { setHidden(true); try { localStorage.setItem(DISMISS_KEY, String(Date.now())); } catch { /* Hidden for this visit only. */ } };
  const install = () => (pwa.canInstall ? promptInstall() : setHelp(true));
  const update = pwa.updateReady && !laterUpdate;
  const offer = !update && pwa.online && !hidden && tabRoot && installAvailable(pwa);
  return <>
    {!pwa.online && <p className="sc1 sc1-offline" role="status"><Icon name="info" size={18} />You're offline. Screens may be out of date and changes can't be saved.</p>}
    {(update || offer) && <div className="sc1 sc1-pwa-banner" role="status">
      <p><strong>{update ? "A new version is ready" : "Install Scott One"}</strong><span>{update ? "Reload to use it." : "Open it from your home screen."}</span></p>
      <button type="button" className="sc1-pwa-later" onClick={update ? () => setLaterUpdate(true) : dismiss}>{update ? "Later" : "Not now"}</button>
      <button type="button" className="sc1-pwa-go" onClick={update ? applyUpdate : install}>{update ? "Reload" : "Install"}</button>
    </div>}
    <IosInstallSheet open={help} onOpenChange={setHelp} />
  </>;
}
