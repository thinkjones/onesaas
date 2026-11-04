import { useState } from 'react';
import { ApiError, installExtension } from './api.ts';
import AppButton from './design/AppButton.tsx';

const EXTENSIONS_PAGE = 'chrome://extensions';

/**
 * Hands over the Chrome extension: it comes with the app, so this puts it in a
 * folder and walks through loading it. A web page can't link to chrome:// pages,
 * so that address is there to copy.
 */
export default function GetExtension() {
  const [folder, setFolder] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const get = async () => {
    setBusy(true);
    setError(null);
    try {
      setFolder((await installExtension()).path);
    } catch (err) {
      setError(err instanceof ApiError && err.message ? err.message : "I couldn't get the extension. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="get-extension">
      <AppButton type="button" variant="outline" size="sm" className="w-fit" disabled={busy} onClick={() => void get()}>
        {folder === null ? 'Get the extension' : 'Show the folder again'}
      </AppButton>
      {error !== null && (
        <p role="alert" className="m-0 text-destructive">
          {error}
        </p>
      )}
      {folder !== null && (
        <>
          <p className="m-0">
            It&apos;s in <code className="break-all">{folder}</code>. Then, in Chrome:
          </p>
          <ol className="m-0 list-decimal pl-5">
            <li>
              Open <code>{EXTENSIONS_PAGE}</code>{' '}
              <button
                type="button"
                className="get-extension-copy"
                onClick={() => {
                  void navigator.clipboard?.writeText(EXTENSIONS_PAGE);
                  setCopied(true);
                }}
              >
                {copied ? 'Copied' : 'Copy'}
              </button>
            </li>
            <li>Turn on Developer mode, at the top right.</li>
            <li>Click Load unpacked and choose that folder.</li>
          </ol>
        </>
      )}
    </div>
  );
}
