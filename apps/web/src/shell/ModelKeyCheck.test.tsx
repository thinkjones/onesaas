import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { afterEach, expect, test, vi } from 'vitest';
import { OnboardingGate } from '../routes.tsx';
import ModelKeyCheck from './ModelKeyCheck.tsx';

function Where() {
  const { pathname, search } = useLocation();
  return <p data-testid="where">{`${pathname}${search}`}</p>;
}

function launch(status: string, onboarded = true, start = '/') {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      const body =
        url === '/api/models/check'
          ? { status }
          : url === '/api/settings'
            ? { timezone: 'UTC', textSize: 'normal', onboarded, moodFileIds: [] }
            : {};
      return { ok: true, status: 200, json: async () => body } as Response;
    }),
  );
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[start]}>
        <ModelKeyCheck />
        <Routes>
          <Route path="welcome" element={<Where />} />
          <Route path="*" element={<OnboardingGate><Where /></OnboardingGate>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

afterEach(() => vi.unstubAllGlobals());

test.each(['rejected', 'missing'])('after setup, a %s key goes straight to Settings', async (status) => {
  launch(status);
  await waitFor(() => {
    expect(screen.getByTestId('where').textContent).toBe('/settings?fix=model');
  });
});

test.each(['ok', 'unknown'])('a key that is %s leaves launch alone', async (status) => {
  launch(status);
  await act(async () => {
    await new Promise((r) => setTimeout(r, 30));
  });
  expect(screen.getByTestId('where').textContent).toBe('/');
});

test('during setup a bad key is left to the setup step', async () => {
  launch('rejected', false);
  await act(async () => {
    await new Promise((r) => setTimeout(r, 30));
  });
  expect(screen.getByTestId('where').textContent).toBe('/welcome');
});
