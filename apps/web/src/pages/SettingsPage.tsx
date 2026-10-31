import { useState } from 'react';
import { toast } from 'sonner';
import Pairing from '../Pairing.tsx';
import {
  useModelStatus,
  useSettings,
  type ModelStatus,
  type Settings,
  type SettingsPatch,
} from '../api.ts';
import { CardContent, CardHeader, CardTitle } from '../components/ui/card.tsx';
import { Switch } from '../components/ui/switch.tsx';
import AppCard from '../design/AppCard.tsx';
import type { TextSize, Theme } from '../theme/ThemeProvider.tsx';

const inputClass =
  'w-full rounded-md border border-input bg-background px-3 py-2 outline-none focus-visible:ring-2 focus-visible:ring-ring';

const THEMES: { id: Theme; name: string; bg: string; primary: string; ink: string }[] = [
  { id: 'morning', name: 'Morning', bg: 'hsl(40 33% 97%)', primary: 'hsl(22 80% 52%)', ink: 'hsl(25 20% 15%)' },
  { id: 'evening', name: 'Evening', bg: 'hsl(30 12% 11%)', primary: 'hsl(28 85% 60%)', ink: 'hsl(40 25% 92%)' },
  { id: 'workshop', name: 'Workshop', bg: 'hsl(0 0% 100%)', primary: 'hsl(220 90% 40%)', ink: 'hsl(0 0% 5%)' },
];

const TEXT_SIZES: { id: TextSize; name: string }[] = [
  { id: 'normal', name: 'Normal' },
  { id: 'large', name: 'Large' },
  { id: 'xlarge', name: 'Extra large' },
];

function allTimeZones(): string[] {
  return typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : [];
}

function isValidZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat(undefined, { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

function BusinessSection({
  settings,
  update,
}: {
  settings: Settings;
  update: (patch: SettingsPatch) => void;
}) {
  const [name, setName] = useState(settings.businessName ?? '');
  const [what, setWhat] = useState(settings.businessWhat ?? '');
  const [zone, setZone] = useState(settings.timezone);
  const zones = allTimeZones();

  return (
    <AppCard>
      <CardHeader>
        <CardTitle>Your business</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1">
          <label htmlFor="settings-business-name" className="text-sm font-medium">
            What&rsquo;s your business called?
          </label>
          <input
            id="settings-business-name"
            className={inputClass}
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => {
              if (name !== (settings.businessName ?? '')) update({ businessName: name });
            }}
            placeholder="Corner Bakery"
          />
        </div>
        <div className="space-y-1">
          <label htmlFor="settings-business-what" className="text-sm font-medium">
            What do you do?
          </label>
          <input
            id="settings-business-what"
            className={inputClass}
            value={what}
            onChange={(e) => setWhat(e.target.value)}
            onBlur={() => {
              if (what !== (settings.businessWhat ?? '')) update({ businessWhat: what });
            }}
            placeholder="We run a family bakery"
          />
        </div>
        <div className="space-y-1">
          <label htmlFor="settings-timezone" className="text-sm font-medium">
            Timezone
          </label>
          <input
            id="settings-timezone"
            className={inputClass}
            list="settings-timezone-list"
            value={zone}
            onChange={(e) => setZone(e.target.value)}
            onBlur={() => {
              if (zone === settings.timezone) return;
              if (zone !== '' && isValidZone(zone)) {
                update({ timezone: zone });
              } else {
                toast('Pick a timezone from the list.');
                setZone(settings.timezone);
              }
            }}
            placeholder="Start typing your city…"
            autoComplete="off"
          />
          <datalist id="settings-timezone-list">
            {zones.map((z) => (
              <option key={z} value={z} />
            ))}
          </datalist>
        </div>
      </CardContent>
    </AppCard>
  );
}

function LookSection({
  settings,
  update,
}: {
  settings: Settings;
  update: (patch: SettingsPatch) => void;
}) {
  return (
    <AppCard>
      <CardHeader>
        <CardTitle>Look</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <div
          className="grid grid-cols-1 gap-3 sm:grid-cols-3"
          role="radiogroup"
          aria-label="Theme"
        >
          {THEMES.map((t) => {
            const selected = settings.theme === t.id;
            return (
              <button
                key={t.id}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => update({ theme: t.id })}
                className={`overflow-hidden rounded-[var(--radius)] border bg-card text-left outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                  selected ? 'border-primary ring-2 ring-ring' : 'border-border'
                }`}
              >
                <span className="flex items-center gap-2 p-3" style={{ background: t.bg }} aria-hidden>
                  <span
                    className="inline-block h-5 w-5 shrink-0 rounded-full"
                    style={{ background: t.primary }}
                  />
                  <span className="flex min-w-0 flex-1 flex-col gap-1">
                    <span className="h-2 w-3/4 rounded-full" style={{ background: t.ink }} />
                    <span
                      className="h-2 w-1/2 rounded-full opacity-60"
                      style={{ background: t.ink }}
                    />
                  </span>
                </span>
                <span className="block px-3 py-2 text-sm font-medium">
                  {t.name}
                  {selected && <span className="text-muted-foreground"> ✓</span>}
                </span>
              </button>
            );
          })}
        </div>
        <div className="space-y-1">
          <span id="text-size-label" className="text-sm font-medium">
            Text size
          </span>
          <div
            className="flex w-fit rounded-lg border border-border p-1"
            role="radiogroup"
            aria-labelledby="text-size-label"
          >
            {TEXT_SIZES.map((s) => {
              const selected = settings.textSize === s.id;
              return (
                <button
                  key={s.id}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => update({ textSize: s.id })}
                  className={`rounded-md px-4 py-2 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                    selected ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'
                  }`}
                >
                  {s.name}
                </button>
              );
            })}
          </div>
        </div>
      </CardContent>
    </AppCard>
  );
}

