import ActivityIcon from 'lucide-react/icons/activity';
import BrainIcon from 'lucide-react/icons/brain';
import BriefcaseIcon from 'lucide-react/icons/briefcase';
import CheckIcon from 'lucide-react/icons/check';
import PaletteIcon from 'lucide-react/icons/palette';
import RotateCcwIcon from 'lucide-react/icons/rotate-ccw';
import ServerIcon from 'lucide-react/icons/server';
import Volume2Icon from 'lucide-react/icons/volume-2';
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { toast } from 'sonner';
import Pairing from '../Pairing.tsx';
import {
  apiUrl,
  getDebugEvents,
  getPairingStatus,
  isTauri,
  useDataReset,
  useModelStatus,
  useSettings,
  type ModelStatus,
  type Settings,
  type SettingsPatch,
} from '../api.ts';
import { Switch } from '../components/ui/switch.tsx';
import AppButton from '../design/AppButton.tsx';
import CardHeading from '../design/CardHeading.tsx';
import type { TextSize } from '../theme/TextSizeProvider.tsx';

const inputClass =
  'w-full rounded-md border border-input bg-background px-3 py-2 outline-none focus-visible:ring-2 focus-visible:ring-ring';

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
    <section className="panel" aria-label="Your business">
      <CardHeading icon={BriefcaseIcon} title="Your business" />
      <div className="mt-2 space-y-4">
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
      </div>
    </section>
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
    <section className="panel" aria-label="Look">
      <CardHeading icon={PaletteIcon} title="Look" />
      <div className="mt-2 space-y-5">
        <p className="text-sm text-muted-foreground">
          Light and dark follow your computer&apos;s appearance setting.
        </p>
        <div className="space-y-1">
          <span id="text-size-label" className="text-sm font-medium">
            Text size
          </span>
          <div className="seg" role="radiogroup" aria-labelledby="text-size-label">
            {TEXT_SIZES.map((s) => {
              const selected = settings.textSize === s.id;
              return (
                <button
                  key={s.id}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => update({ textSize: s.id })}
                  className={selected ? 'on' : ''}
                >
                  {s.name}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </section>
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
    <section className="panel" aria-label="Sound">
      <CardHeading icon={Volume2Icon} title="Sound" />
      <div className="mt-2 space-y-4">
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
      </div>
    </section>
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
    <section className="panel" aria-label="Thinking">
      <CardHeading icon={BrainIcon} title="Thinking" />
      <div className="mt-2">
        {data === undefined && !isError && (
          <p className="text-muted-foreground">Checking which model handles what…</p>
        )}
        {isError && (
          <p className="text-muted-foreground">Couldn&rsquo;t check which model handles what.</p>
        )}
        {data !== undefined && (
          <div className="space-y-1">
            <p className="flex items-center gap-1.5">
              {onGlimmer ? (
                <>
                  Inbox sorting runs on this computer (Muse Glimmer)
                  <CheckIcon size={13} strokeWidth={2} aria-hidden className="text-success" />
                </>
              ) : (
                "Inbox sorting is using Muse Spark (Glimmer isn't running on this computer)."
              )}
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
      </div>
    </section>
  );
}

/** How long an armed reset button stays armed before standing down. */
const ARM_MS = 5000;

/**
 * A destructive button that needs two taps: the first tap arms it (label
 * switches to the confirm text), the second fires. Arming expires after
 * ARM_MS so a stray first tap never sits loaded.
 */
function ArmableButton({
  label,
  confirmLabel,
  onConfirm,
  disabled,
}: {
  label: string;
  confirmLabel: string;
  onConfirm: () => void;
  disabled?: boolean;
}) {
  const [armed, setArmed] = useState(false);
  const timer = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current);
    },
    [],
  );
  if (!armed) {
    return (
      <AppButton
        type="button"
        variant="destructive"
        disabled={disabled}
        onClick={() => {
          setArmed(true);
          timer.current = window.setTimeout(() => setArmed(false), ARM_MS);
        }}
      >
        {label}
      </AppButton>
    );
  }
  return (
    <AppButton
      type="button"
      variant="destructive"
      disabled={disabled}
      onClick={() => {
        if (timer.current !== null) clearTimeout(timer.current);
        setArmed(false);
        onConfirm();
      }}
    >
      {confirmLabel}
    </AppButton>
  );
}

