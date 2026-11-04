import type { StepDef, StepInstance, Workflow } from '@onesaas/shared';
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import ConfigForm, { type ConfigSave } from './ConfigForm.tsx';

afterEach(() => {
  vi.restoreAllMocks();
});

function step(overrides?: Partial<StepInstance>): StepInstance {
  return {
    id: 'extract',
    type: 'ai.extract',
    title: 'Pick out the details',
    summary: 'Reads details out of text.',
    config: {
      instructions: 'Read the enquiry.',
      fields: [{ name: 'email', type: 'email', description: 'The sender email' }],
    },
    inputs: { text: '{{trigger.email.body}}' },
    position: { x: 500, y: 100 },
    ...overrides,
  };
}

function workflow(steps: StepInstance[] = [step()]): Workflow {
  return {
    id: 'flow-1',
    name: 'Test flow',
    description: 'Test flow.',
    version: 1,
    status: 'draft',
    trigger: {
      id: 'trigger',
      type: 'trigger.gmailButton',
      title: 'Gmail button',
      summary: 'Runs when you click the button on an email in Gmail.',
      config: { label: 'Test' },
      inputs: {},
      position: { x: 100, y: 100 },
    },
    steps,
    edges: [{ from: 'trigger', to: 'extract' }],
  };
}

function renderForm(s: StepInstance = step(), onSave: (patch: ConfigSave) => void = () => {}) {
  const wf = workflow([s]);
  render(<ConfigForm step={s} workflow={wf} onSave={onSave} />);
  return wf;
}