function SoundSection({
  settings,
  update,
}: {
  settings: Settings;
  update: (patch: SettingsPatch) => void;
}) {
  const percent = Math.round(settings.sound.volume * 100);
  return (
    <AppCard>
      <CardHeader>
        <CardTitle>Sound</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between gap-4">
          <label htmlFor="settings-sound-on" className="text-sm font-medium">
            Play background sound and chimes
          </label>
          <Switch
            id="settings-sound-on"
            checked={settings.sound.on}
            onCheckedChange={(on) => update({ sound: { ...settings.sound, on } })}
          />
        </div>
        <div className="flex items-center gap-4">
          <label htmlFor="settings-sound-volume" className="shrink-0 text-sm font-medium">
            Volume
          </label>
          <input
            id="settings-sound-volume"
            type="range"
            min={0}
            max={100}
            value={percent}
            disabled={!settings.sound.on}
            onChange={(e) =>
              update({ sound: { ...settings.sound, volume: Number(e.target.value) / 100 } })
            }
            className="w-full accent-[hsl(var(--primary))] disabled:opacity-40"
          />
          <span className="w-12 shrink-0 text-right text-sm tabular-nums">{percent}%</span>
        </div>
      </CardContent>
    </AppCard>
  );
}

const ROLE_LABELS: Record<ModelStatus['role'], string> = {
  builder: 'Building chore reducers',
  planner: 'Big plans',
  triage: 'Inbox sorting',
  vision: 'Reading web pages',
};

// Exact ids only: substring matching would mislabel future model families.
// Keep in sync with the server's DEFAULT_ROLES in models/gateway.ts.
const META_MODEL_NAMES: Record<string, string> = {
  'muse-spark-1.3': 'Muse Spark',
  'muse-wonder-1.0': 'Muse Wonder',
};

function modelDisplayName(row: ModelStatus): string {
  if (row.provider === 'glimmer') return 'Muse Glimmer';
  return META_MODEL_NAMES[row.model] ?? row.model;
}

function ThinkingSection() {
  const { data, isError } = useModelStatus();
  const triage = data?.find((row) => row.role === 'triage');
  const onGlimmer = triage?.provider === 'glimmer' && triage.healthy;
  return (
    <AppCard>
      <CardHeader>
        <CardTitle>Thinking</CardTitle>
      </CardHeader>
      <CardContent>
        {data === undefined && !isError && (
          <p className="text-muted-foreground">Checking which model handles what…</p>
        )}
        {isError && (
          <p className="text-muted-foreground">Couldn&rsquo;t check which model handles what.</p>
        )}
        {data !== undefined && (
          <div className="space-y-1">
            <p>
              {onGlimmer
                ? 'Inbox sorting runs on this computer (Muse Glimmer) ✓'
                : "Inbox sorting is using Muse Spark (Glimmer isn't running on this computer)."}
            </p>
            {data
              .filter((row) => row.role !== 'triage')
              .map((row) => (
                <p key={row.role}>
                  {ROLE_LABELS[row.role] ?? row.role}: {modelDisplayName(row)}
                </p>
              ))}
          </div>
        )}
      </CardContent>
    </AppCard>
  );
}

export default function SettingsPage() {
  const { settings, update } = useSettings();
  if (!settings) {
    return (
      <div className="mx-auto max-w-3xl space-y-6 p-6">
        <h1 className="font-display text-3xl">Settings</h1>
        <p className="text-muted-foreground">Loading…</p>
      </div>
    );
  }
  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <h1 className="font-display text-3xl">Settings</h1>
      <BusinessSection settings={settings} update={update} />
      <LookSection settings={settings} update={update} />
      <SoundSection settings={settings} update={update} />
      <section aria-label="Chrome">
        <Pairing />
      </section>
      <ThinkingSection />
    </div>
  );
}
