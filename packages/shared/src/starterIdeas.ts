import type { StepKind } from './catalog.js';

// The Automate page's starter prompts and onboarding's interests.
// docs/playbooks/NN-*.md frontmatter (owner_ask, stage) and docs/playbooks/README.md
// (vertical packs) are the source of truth; titles and tags are UI copy.

export type StarterStage = 'win' | 'do' | 'paid' | 'keep' | 'run';

/** Lucide icon names a flow preview can draw. */
export type FlowIconName =
  | 'Bell'
  | 'Calculator'
  | 'Calendar'
  | 'Camera'
  | 'Check'
  | 'Clock'
  | 'Database'
  | 'DollarSign'
  | 'FileText'
  | 'Image'
  | 'Inbox'
  | 'Mail'
  | 'MessageSquare'
  | 'MousePointerClick'
  | 'Package'
  | 'PenLine'
  | 'Phone'
  | 'Play'
  | 'Repeat'
  | 'Search'
  | 'Send'
  | 'ShieldCheck'
  | 'Sparkles'
  | 'Star'
  | 'Sun'
  | 'Tags'
  | 'Truck'
  | 'Users'
  | 'Zap';

export interface FlowStep {
  icon: FlowIconName;
  kind: StepKind;
}

export interface StarterIdea {
  id: number;
  playbook: string;
  stage: StarterStage;
  /** Short noun for onboarding's interest picker. */
  tag: string;
  title: string;
  ownerAsk: string;
  steps: FlowStep[];
}

export const STAGE_LABEL: Record<StarterStage, string> = {
  win: 'Win the job',
  do: 'Do the job',
  paid: 'Get paid',
  keep: 'Keep customers',
  run: 'Run the shop',
};

export const POPULAR_IDEA_IDS = [15, 3, 17, 12, 20, 19, 1, 11];

