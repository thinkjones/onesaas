import Check from 'lucide-react/icons/check';
import Globe from 'lucide-react/icons/globe';
import Monitor from 'lucide-react/icons/monitor';
import { useEffect, useRef, useState } from 'react';
import AppButton from '../design/AppButton.tsx';
import { usePairing } from '../usePairing.ts';

/** GitHub-rendered README section with the install steps. */
const EXTENSION_INSTALL_URL =
  'https://github.com/thinkjones/meta-ai-hackathon-my-dads-ai-agent#2-install-the-chrome-extension';

const WEBSITE_TAGS = ['Booking sites', 'Supplier portals', 'Permit offices', 'Any website'];

function PairItem({ done, n, children }: { done: boolean; n: number; children: React.ReactNode }) {
  return (
    <li className="onb-pair-item" data-done={done}>
      <span className="onb-pair-dot" aria-hidden>
        {done ? <Check /> : n}
      </span>
      <div className="onb-pair-body">{children}</div>
    </li>
  );
}

/**
 * Explains the two parts, then pairs them. The extension can't be seen until it
 * pairs, so all three items complete together.
 */
export default function StepConnect({
  onFinish,
  onPaired,
  footerStart,
}: {
  onFinish(paired: boolean): void;
  onPaired?(paired: boolean): void;
  footerStart: React.ReactNode;
}) {
  const { status, code, error, connect } = usePairing();
  const paired = status?.paired === true;
  const [copied, setCopied] = useState(false);

  // Nothing to press first: the code is ready when the step opens.
  const asked = useRef(false);
  useEffect(() => {
    if (status === null || status.paired || asked.current) return;
    asked.current = true;
    void connect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  useEffect(() => {
    onPaired?.(paired);
  }, [paired, onPaired]);

  const shownCode = code === null ? '' : `${code.slice(0, 3)} ${code.slice(3)}`;

  return (
    <>
      <div className="onb-parts">
        <div className="onb-part">
          <span className="onb-part-title">
            <Monitor aria-hidden />
            This desktop app is in charge
          </span>
          <p className="m-0">
            It runs your business here on your computer. Your automations, customer records and keys stay on this computer, and nothing goes out until you say so.
          </p>
          <span className="onb-tags-small">
            <span className="onb-pill">Runs on this computer</span>
            <span className="onb-pill">Private</span>
          </span>
        </div>
        <div className="onb-part-link">
          <span aria-hidden className="onb-part-line" />
          <span className="section-label">Asks, then acts</span>
          <span aria-hidden className="onb-part-line" />
        </div>
        <div className="onb-part">
          <span className="onb-part-title">
            <Globe aria-hidden />
            The Chrome extension does the clicking
          </span>
          <p className="m-0">
            It works on any website you already use: booking sites, supplier portals, permit offices, payment pages, your email. It only works on a page when an automation you published needs it.
          </p>
          <span className="onb-tags-small">
            {WEBSITE_TAGS.map((tag) => (
              <span key={tag} className="onb-well-tag">
                {tag}
              </span>
            ))}
          </span>
        </div>
      </div>
      <h2 className="section-label m-0">Pair it once</h2>
      {error !== null && (
        <p role="alert" className="m-0 text-destructive">
          {error}
        </p>
      )}
      <ol className="onb-pair">
        <PairItem done={paired} n={1}>
          <a href={EXTENSION_INSTALL_URL} target="_blank" rel="noreferrer">
            Add the OneSaaS extension to Chrome.
          </a>
        </PairItem>
        <PairItem done={paired} n={2}>
          <span>Click the OneSaaS icon in Chrome&apos;s toolbar and type this code.</span>
          {!paired && code !== null && (
            <>
              <span className="onb-code-row">
                <output className="onb-code" aria-label="Pairing code">
                  {shownCode}
                </output>
                <AppButton
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    void navigator.clipboard?.writeText(code);
                    setCopied(true);
                  }}
                >
                  {copied ? 'Copied' : 'Copy code'}
                </AppButton>
              </span>
              <span className="onb-meta">Working… waiting for Chrome · code lasts 10 minutes</span>
            </>
          )}
        </PairItem>
        <PairItem done={paired} n={3}>
          <span>Open any website, click the OneSaaS icon, and I&apos;ll say hello.</span>
          <span className="onb-meta">{paired ? 'Done' : 'Not started'}</span>
        </PairItem>
      </ol>
      <details className="onb-details">
        <summary>Setting up from source code</summary>
        <p className="m-0 mt-2">
          Open <code>chrome://extensions</code>, turn on Developer mode, choose Load unpacked and pick <code>apps/extension/.output/chrome-mv3</code>.
        </p>
      </details>
      <div className="onb-footer">
        {footerStart}
        <span className="onb-footer-end">
          <AppButton type="button" variant="outline" onClick={() => onFinish(false)}>
            Skip for now
          </AppButton>
          <AppButton type="button" variant="brand" disabled={!paired} onClick={() => onFinish(true)}>
            Finish setup
          </AppButton>
        </span>
      </div>
    </>
  );
}
