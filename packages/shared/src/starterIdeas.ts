import type { StepKind } from './catalog.js';

// The Automate page's starter prompts. docs/playbooks/NN-*.md frontmatter
// (owner_ask, stage) is the source of truth; titles are UI copy.

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
    title: "Text back missed calls",
    ownerAsk: "When I miss a call, text them back straight away and find out what they need.",
    steps: [{ icon: 'Phone', kind: 'trigger' }, { icon: 'Sparkles', kind: 'enrich' }, { icon: 'MessageSquare', kind: 'act' }],
  },
  {
    id: 2,
    playbook: 'pb-02',
    stage: 'win',
    title: "Write quotes and chase them",
    ownerAsk: "Write the quote for me, send it, and chase them if they go quiet.",
    steps: [{ icon: 'FileText', kind: 'enrich' }, { icon: 'ShieldCheck', kind: 'act' }, { icon: 'Send', kind: 'act' }],
  },
  {
    id: 3,
    playbook: 'pb-03',
    stage: 'win',
    title: "Let customers book themselves",
    ownerAsk: "Let customers book themselves in and tell me what's wrong before I turn up.",
    steps: [{ icon: 'Mail', kind: 'fetch' }, { icon: 'Sparkles', kind: 'enrich' }, { icon: 'Calendar', kind: 'store' }],
  },
  {
    id: 4,
    playbook: 'pb-04',
    stage: 'win',
    title: "Remind people of appointments",
    ownerAsk: "Remind people about their appointment so they actually turn up.",
    steps: [{ icon: 'Calendar', kind: 'fetch' }, { icon: 'Bell', kind: 'trigger' }, { icon: 'MessageSquare', kind: 'act' }],
  },
  {
    id: 5,
    playbook: 'pb-05',
    stage: 'do',
    title: "Send the right person to each job",
    ownerAsk: "Send the right person to the job and tell the customer when they'll arrive.",
    steps: [{ icon: 'Users', kind: 'fetch' }, { icon: 'Truck', kind: 'act' }, { icon: 'MessageSquare', kind: 'act' }],
  },
  {
    id: 6,
    playbook: 'pb-06',
    stage: 'do',
    title: "Write up finished jobs with photos",
    ownerAsk: "When the job's done, write it up, show the photos and get the invoice out.",
    steps: [{ icon: 'Camera', kind: 'trigger' }, { icon: 'Sparkles', kind: 'enrich' }, { icon: 'FileText', kind: 'store' }],
  },
  {
    id: 7,
    playbook: 'pb-07',
    stage: 'do',
    title: "Put every order in one list",
    ownerAsk: "Get every order from every channel into one list and make sure it goes out right.",
    steps: [{ icon: 'Package', kind: 'fetch' }, { icon: 'Database', kind: 'store' }, { icon: 'Truck', kind: 'act' }],
  },
  {
    id: 8,
    playbook: 'pb-08',
    stage: 'do',
    title: "Reorder parts before I run out",
    ownerAsk: "Tell me before I run out, and order the part when a job needs it.",
    steps: [{ icon: 'Package', kind: 'fetch' }, { icon: 'Bell', kind: 'trigger' }, { icon: 'Send', kind: 'act' }],
  },
  {
    id: 9,
    playbook: 'pb-09',
    stage: 'do',
    title: "Chase warranty claims",
    ownerAsk: "Put together the warranty claim and keep chasing it until we get paid.",
    steps: [{ icon: 'FileText', kind: 'enrich' }, { icon: 'Send', kind: 'act' }, { icon: 'Clock', kind: 'trigger' }],
  },
  {
    id: 10,
    playbook: 'pb-10',
    stage: 'paid',
    title: "Send the bill when a job's done",
    ownerAsk: "Send the bill as soon as the job's done and make it easy to pay.",
    steps: [{ icon: 'Check', kind: 'trigger' }, { icon: 'FileText', kind: 'enrich' }, { icon: 'DollarSign', kind: 'act' }],
  },
  {
    id: 11,
    playbook: 'pb-11',
    stage: 'paid',
    title: "Politely chase unpaid bills",
    ownerAsk: "Chase the people who haven't paid, politely, so I don't have to.",
    steps: [{ icon: 'Clock', kind: 'trigger' }, { icon: 'Sparkles', kind: 'enrich' }, { icon: 'Mail', kind: 'act' }],
  },
  {
    id: 12,
    playbook: 'pb-12',
    stage: 'paid',
    title: "Snap receipts into the books",
    ownerAsk: "Snap the receipt and let it go into the books by itself.",
    steps: [{ icon: 'Camera', kind: 'trigger' }, { icon: 'Sparkles', kind: 'enrich' }, { icon: 'Database', kind: 'store' }],
  },
  {
    id: 13,
    playbook: 'pb-13',
    stage: 'paid',
    title: "Turn timesheets into payroll",
    ownerAsk: "Add up everyone's hours and get payroll ready for me to check.",
    steps: [{ icon: 'Clock', kind: 'fetch' }, { icon: 'Users', kind: 'enrich' }, { icon: 'DollarSign', kind: 'act' }],
  },
  {
    id: 14,
    playbook: 'pb-14',
    stage: 'keep',
    title: "Ask happy customers for reviews",
    ownerAsk: "Ask happy customers for a review, and help me answer the ones that come in.",
    steps: [{ icon: 'Check', kind: 'trigger' }, { icon: 'Star', kind: 'enrich' }, { icon: 'MessageSquare', kind: 'act' }],
  },
  {
    id: 15,
    playbook: 'pb-15',
    stage: 'keep',
    title: "Sort my inbox and answer the easy ones",
    ownerAsk: "Sort my messages, answer the easy ones and tell me which ones need me.",
    steps: [{ icon: 'Mail', kind: 'fetch' }, { icon: 'Sparkles', kind: 'enrich' }, { icon: 'Send', kind: 'act' }],
  },
  {
    id: 16,
    playbook: 'pb-16',
    stage: 'keep',
    title: "Remind regulars when they're due",
    ownerAsk: "Remind regulars when they're due and renew their plans without me remembering.",
    steps: [{ icon: 'Repeat', kind: 'trigger' }, { icon: 'Bell', kind: 'enrich' }, { icon: 'Mail', kind: 'act' }],
  },
  {
    id: 17,
    playbook: 'pb-17',
    stage: 'keep',
    title: "Turn a photo into a seasonal offer",
    ownerAsk: "Help me send a nice offer before the busy season and bring old customers back.",
    steps: [{ icon: 'Camera', kind: 'trigger' }, { icon: 'Image', kind: 'enrich' }, { icon: 'Send', kind: 'act' }],
  },
  {
    id: 18,
    playbook: 'pb-18',
    stage: 'run',
    title: "Sort paperwork when people join or leave",
    ownerAsk: "When someone starts or leaves, sort the paperwork and the logins.",
    steps: [{ icon: 'Users', kind: 'trigger' }, { icon: 'FileText', kind: 'enrich' }, { icon: 'Check', kind: 'store' }],
  },
  {
    id: 19,
    playbook: 'pb-19',
    stage: 'run',
    title: "Warn me before licences run out",
    ownerAsk: "Warn me before any licence, insurance or vehicle check runs out.",
    steps: [{ icon: 'ShieldCheck', kind: 'fetch' }, { icon: 'Bell', kind: 'trigger' }, { icon: 'Mail', kind: 'act' }],
  },
  {
    id: 20,
    playbook: 'pb-20',
    stage: 'run',
    title: "Tell me what needs me each morning",
    ownerAsk: "Every morning, tell me what happened yesterday and what needs me today.",
    steps: [{ icon: 'Sun', kind: 'trigger' }, { icon: 'Sparkles', kind: 'enrich' }, { icon: 'Mail', kind: 'act' }],
  },
];
