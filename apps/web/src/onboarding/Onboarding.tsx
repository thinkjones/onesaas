import { VERTICAL_PACKS, STARTER_IDEAS, type Vertical } from '@onesaas/shared';
import Check from 'lucide-react/icons/check';
import CircleHelp from 'lucide-react/icons/circle-help';
import { MotionConfig, motion } from 'motion/react';
import { Fragment, useEffect, useRef, useState } from 'react';
import { Navigate, useNavigate } from 'react-router';
import { isTauri, useSettings, type Settings } from '../api.ts';
import AppButton from '../design/AppButton.tsx';
import '../shell/FloatingBar.css';
import WindowDragBar from '../shell/WindowDragBar.tsx';
import type { UseVoiceResult } from '../voice/useVoice.ts';
import SetupChat, { type ChatLine } from './SetupChat.tsx';
import StepBusiness from './StepBusiness.tsx';
import StepConnect from './StepConnect.tsx';
import StepInterests from './StepInterests.tsx';
import StepModel from './StepModel.tsx';
import { INTERACTIVE_STEPS, SETUP_STEPS, zoneArea } from './steps.ts';

const BODY = [
  "A few quick questions and I'll set OneSaaS up around your business. You'll see every step, and nothing happens until you say so.",
  'I use this to pick ideas that suit you and to sign your messages.',
  "I won't build anything yet. This helps me shape OneSaaS around your business, so the ideas you see later fit.",
  "I use an AI model to read, write and decide. Paste your key and I'll check it works. It's saved in the desktop app on this computer.",
  'OneSaaS comes in two parts that work together. You stay in charge from this app.',
];

function lowerFirst(text: string): string {
  return text.charAt(0).toLowerCase() + text.slice(1);
}

function businessOutcome(s: Settings): string {
  const area = zoneArea(s.timezone);
  const when = area === null ? '' : ` on ${area}`;
  const name = s.businessName?.trim();
  const what = s.businessWhat?.trim();
  if (name && what) return `${name} runs ${lowerFirst(what)}${when}.`;
  if (name) return `${name} is set up${when}.`;
  return `You're set up${when}.`;
}

function interestsOutcome(s: Settings): string {
  const tags = s.interests.slice(0, 3).flatMap((id) => STARTER_IDEAS.find((idea) => idea.id === id)?.tag ?? []);
  if (tags.length === 0) return "You'll pick ideas when you're ready.";
  const words = tags.map(lowerFirst);
  const list = words.length === 1 ? words[0] : `${words.slice(0, -1).join(', ')} and ${words.at(-1)}`;
  return `You'd like help with ${list}.`;
}

/**
 * Setup at /welcome, drawn the way an automation is: a flow of steps on a board,
 * with one open at a time and a helper alongside.
 */
