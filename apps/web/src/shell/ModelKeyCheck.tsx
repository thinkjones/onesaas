import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { getModelKeyCheck, useSettings } from '../api.ts';
import { FIX_MODEL_KEY_PATH } from './fixModelKey.ts';

/**
 * A key the model won't accept means nothing works, so launch starts at the fix.
 * Not during setup: onboarding has its own step for this, and anyone who skips it
 * hears about it on their next launch.
 */
export default function ModelKeyCheck() {
  const navigate = useNavigate();
  const { pathname, search } = useLocation();
  const { settings } = useSettings();
  const { data } = useQuery({
    queryKey: ['model-check'],
    queryFn: getModelKeyCheck,
    staleTime: Infinity,
  });
  // Once per launch, but only settled on arrival: onboarding's own redirect can
  // land in the same tick and win.
  const settled = useRef(false);
  useEffect(() => {
    if (settled.current || data === undefined || !settings) return;
    if (!settings.onboarded) {
      settled.current = true;
      return;
    }
    const problem = data.status === 'missing' || data.status === 'rejected';
    if (!problem || `${pathname}${search}` === FIX_MODEL_KEY_PATH) settled.current = true;
    else navigate(FIX_MODEL_KEY_PATH, { replace: true });
  }, [data, settings, navigate, pathname, search]);
  return null;
}