function ResetSection({ update }: { update: (patch: SettingsPatch) => void }) {
  const navigate = useNavigate();
  const resetData = useDataReset();
  return (
    <section className="panel" aria-label="Reset">
      <CardHeading icon={RotateCcwIcon} title="Reset" />
      <div className="mt-2 space-y-5">
        <div className="space-y-2">
          <p className="text-sm">
            Reset data erases all chores, lists, files and settings, and starts over from the
            welcome screens.
          </p>
          <ArmableButton
            label="Reset data"
            confirmLabel="Yes, reset data"
            disabled={resetData.isPending}
            onConfirm={() => {
              resetData.mutate(undefined, { onSuccess: () => navigate('/welcome') });
            }}
          />
        </div>
        <div className="space-y-2">
          <p className="text-sm">
            Reset onboarding goes through the welcome screens again. Your chores and data stay put.
          </p>
          <ArmableButton
            label="Reset onboarding"
            confirmLabel="Yes, reset onboarding"
            onConfirm={() => {
              update({ onboarded: false });
              navigate('/welcome');
            }}
          />
        </div>
      </div>
    </section>
  );
}

// The extension hardcodes this bridge address; it is independent of the API
// base above (a scratch API on :8788 still pairs through :8787).
const BRIDGE_URL = 'ws://127.0.0.1:8787/ext';

// Debugging aid: which services this window is talking to and where. One-shot
// checks on mount (the Pairing card below stays live on its own poll).
function ServicesSection() {
  const [api, setApi] = useState<'checking' | 'up' | 'down'>('checking');
  const [bridge, setBridge] = useState<'checking' | 'connected' | 'not-connected'>('checking');
  useEffect(() => {
    let cancelled = false;
    fetch(apiUrl('/health')).then(
      (r) => {
        if (!cancelled) setApi(r.ok ? 'up' : 'down');
      },
      () => {
        if (!cancelled) setApi('down');
      },
    );
    getPairingStatus().then(
      (s) => {
        if (!cancelled) setBridge(s.connected ? 'connected' : 'not-connected');
      },
      () => {
        if (!cancelled) setBridge('not-connected');
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);
  const apiBase = isTauri() ? apiUrl('') : window.location.origin;
  return (
    <section className="panel" aria-label="Services">
      <CardHeading icon={ServerIcon} title="Services" />
      <div className="mt-2 space-y-1">
        <p>This window: {isTauri() ? 'Desktop app' : 'Browser tab'}</p>
        <p>
          App API: {apiBase} ({api === 'checking' ? 'Checking…' : api === 'up' ? 'Running' : 'Down'})
        </p>
        <p>
          Extension bridge: {BRIDGE_URL} (
          {bridge === 'checking' ? 'Checking…' : bridge === 'connected' ? 'Connected' : 'Not connected'})
        </p>
      </div>
    </section>
  );
}

// Debug mode for pairing, server side: the bridge's recent event log —
// hellos, rejections, redemptions, disconnects — newest last. The other two
// legs live in the extension popup's Connection log and the service-worker
// console ([dad-ext] lines).
function DiagnosticsSection() {
  const [events, setEvents] = useState<Array<{ t: string; msg: string }> | null>(null);
  const [error, setError] = useState('');
  const load = async () => {
    setError('');
    try {
      const res = await getDebugEvents();
      setEvents(res.events);
    } catch {
      setEvents(null);
      setError('Could not load the server log.');
    }
  };
  useEffect(() => {
    // Inline promise chain (like ServicesSection above): calling load()
    // here trips react(set-state-in-effect).
    let cancelled = false;
    getDebugEvents().then(
      (res) => {
        if (!cancelled) setEvents(res.events);
      },
      () => {
        if (!cancelled) {
          setEvents(null);
          setError('Could not load the server log.');
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);
  return (
    <section className="panel" aria-label="Diagnostics">
      <CardHeading icon={ActivityIcon} title="Diagnostics" />
      <div className="mt-2 space-y-2">
        <p>Server log (bridge events, newest last):</p>
        {error !== '' && <p className="text-destructive">{error}</p>}
        {events !== null && (
          <pre
            data-testid="server-log"
            className="max-h-48 overflow-y-auto rounded-md bg-muted p-2 text-xs whitespace-pre-wrap"
          >
            {events.length === 0
              ? 'No server events yet.'
              : events.map((e) => `[${e.t.slice(11, 19)}] ${e.msg}`).join('\n')}
          </pre>
        )}
        <AppButton type="button" onClick={() => void load()}>
          Refresh log
        </AppButton>
        <p>Extension side: open the extension popup, then “Connection log”.</p>
      </div>
    </section>
  );
}

export default function SettingsPage() {
  const { settings, update } = useSettings();
  if (!settings) {
    return (
      <div className="mx-auto max-w-3xl space-y-6 p-6">
        <p className="text-muted-foreground">Loading…</p>
      </div>
    );
  }
  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <BusinessSection settings={settings} update={update} />
      <LookSection settings={settings} update={update} />
      <SoundSection settings={settings} update={update} />
      <section aria-label="Chrome">
        <Pairing />
      </section>
      <ThinkingSection />
      <ServicesSection />
      <DiagnosticsSection />
      <ResetSection update={update} />
    </div>
  );
}