describe('ConfigForm', () => {
  test('ai.extract renders an "instructions" textarea and a fields table', () => {
    renderForm();
    const instructions = screen.getByLabelText('Instructions');
    expect(instructions.tagName).toBe('TEXTAREA');
    expect((instructions as HTMLTextAreaElement).value).toBe('Read the enquiry.');
    // The fields table shows the existing row with editable cells.
    expect((screen.getByLabelText('Name for field 1') as HTMLInputElement).value).toBe('email');
    expect(screen.getByRole('button', { name: 'Add a field' })).toBeDefined();
  });

  test('"Add a field" adds a row; rows can be removed again', () => {
    renderForm();
    expect(screen.getAllByRole('button', { name: /Remove field/ })).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Add a field' }));
    expect(screen.getAllByRole('button', { name: /Remove field/ })).toHaveLength(2);
    expect(screen.getByLabelText('Name for field 2')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Remove field 2' }));
    expect(screen.getAllByRole('button', { name: /Remove field/ })).toHaveLength(1);
  });

  test('saving calls the op with the edited config', () => {
    const onSave = vi.fn();
    renderForm(step(), onSave);
    fireEvent.change(screen.getByLabelText('Instructions'), {
      target: { value: 'Read the catering enquiry.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add a field' }));
    fireEvent.change(screen.getByLabelText('Name for field 2'), { target: { value: 'need' } });
    fireEvent.change(screen.getByLabelText('Description for field 2'), {
      target: { value: 'What they need' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith({
      config: {
        instructions: 'Read the catering enquiry.',
        fields: [
          { name: 'email', type: 'email', description: 'The sender email' },
          { name: 'need', type: 'text', description: 'What they need', optional: false },
        ],
      },
      inputs: { text: '{{trigger.email.body}}' },
    });
  });

  test('enum config renders a select with the schema options', () => {
    const onSave = vi.fn();
    const write = step({
      id: 'write',
      type: 'ai.write',
      title: 'Write the reply',
      config: { instructions: 'Be warm.', tone: 'formal' },
      inputs: { context: '{{extract}}' },
    });
    const wf = workflow([step(), write]);
    wf.edges = [
      { from: 'trigger', to: 'extract' },
      { from: 'extract', to: 'write' },
    ];
    render(<ConfigForm step={write} workflow={wf} onSave={onSave} />);
    const tone = screen.getByLabelText('Tone');
    expect(tone.tagName).toBe('SELECT');
    expect((tone as HTMLSelectElement).value).toBe('formal');
    fireEvent.change(tone, { target: { value: 'brief' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSave).toHaveBeenCalledWith({
      config: { instructions: 'Be warm.', tone: 'brief' },
      inputs: { context: '{{extract}}' },
    });
  });

  test('"question" renders multiline (textarea)', () => {
    const approve = step({
      id: 'approve',
      type: 'approval.ask',
      title: 'Check the reply',
      config: { question: 'Look good?' },
      inputs: { text: '{{write.text}}' },
    });
    render(<ConfigForm step={approve} workflow={workflow([approve])} onSave={() => {}} />);
    expect(screen.getByLabelText('Question').tagName).toBe('TEXTAREA');
  });

  test('number and boolean configs render number inputs and checkboxes', () => {
    // No catalog config uses number/boolean yet, so a duck-typed stand-in
    // schema exercises those renderers (the introspector reads _def only).
    const def = {
      type: 'test.fake',
      kind: 'enrich',
      title: 'Fake',
      description: 'Fake.',
      configSchema: {
        _def: { typeName: 'ZodObject' },
        shape: {
          count: { _def: { typeName: 'ZodNumber' } },
          loud: { _def: { typeName: 'ZodBoolean' } },
        },
      },
      inputSchema: { _def: { typeName: 'ZodObject' }, shape: {} },
      outputSchema: { _def: { typeName: 'ZodObject' }, shape: {} },
    } as unknown as StepDef;
    const onSave = vi.fn();
    const fake = step({ id: 'fake', type: 'test.fake', config: { count: 2, loud: true }, inputs: {} });
    render(<ConfigForm step={fake} workflow={workflow([fake])} onSave={onSave} def={def} />);
    const count = screen.getByLabelText('Count');
    expect(count.getAttribute('type')).toBe('number');
    const loud = screen.getByLabelText('Loud');
    expect(loud.getAttribute('type')).toBe('checkbox');
    expect((loud as HTMLInputElement).checked).toBe(true);
    fireEvent.change(count, { target: { value: '5' } });
    fireEvent.click(loud);
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSave).toHaveBeenCalledWith({ config: { count: 5, loud: false }, inputs: {} });
  });

  test('Inputs section offers upstream step outputs or free text', () => {
    const onSave = vi.fn();
    renderForm(step(), onSave);
    // The picker lists the trigger's email fields in plain words…
    const picker = screen.getByLabelText('Pick an output for Text');
    const options = [...(picker as HTMLSelectElement).options].map((o) => o.text);
    expect(options).toContain('Gmail button → email subject');
    // …and choosing one fills the binding.
    fireEvent.change(picker, { target: { value: '{{trigger.email.subject}}' } });
    expect((screen.getByLabelText('Text') as HTMLInputElement).value).toBe(
      '{{trigger.email.subject}}',
    );
    // Free text also works.
    fireEvent.change(screen.getByLabelText('Text'), { target: { value: 'hello there' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSave).toHaveBeenCalledWith({
      config: {
        instructions: 'Read the enquiry.',
        fields: [{ name: 'email', type: 'email', description: 'The sender email' }],
      },
      inputs: { text: 'hello there' },
    });
  });

  test('steps with no upstream show a hint instead of a picker', () => {
    const lonely = step({ id: 'lonely', inputs: { text: '' } });
    const wf = workflow([lonely]);
    wf.edges = [];
    render(<ConfigForm step={lonely} workflow={wf} onSave={() => {}} />);
    expect(screen.queryByLabelText('Pick an output for Text')).toBeNull();
    expect(screen.getByText('Connect this step after another step to pick its outputs.')).toBeDefined();
    // Free text still works.
    expect(screen.getByLabelText('Text')).toBeDefined();
  });

  test('saving is disabled while a save is in flight', () => {
    render(
      <ConfigForm step={step()} workflow={workflow()} onSave={() => {}} saving={true} />,
    );
    const save = screen.getByRole('button', { name: 'Saving…' });
    expect(save.hasAttribute('disabled')).toBe(true);
  });
});
