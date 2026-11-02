import type { StepRunStatus } from '@dad/shared';
import { Inbox, ListChecks } from 'lucide-react';
import { useState } from 'react';
import { CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '../components/ui/card.tsx';
import AppButton from '../design/AppButton.tsx';
import AppCard from '../design/AppCard.tsx';
import EmptyState from '../design/EmptyState.tsx';
import StatusBadge from '../design/StatusBadge.tsx';

const STATUSES: StepRunStatus[] = ['pending', 'running', 'waiting', 'done', 'failed', 'skipped'];

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-xl font-semibold">{title}</h2>
      {children}
    </section>
  );
}

export default function DesignPreviewPage() {
  const [clicks, setClicks] = useState(0);
  return (
    <div className="flex max-w-3xl flex-col gap-10">
      <div>
        <p className="text-base text-muted-foreground">
          Every primitive in every state. If a change breaks the look, it shows here first.
        </p>
      </div>

      <Section title="Status badges">
        <div className="flex flex-wrap items-center gap-2">
          {STATUSES.map((status) => (
            <StatusBadge key={status} status={status} />
          ))}
        </div>
      </Section>

      <Section title="Buttons">
        <div className="flex flex-wrap items-center gap-2">
          <AppButton onClick={() => setClicks((n) => n + 1)}>Primary{clicks > 0 ? ` (${clicks})` : ''}</AppButton>
          <AppButton variant="secondary">Secondary</AppButton>
          <AppButton variant="outline">Outline</AppButton>
          <AppButton variant="ghost">Ghost</AppButton>
          <AppButton variant="destructive">Destructive</AppButton>
          <AppButton variant="link">Link</AppButton>
          <AppButton disabled>Disabled</AppButton>
        </div>
      </Section>

      <Section title="Cards">
        <AppCard>
          <CardHeader>
            <CardTitle>Card with header</CardTitle>
            <CardDescription>Paper surface, one radius, one soft shadow.</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-base">
              Body copy sits at 16px minimum on the warm Morning card surface.
            </p>
          </CardContent>
          <CardFooter>
            <AppButton variant="outline">Footer action</AppButton>
          </CardFooter>
        </AppCard>
        <AppCard className="p-6">
          <p className="text-base">Plain card — just the paper surface.</p>
        </AppCard>
      </Section>

      <Section title="Empty states">
        <AppCard>
          <EmptyState
            icon={Inbox}
            title="No runs yet"
            hint="Runs will show up here once this chore reducer starts."
            action={{ label: 'Run now', onClick: () => setClicks((n) => n + 1) }}
          />
        </AppCard>
        <AppCard>
          <EmptyState icon={ListChecks} title="Nothing waiting" hint="Steps that need you will appear here." />
        </AppCard>
      </Section>
    </div>
  );
}
