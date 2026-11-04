import type { StepKind } from '@onesaas/shared';
import Database from 'lucide-react/icons/database';
import KeyRound from 'lucide-react/icons/key-round';
import Plug from 'lucide-react/icons/plug';
import Sparkles from 'lucide-react/icons/sparkles';
import Store from 'lucide-react/icons/store';
import Zap from 'lucide-react/icons/zap';
import type { LucideIcon } from 'lucide-react';

export interface ChatChip {
  label: string;
  answer: string;
}

export interface SetupStep {
  kind: StepKind;
  icon: LucideIcon;
  /** Shown in "Step N · name" while it's open. */
  name: string;
  /** Shown while it hasn't started. */
  title: string;
  question: string;
  help: { label: string; question: string; answer: string };
  chat: string[];
  chips: ChatChip[];
}

/** The owner's first automation is setting up OneSaaS, so setup reads like one. */
export const SETUP_STEPS: SetupStep[] = [
  {
    kind: 'trigger',
    icon: Zap,
    name: 'Start',
    title: 'Get started',
    question: "Technology has made running a business harder, not easier. That's not your fault.",
    help: {
      label: 'What is this step?',
      question: 'What is this step?',
      answer: "This is where we start. A few short steps set OneSaaS up around your business, and you can go back to any of them.",
    },
    chat: [
      "Hi, I'm your helper. Think of this setup as your first automation: a few short steps, and you can see each one.",
      'Ask me anything along the way. You can go back and change any answer before you finish.',
    ],
    chips: [
      {
        label: "What's an automation?",
        answer: 'A short chain of steps that does a chore for you. This setup is laid out the same way, so you can see how one looks.',
      },
      { label: 'How long will this take?', answer: 'A few minutes. You can skip anything and come back to it later.' },
    ],
  },
  {
    kind: 'fetch',
    icon: Store,
    name: 'Your business',
    title: 'Tell me about your business',
    question: "What's your business, and what do you do?",
    help: {
      label: 'Why do you need this?',
      question: 'Why do you need this?',
      answer: 'I use it to pick ideas that suit you and to sign your messages. It stays on this computer.',
    },
    chat: ['Tell me what you do in your own words. Typing or talking both work.'],
    chips: [
      { label: 'Why my time zone?', answer: 'So anything I schedule or remind you about happens at the right time for you.' },
      { label: 'Can I change this later?', answer: 'Yes, any time, in Settings.' },
    ],
  },
  {
    kind: 'enrich',
    icon: Sparkles,
    name: 'Your interests',
    title: "Highlight what you're interested in",
    question: "Highlight anything you'd like help with",
    help: {
      label: 'What happens to these?',
      question: 'What happens to these?',
      answer: 'Nothing gets built from them. I just use them to put the right ideas in front of you.',
    },
    chat: ['Tap to change any of these.', 'Nothing gets built from this. I just use it to put the right ideas in front of you.'],
    chips: [
      { label: 'Why these ones?', answer: "I started with the ones that suit your kind of business. They're only a starting point." },
      { label: 'Can I change this later?', answer: "You don't need to. Every idea is still there to pick on your Automate page." },
    ],
  },
  {
    kind: 'trigger',
    icon: KeyRound,
    name: 'AI model',
    title: 'Check I can reach your AI model',
    question: 'Can I reach your AI model?',
    help: {
      label: 'What is an AI model key?',
      question: 'What is an AI model key?',
      answer: 'A key is like a password for an AI service. It lets me read, write and decide using your account with that service.',
    },
    chat: [
      "Without a working key I can't read, write or decide anything, so I check it now rather than halfway through a job.",
      "If the model turns the key down, I'll tell you what to fix. Nothing else changes.",
    ],
    chips: [
      { label: 'Where do I get a key?', answer: 'At api.meta.ai for Meta\'s models. Any OpenAI-compatible service works too: add its address under "Use a different service address".' },
      { label: 'What does it cost?', answer: "That depends on your service. You pay them for what you use, so check their prices." },
    ],
  },
  {
    kind: 'act',
    icon: Plug,
    name: 'Chrome extension',
    title: 'Install the Chrome extension',
    question: 'Install the Chrome extension',
    help: {
      label: 'Why do I need an extension?',
      question: 'Why do I need an extension?',
      answer: 'The extension is how I reach the websites you use for work, in your own signed-in Chrome.',
    },
    chat: [
      'Your business runs in this app, on this computer. The extension is how I reach the websites you use for work.',
      'Nothing goes out until you say so.',
    ],
    chips: [
      { label: "I can't find the icon", answer: "Click the puzzle piece in Chrome's toolbar, then pin OneSaaS so it stays in view." },
      { label: 'What can the extension see?', answer: 'It can reach any website, and it only works on a page when an automation you published needs it.' },
    ],
  },
  {
    kind: 'store',
    icon: Database,
    name: 'Automate',
    title: 'Your Automate page, set up for you',
    question: '',
    help: { label: '', question: '', answer: '' },
    chat: [],
    chips: [],
  },
];

/** The steps you act on: the last node is where setup lands. */
export const INTERACTIVE_STEPS = 5;

const OTHER_REPLY = "I can't look into that during setup. Once you're on your Automate page, ask me there and I can build and change things for you.";
export function cannedReply(): string {
  return OTHER_REPLY;
}

/** "Los Angeles (Pacific time)": how the owner sees a time zone. The IANA name is what's stored. */
export function zoneLabel(zone: string): string {
  const city = (zone.split('/').pop() ?? zone).replaceAll('_', ' ');
  const area = zoneArea(zone);
  return area === null ? city : `${city} (${area})`;
}

/** "Pacific time", or null when the browser has no name for it. */
export function zoneArea(zone: string): string | null {
  try {
    const name = new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'longGeneric' })
      .formatToParts(new Date())
      .find((p) => p.type === 'timeZoneName')?.value;
    if (name === undefined || name.startsWith('GMT')) return null;
    return name.replace(/ Time$/, ' time');
  } catch {
    return null;
  }
}

/** Reads what the owner typed as a zone: its label, its IANA name, or just a city. */
export function parseZone(text: string, current: string): string | null {
  const typed = text.trim();
  if (typed === zoneLabel(current)) return current;
  try {
    new Intl.DateTimeFormat(undefined, { timeZone: typed });
    return typed;
  } catch {
    // Not an IANA name: try it as a city.
  }
  const city = typed.toLowerCase().replace(/ *\(.*$/, '').replaceAll(' ', '_');
  if (city === '') return null;
  return Intl.supportedValuesOf('timeZone').find((z) => z.split('/').pop()?.toLowerCase() === city) ?? null;
}