export const STARTER_IDEAS: StarterIdea[] = [
  {
    id: 1,
    playbook: 'pb-01',
    stage: 'win',
    tag: 'Missed calls',
    title: "Text back missed calls",
    ownerAsk: "When I miss a call, text them back straight away and find out what they need.",
    steps: [{ icon: 'Phone', kind: 'trigger' }, { icon: 'Sparkles', kind: 'enrich' }, { icon: 'MessageSquare', kind: 'act' }],
  },
  {
    id: 2,
    playbook: 'pb-02',
    stage: 'win',
    tag: 'Quotes and follow-ups',
    title: "Write quotes and chase them",
    ownerAsk: "Write the quote for me, send it, and chase them if they go quiet.",
    steps: [{ icon: 'FileText', kind: 'enrich' }, { icon: 'ShieldCheck', kind: 'act' }, { icon: 'Send', kind: 'act' }],
  },
  {
    id: 3,
    playbook: 'pb-03',
    stage: 'win',
    tag: 'Taking bookings',
    title: "Let customers book themselves",
    ownerAsk: "Let customers book themselves in and tell me what's wrong before I turn up.",
    steps: [{ icon: 'Mail', kind: 'fetch' }, { icon: 'Sparkles', kind: 'enrich' }, { icon: 'Calendar', kind: 'store' }],
  },
  {
    id: 4,
    playbook: 'pb-04',
    stage: 'win',
    tag: 'Appointment reminders',
    title: "Remind people of appointments",
    ownerAsk: "Remind people about their appointment so they actually turn up.",
    steps: [{ icon: 'Calendar', kind: 'fetch' }, { icon: 'Bell', kind: 'trigger' }, { icon: 'MessageSquare', kind: 'act' }],
  },
  {
    id: 5,
    playbook: 'pb-05',
    stage: 'do',
    tag: 'Sending the right person',
    title: "Send the right person to each job",
    ownerAsk: "Send the right person to the job and tell the customer when they'll arrive.",
    steps: [{ icon: 'Users', kind: 'fetch' }, { icon: 'Truck', kind: 'act' }, { icon: 'MessageSquare', kind: 'act' }],
  },
  {
    id: 6,
    playbook: 'pb-06',
    stage: 'do',
    tag: 'Job write-ups with photos',
    title: "Write up finished jobs with photos",
    ownerAsk: "When the job's done, write it up, show the photos and get the invoice out.",
    steps: [{ icon: 'Camera', kind: 'trigger' }, { icon: 'Sparkles', kind: 'enrich' }, { icon: 'FileText', kind: 'store' }],
  },
  {
    id: 7,
    playbook: 'pb-07',
    stage: 'do',
    tag: 'Orders in one list',
    title: "Put every order in one list",
    ownerAsk: "Get every order from every channel into one list and make sure it goes out right.",
    steps: [{ icon: 'Package', kind: 'fetch' }, { icon: 'Database', kind: 'store' }, { icon: 'Truck', kind: 'act' }],
  },
  {
    id: 8,
    playbook: 'pb-08',
    stage: 'do',
    tag: 'Reordering parts',
    title: "Reorder parts before I run out",
    ownerAsk: "Tell me before I run out, and order the part when a job needs it.",
    steps: [{ icon: 'Package', kind: 'fetch' }, { icon: 'Bell', kind: 'trigger' }, { icon: 'Send', kind: 'act' }],
  },
  {
    id: 9,
    playbook: 'pb-09',
    stage: 'do',
    tag: 'Warranty claims',
    title: "Chase warranty claims",
    ownerAsk: "Put together the warranty claim and keep chasing it until we get paid.",
    steps: [{ icon: 'FileText', kind: 'enrich' }, { icon: 'Send', kind: 'act' }, { icon: 'Clock', kind: 'trigger' }],
  },
  {
    id: 10,
    playbook: 'pb-10',
    stage: 'paid',
    tag: 'Sending bills',
    title: "Send the bill when a job's done",
    ownerAsk: "Send the bill as soon as the job's done and make it easy to pay.",
    steps: [{ icon: 'Check', kind: 'trigger' }, { icon: 'FileText', kind: 'enrich' }, { icon: 'DollarSign', kind: 'act' }],
  },
  {
    id: 11,
    playbook: 'pb-11',
    stage: 'paid',
    tag: 'Chasing late payments',
    title: "Politely chase unpaid bills",
    ownerAsk: "Chase the people who haven't paid, politely, so I don't have to.",
    steps: [{ icon: 'Clock', kind: 'trigger' }, { icon: 'Sparkles', kind: 'enrich' }, { icon: 'Mail', kind: 'act' }],
  },
  {
    id: 12,
    playbook: 'pb-12',
    stage: 'paid',
    tag: 'Receipts and the books',
    title: "Snap receipts into the books",
    ownerAsk: "Snap the receipt and let it go into the books by itself.",
    steps: [{ icon: 'Camera', kind: 'trigger' }, { icon: 'Sparkles', kind: 'enrich' }, { icon: 'Database', kind: 'store' }],
  },
  {
    id: 13,
    playbook: 'pb-13',
    stage: 'paid',
    tag: 'Hours and payroll',
    title: "Turn timesheets into payroll",
    ownerAsk: "Add up everyone's hours and get payroll ready for me to check.",
    steps: [{ icon: 'Clock', kind: 'fetch' }, { icon: 'Users', kind: 'enrich' }, { icon: 'DollarSign', kind: 'act' }],
  },
  {
    id: 14,
    playbook: 'pb-14',
    stage: 'keep',
    tag: 'Getting reviews',
    title: "Ask happy customers for reviews",
    ownerAsk: "Ask happy customers for a review, and help me answer the ones that come in.",
    steps: [{ icon: 'Check', kind: 'trigger' }, { icon: 'Star', kind: 'enrich' }, { icon: 'MessageSquare', kind: 'act' }],
  },
  {
    id: 15,
    playbook: 'pb-15',
    stage: 'keep',
    tag: 'Answering messages',
    title: "Sort my inbox and answer the easy ones",
    ownerAsk: "Sort my messages, answer the easy ones and tell me which ones need me.",
    steps: [{ icon: 'Mail', kind: 'fetch' }, { icon: 'Sparkles', kind: 'enrich' }, { icon: 'Send', kind: 'act' }],
  },
  {
    id: 16,
    playbook: 'pb-16',
    stage: 'keep',
    tag: 'Bringing back regulars',
    title: "Remind regulars when they're due",
    ownerAsk: "Remind regulars when they're due and renew their plans without me remembering.",
    steps: [{ icon: 'Repeat', kind: 'trigger' }, { icon: 'Bell', kind: 'enrich' }, { icon: 'Mail', kind: 'act' }],
  },
  {
    id: 17,
    playbook: 'pb-17',
    stage: 'keep',
    tag: 'Seasonal offers',
    title: "Turn a photo into a seasonal offer",
    ownerAsk: "Help me send a nice offer before the busy season and bring old customers back.",
    steps: [{ icon: 'Camera', kind: 'trigger' }, { icon: 'Image', kind: 'enrich' }, { icon: 'Send', kind: 'act' }],
  },
  {
    id: 18,
    playbook: 'pb-18',
    stage: 'run',
    tag: 'People joining or leaving',
    title: "Sort paperwork when people join or leave",
    ownerAsk: "When someone starts or leaves, sort the paperwork and the logins.",
    steps: [{ icon: 'Users', kind: 'trigger' }, { icon: 'FileText', kind: 'enrich' }, { icon: 'Check', kind: 'store' }],
  },
  {
    id: 19,
    playbook: 'pb-19',
    stage: 'run',
    tag: 'Licences and insurance',
    title: "Warn me before licences run out",
    ownerAsk: "Warn me before any licence, insurance or vehicle check runs out.",
    steps: [{ icon: 'ShieldCheck', kind: 'fetch' }, { icon: 'Bell', kind: 'trigger' }, { icon: 'Mail', kind: 'act' }],
  },
  {
    id: 20,
    playbook: 'pb-20',
    stage: 'run',
    tag: 'A morning summary',
    title: "Tell me what needs me each morning",
    ownerAsk: "Every morning, tell me what happened yesterday and what needs me today.",
    steps: [{ icon: 'Sun', kind: 'trigger' }, { icon: 'Sparkles', kind: 'enrich' }, { icon: 'Mail', kind: 'act' }],
  },
];

