import { useQueryClient } from '@tanstack/react-query';
import type { Workflow } from '@dad/shared';
import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { getWorkflows } from '../api.ts';
import { TELL_ME_MORE_EVENT } from './useAltClickExplain.ts';

/**
 * Off-workflow "Tell me more" fallback (M5 Task 6 fix): Explain's "Tell me
 * more" must open the agent panel with "Tell me more about <label>" sent, on
 * EVERY page — but only WorkflowPage has a helper panel. This null-rendering
 * listener (mounted once in AppShell, inside the router) routes the event to
 * one: the most-recent reducer's design page, with the message as
 * `agentPrompt` — the proven HomePage → WorkflowPage opening-send path, so
 * the panel opens and the message sends.
 *
 * - On a workflow page (`/reducers/:id`) it stays out of the way:
 *   WorkflowPage's own listener uncollapses the panel and sends directly.
 * - With no reducers yet there is no panel to send to, so it routes Home
 *   with the message prefilled in the box (`homePrefill` state) instead of
 *   silently creating a reducer Dad never asked for. Never a dead click:
 *   even a failed workflows fetch lands Home with the prefill.
 */
export default function TellMeMoreFallback() {
  const navigate = useNavigate();
  const location = useLocation();
  const client = useQueryClient();
  // Re-subscribed per pathname so the handler always reads the CURRENT route
  // (window.location is NOT router-synced under MemoryRouter, so the handler
  // cannot read it at event time).
  const pathname = location.pathname;

  useEffect(() => {
    const onTellMeMore = (e: Event): void => {
      const message = (e as CustomEvent<{ message?: unknown }>).detail?.message;
      if (typeof message !== 'string' || message.trim().length === 0) return;
      // A workflow page (id segment present — bare `/reducers` and a bare
      // trailing slash match no workflow route, so the fallback acts there).
      if (/^\/reducers\/[^/]+/.test(pathname)) return;
      const text = message.trim();
      void (async () => {
        let wfs = client.getQueryData<Workflow[]>(['workflows']);
        if (wfs === undefined) {
          try {
            wfs = await client.fetchQuery({ queryKey: ['workflows'], queryFn: getWorkflows });
          } catch {
            wfs = undefined;
          }
        }
        // GET /api/workflows lists newest first (repo.listWorkflows), so the
        // head is the most-recent reducer.
        const target = wfs?.[0];
        if (target) {
          navigate(`/reducers/${target.id}?mode=design`, { state: { agentPrompt: text } });
        } else {
          navigate('/', { state: { homePrefill: text } });
        }
      })();
    };
    window.addEventListener(TELL_ME_MORE_EVENT, onTellMeMore);
    return () => window.removeEventListener(TELL_ME_MORE_EVENT, onTellMeMore);
  }, [client, navigate, pathname]);

  return null;
}