export default function Onboarding({ useVoiceFn }: { useVoiceFn?: () => UseVoiceResult }) {
  const { settings, update, updateAsync } = useSettings();
  const navigate = useNavigate();
  const [current, setCurrent] = useState(0);
  const [done, setDone] = useState<number[]>([]);
  const [modelSkipped, setModelSkipped] = useState(false);
  const [modelFailed, setModelFailed] = useState(false);
  const [chatByStep, setChatByStep] = useState<Record<number, ChatLine[]>>({});
  const [settledOpen, setSettledOpen] = useState(true);

  // Focus follows the step that opens (not on first load).
  const heading = useRef<HTMLHeadingElement | null>(null);
  const opened = useRef(false);
  const finishing = useRef(false);
  useEffect(() => {
    if (opened.current) heading.current?.focus();
    opened.current = true;
  }, [current]);

  if (!settings) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-muted-foreground">Loading…</p>
      </div>
    );
  }
  if (settings.onboarded) return <Navigate to={finishing.current ? '/automate' : '/'} replace />;

  const finish = () => {
    // The saved flag lands first and re-renders here, so remember where we're going.
    finishing.current = true;
    update({ onboarded: true });
    navigate('/automate');
  };
  const complete = (step: number) => {
    setDone((now) => (now.includes(step) ? now : [...now, step]));
    setModelFailed(false);
    setCurrent(step + 1);
  };
  const askInChat = (step: number) => {
    const { help } = SETUP_STEPS[step]!;
    setChatByStep((now) => ({
      ...now,
      [step]: [...(now[step] ?? []), { from: 'owner', text: help.question }, { from: 'agent', text: help.answer }],
    }));
  };

  const back = (
    <AppButton type="button" variant="ghost" onClick={() => setCurrent(current - 1)}>
      Back
    </AppButton>
  );
  const outcome = (i: number): string => {
    if (i === 0) return "You're ready to hand over some chores.";
    if (i === 1) return businessOutcome(settings);
    if (i === 2) return interestsOutcome(settings);
    if (i === 3) return modelSkipped ? 'Skipped for now.' : "Your AI model answered. I'm ready to think.";
    return 'Chrome is paired.';
  };
  const vertical = settings.vertical !== null && settings.vertical in VERTICAL_PACKS ? VERTICAL_PACKS[settings.vertical as Vertical] : null;

  return (
    <MotionConfig reducedMotion="user">
      <div className="onb-board">
        <WindowDragBar />
        <header
          className={`floatbar onb-bar${isTauri() ? ' tauri' : ''}`}
          {...(isTauri() ? { 'data-tauri-drag-region': true } : {})}
        >
          <span className="wordmark">OneSaaS</span>
          <span aria-hidden className="onb-bar-rule" />
          <span className="font-bold">Getting set up</span>
          <span
            role="progressbar"
            aria-label="Setup progress"
            aria-valuenow={current + 1}
            aria-valuemin={1}
            aria-valuemax={INTERACTIVE_STEPS}
            className="onb-pill"
          >
            Step {current + 1} of {INTERACTIVE_STEPS}
          </span>
          <AppButton type="button" variant="ghost" size="sm" onClick={finish}>
            Skip setup
          </AppButton>
        </header>
        <div className="onb-columns">
          <main className="onb-flow">
            <p className="section-label onb-flow-label">Your setup · {SETUP_STEPS.length} steps</p>
            {SETUP_STEPS.map((step, i) => {
              const isDone = done.includes(i) && i !== current;
              const Icon = step.icon;
              const tile = { background: `var(--kind-${step.kind}-bg)`, color: `var(--kind-${step.kind}-fg)` };
              return (
                <Fragment key={step.name}>
                  {i > 0 && (
                    <span
                      aria-hidden
                      className="onb-link"
                      data-done={done.includes(i - 1) && i - 1 !== current}
                    />
                  )}
                  {i === current ? (
                    <section aria-current="step" aria-label={step.name} className="onb-node-open" data-failed={i === 3 && modelFailed}>
                      <div className="onb-node-head">
                        <span className="onb-tile" style={tile} aria-hidden>
                          <Icon />
                        </span>
                        <span className="onb-meta flex-1">
                          Step {i + 1} · {step.name}
                        </span>
                        <button type="button" className="onb-help" aria-label={step.help.label} onClick={() => askInChat(i)}>
                          <CircleHelp aria-hidden />
                        </button>
                      </div>
                      <motion.div
                        key={i}
                        className="onb-node-body"
                        initial={{ height: 0 }}
                        animate={{ height: 'auto' }}
                        transition={{ duration: 0.18, ease: [0.4, 0, 0.2, 1] }}
                        style={{ overflow: settledOpen ? 'visible' : 'hidden' }}
                        onAnimationStart={() => setSettledOpen(false)}
                        onAnimationComplete={() => setSettledOpen(true)}
                      >
                        <h1 ref={heading} tabIndex={-1} className="onb-question">
                          {step.question}
                        </h1>
                        <p className="m-0 text-[var(--text-dim)]">{BODY[i]}</p>
                        {i === 0 && (
                          <div className="onb-footer onb-footer-solo">
                            <AppButton type="button" variant="brand" onClick={() => complete(0)}>
                              Let&apos;s fix that
                            </AppButton>
                          </div>
                        )}
                        {i === 1 && (
                          <StepBusiness
                            settings={settings}
                            updateAsync={updateAsync}
                            useVoiceFn={useVoiceFn}
                            footerStart={back}
                            onNext={() => complete(1)}
                          />
                        )}
                        {i === 2 && (
                          <StepInterests
                            settings={settings}
                            updateAsync={updateAsync}
                            useVoiceFn={useVoiceFn}
                            footerStart={back}
                            onNext={() => complete(2)}
                          />
                        )}
                        {i === 3 && (
                          <StepModel
                            footerStart={back}
                            onTone={setModelFailed}
                            onNext={() => {
                              setModelSkipped(false);
                              complete(3);
                            }}
                            onSkip={() => {
                              setModelSkipped(true);
                              complete(3);
                            }}
                          />
                        )}
                        {i === 4 && <StepConnect footerStart={back} onFinish={finish} />}
                      </motion.div>
                    </section>
                  ) : isDone ? (
                    <button type="button" className="onb-node-done" onClick={() => setCurrent(i)}>
                      <span className="onb-done-dot" data-skipped={i === 3 && modelSkipped} aria-hidden>
                        <Check />
                      </span>
                      <span className="onb-done-text">{outcome(i)}</span>
                      {i === 3 && modelSkipped && <span className="onb-pill-muted">Skipped</span>}
                      <span className="onb-meta">Step {i + 1}</span>
                    </button>
                  ) : (
                    <section aria-label={step.title} className="onb-node-todo">
                      <span className="onb-tile onb-tile-faded" style={tile} aria-hidden>
                        <Icon />
                      </span>
                      <span className="onb-todo-text">
                        <span className="font-bold">{step.title}</span>
                        <span className="onb-meta">
                          {i === SETUP_STEPS.length - 1 && vertical !== null
                            ? `Not started · ideas for ${vertical.plural}, ready when you are`
                            : 'Not started'}
                        </span>
                      </span>
                    </section>
                  )}
                </Fragment>
              );
            })}
          </main>
          <SetupChat
            seed={SETUP_STEPS[current]!.chat}
            chips={SETUP_STEPS[current]!.chips}
            lines={chatByStep[current] ?? []}
            useVoiceFn={useVoiceFn}
            onLines={(lines) => setChatByStep((now) => ({ ...now, [current]: lines }))}
          />
        </div>
      </div>
    </MotionConfig>
  );
}
