import { useQueryClient } from '@tanstack/react-query';
import Check from 'lucide-react/icons/check';
import { useEffect, useRef, useState } from 'react';
import {
  ApiError,
  getModelConnection,
  getModelKeyCheck,
  putModelConnection,
  type ModelKeyStatus,
} from '../api.ts';
import AppButton from '../design/AppButton.tsx';
import { KEY_PROBLEM } from '../shell/fixModelKey.ts';

/**
 * Saves the key through the same connection Settings uses, then asks the model
 * whether it works. Continue stays shut until it does, unless the check can't
 * tell either way.
 */
export default function StepModel({
  onNext,
  onSkip,
  onTone,
  footerStart,
}: {
  onNext(): void;
  onSkip(): void;
  onTone(failed: boolean): void;
  footerStart: React.ReactNode;
}) {
  const client = useQueryClient();
  const keyInput = useRef<HTMLInputElement | null>(null);
  const [key, setKey] = useState('');
  const [address, setAddress] = useState('');
  const [model, setModel] = useState('');
  const [hasSavedKey, setHasSavedKey] = useState(false);
  const [hasEnvKey, setHasEnvKey] = useState(false);
  const [status, setStatus] = useState<ModelKeyStatus | null>(null);
  const [checking, setChecking] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  // Edited since the last check, so the old answer no longer applies.
  const [dirty, setDirty] = useState(false);

  const check = async (): Promise<ModelKeyStatus> => {
    setChecking(true);
    try {
      const { status: next } = await getModelKeyCheck();
      client.setQueryData(['model-check'], { status: next });
      setStatus(next);
      onTone(next === 'missing' || next === 'rejected');
      return next;
    } catch {
      setStatus('unknown');
      return 'unknown';
    } finally {
      setChecking(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    void getModelConnection().then(
      (saved) => {
        if (cancelled) return;
        setAddress(saved.baseUrl);
        setModel(saved.model);
        setHasSavedKey(saved.hasApiKey);
        setHasEnvKey(saved.hasEnvKey === true);
        // A key is already here, so there's nothing to ask for: go straight to the check.
        if (saved.hasApiKey || saved.hasEnvKey === true) void check();
      },
      () => {},
    );
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const edit = (set: (value: string) => void) => (e: React.ChangeEvent<HTMLInputElement>) => {
    set(e.target.value);
    setDirty(true);
    setSaveError(null);
    onTone(false);
  };

  const saveAndCheck = async (): Promise<ModelKeyStatus | null> => {
    setSaveError(null);
    setChecking(true);
    try {
      const next = await putModelConnection({ baseUrl: address, model, ...(key === '' ? {} : { apiKey: key }) });
      setHasSavedKey(next.hasApiKey);
      setKey('');
      setDirty(false);
      void client.invalidateQueries({ queryKey: ['model-connection'] });
      void client.invalidateQueries({ queryKey: ['model-status'] });
    } catch (err) {
      setChecking(false);
      setSaveError(err instanceof ApiError && err.message ? err.message : "I couldn't save that. Try again.");
      return null;
    }
    return check();
  };

  const primary = async () => {
    if (!dirty && (status === 'ok' || status === 'unknown')) return onNext();
    const next = await saveAndCheck();
    if (next === 'ok') onNext();
    // The button that was pressed is now shut, so focus goes to what needs fixing.
    if (next === 'missing' || next === 'rejected') keyInput.current?.focus();
  };

  const failed = !dirty && (status === 'missing' || status === 'rejected');
  const nothingToCheck = status === null && !dirty && !hasSavedKey && !hasEnvKey;
  const blocked = checking || failed || nothingToCheck;

  return (
    <>
      {hasEnvKey && !hasSavedKey && (
        <p className="onb-note">I found a key already set on this computer, so you don&apos;t need to paste one.</p>
      )}
      <div className="onb-field">
        <label htmlFor="onboarding-model-key">API key</label>
        <input
          ref={keyInput}
          id="onboarding-model-key"
          className="onb-input onb-mono"
          type="password"
          autoComplete="off"
          placeholder={hasSavedKey ? 'Saved. Type to replace it.' : 'Paste your key'}
          value={key}
          onChange={edit(setKey)}
        />
      </div>
      <details className="onb-details">
        <summary>Use a different service address</summary>
        <div className="onb-field">
          <label htmlFor="onboarding-model-address">Service address</label>
          <input
            id="onboarding-model-address"
            className="onb-input onb-mono"
            type="url"
            autoComplete="off"
            placeholder="https://api.openai.com/v1"
            value={address}
            onChange={edit(setAddress)}
          />
        </div>
        <div className="onb-field">
          <label htmlFor="onboarding-model-name">Model name</label>
          <input
            id="onboarding-model-name"
            className="onb-input"
            autoComplete="off"
            placeholder="The model name on this service"
            value={model}
            onChange={edit(setModel)}
          />
        </div>
      </details>
      {saveError !== null && (
        <p role="alert" className="m-0 text-destructive">
          {saveError}
        </p>
      )}
      {checking && (
        <p role="status" className="onb-note">
          Working…
        </p>
      )}
      {!checking && !dirty && status === 'ok' && (
        <div role="status" className="onb-check" data-state="ok">
          <span className="onb-check-dot" aria-hidden>
            <Check />
          </span>
          <span className="onb-check-text">
            <span className="font-semibold">Your model answered. I&apos;m ready to think.</span>
            <span className="onb-meta text-success">Done · checked just now</span>
          </span>
          <AppButton type="button" variant="outline" size="sm" onClick={() => void check()}>
            Check again
          </AppButton>
        </div>
      )}
      {!checking && !dirty && status === 'unknown' && (
        <div role="status" className="onb-check" data-state="unknown">
          <span className="onb-check-text">
            <span className="font-semibold">I couldn&apos;t check this from here.</span>
            <span className="onb-meta">You can carry on, and I&apos;ll tell you if it doesn&apos;t work.</span>
          </span>
          <AppButton type="button" variant="outline" size="sm" onClick={() => void check()}>
            Check again
          </AppButton>
        </div>
      )}
      {!checking && failed && (
        <div role="alert" className="onb-check" data-state="failed">
          <span className="onb-check-text">
            <span className="onb-pill-failed">Needs a look</span>
            <span>{KEY_PROBLEM[status as keyof typeof KEY_PROBLEM]}</span>
          </span>
        </div>
      )}
      <div className="onb-footer">
        {footerStart}
        <span className="onb-footer-end">
          <AppButton type="button" variant="ghost" onClick={onSkip}>
            Skip for now
          </AppButton>
          <AppButton type="button" variant="brand" disabled={blocked} onClick={() => void primary()}>
            Looks good
          </AppButton>
        </span>
      </div>
    </>
  );
}