export type Vertical =
  | 'taxi'
  | 'plumber'
  | 'appliance'
  | 'florist'
  | 'cleaning'
  | 'salon'
  | 'landscaping'
  | 'bakery';

/** A business type's starter set of playbooks. */
export const VERTICAL_PACKS: Record<Vertical, { label: string; owners: string; plural: string; ideas: number[] }> = {
  taxi: { label: 'Taxi / private hire', owners: 'taxi', plural: 'taxis', ideas: [1, 3, 4, 5, 10, 13, 19] },
  plumber: { label: 'Plumber', owners: 'plumbing', plural: 'plumbers', ideas: [1, 2, 4, 5, 6, 10, 14] },
  appliance: { label: 'Appliance repair', owners: 'repair', plural: 'repair shops', ideas: [1, 3, 5, 6, 8, 9, 10] },
  florist: { label: 'Florist', owners: 'florist', plural: 'florists', ideas: [7, 5, 10, 14, 15, 17, 8] },
  cleaning: { label: 'Cleaning', owners: 'cleaning', plural: 'cleaners', ideas: [3, 4, 5, 6, 10, 16, 14] },
  salon: { label: 'Salon / barber', owners: 'salon', plural: 'salons', ideas: [3, 4, 10, 14, 16, 17] },
  landscaping: { label: 'Landscaping / pest / pool', owners: 'landscaping', plural: 'landscapers', ideas: [2, 5, 16, 10, 11, 17] },
  bakery: { label: 'Bakery / print shop', owners: 'bakery', plural: 'bakeries', ideas: [7, 8, 10, 15, 17] },
};

const VERTICAL_WORDS: [Vertical, RegExp][] = [
  ['taxi', /\b(taxi|cab|private hire|chauffeur|airport|transfers?)/i],
  ['plumber', /\b(plumb|pipe|drain|boiler|heating)/i],
  ['appliance', /\b(appliance|washing machine|fridge|dishwasher|repair)/i],
  ['florist', /\b(florist|flower|bouquet|floral)/i],
  ['cleaning', /\b(clean|maid|housekeep)/i],
  ['salon', /\b(salon|barber|hair|nail|beauty)/i],
  ['landscaping', /\b(landscap|garden|lawn|pest|pool)/i],
  ['bakery', /\b(bak(e|ery|ing)|cake|pastr|bread|print shop|printing)/i],
];

/** A best guess at the business type from the owner's own words. */
export function detectVertical(text: string): Vertical | null {
  return VERTICAL_WORDS.find(([, words]) => words.test(text))?.[0] ?? null;
}

// Playbooks that run in full with today's steps (mvp_coverage: full).
const FULL_COVERAGE = new Set([3, 12, 15, 17, 19, 20]);

/** Three to start highlighted: the pack's, preferring ideas that fully work today. */
export function suggestedIdeaIds(vertical: Vertical): number[] {
  const { ideas } = VERTICAL_PACKS[vertical];
  return [...ideas.filter((id) => FULL_COVERAGE.has(id)), ...ideas.filter((id) => !FULL_COVERAGE.has(id))].slice(0, 3);
}

/** What the owner told us shapes the idea order: highlights, then their pack, then Popular. */
export function ideasForOwner(interests: number[], vertical: string | null): StarterIdea[] {
  const pack = vertical !== null && vertical in VERTICAL_PACKS ? VERTICAL_PACKS[vertical as Vertical].ideas : [];
  const ids = [...new Set([...interests, ...pack, ...POPULAR_IDEA_IDS])];
  return ids.flatMap((id) => STARTER_IDEAS.find((idea) => idea.id === id) ?? []);
}
