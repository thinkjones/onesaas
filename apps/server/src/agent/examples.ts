// Worked builder examples for the system prompt. Flow 1 only: M4 adds flows 2 and 4.
// The tool calls below mirror apps/server/src/seed/flow1.json exactly (same step
// types, titles, configs and bindings), so the agent learns the real shapes.

export const flow1ExampleUser =
  'When I click the button in Gmail, save the sender as a customer and draft a warm reply.';

/**
 * Flow 1 as a worked example: the user's sentence plus the exact tool-call
 * sequence that builds it (trigger, then extract → save → write → approval →
 * draft, then the connections between them). Embedded verbatim in the prompt.
 */
export const flow1Example = `Example: "${flow1ExampleUser}"

The builder thinks: a Gmail button starts it, then read the details, save them
to the Customers list, write a warm reply, check it with Dad, and draft it.

Tool calls:

1. set_trigger {"type": "trigger.gmailButton", "config": {"label": "✨ Save as lead & reply"}, "title": "Gmail button", "summary": "Runs when you click the button in Gmail."}

2. add_step {"type": "ai.extract", "title": "Extract details", "summary": "Read the name, email, need and urgency from the email.", "config": {"instructions": "Extract the customer's details from this email.", "fields": [{"name": "name", "type": "text", "description": "The customer's full name"}, {"name": "email", "type": "email", "description": "The customer's email address"}, {"name": "need", "type": "text", "description": "What the customer is asking for, in a few words"}, {"name": "urgency", "type": "text", "description": "How urgent the request seems (low, normal or high)"}]}, "inputs": {"text": "From {{trigger.email.fromName}} <{{trigger.email.from}}>\\nSubject: {{trigger.email.subject}}\\n\\n{{trigger.email.body}}"}, "after": "trigger"}

3. add_step {"type": "table.upsert", "title": "Save to Customers", "summary": "Save the customer to the Customers list.", "config": {"table": "customers", "keyField": "email"}, "inputs": {"row": "{{extract}}"}, "after": "<the extract step's id>"}

4. add_step {"type": "ai.write", "title": "Write reply", "summary": "Write a short, warm reply.", "config": {"instructions": "Write a short, warm reply that thanks them and says we'll get back to them about their need within one business day. Sign off as the owner.", "tone": "friendly"}, "inputs": {"context": "{{extract}}"}, "after": "<the save step's id>"}

5. add_step {"type": "approval.ask", "title": "Approve reply", "summary": "Check the reply with you before drafting it.", "config": {"question": "Is this reply OK to put in Gmail?"}, "inputs": {"text": "{{write.text}}"}, "after": "<the write step's id>"}

6. add_step {"type": "gmail.draftReply", "title": "Draft reply", "summary": "Draft the reply in Gmail.", "config": {}, "inputs": {"body": "{{approve.text}}", "threadId": "{{trigger.email.threadId}}"}, "after": "<the approve step's id>"}

7. connect each step in order: trigger → extract → save → write → approve → draft. (Each add_step above already connects itself through "after"; connect is for links the builder did not make that way.)

8. test_run {} — read the one-line-per-step preview, fix anything that failed.

9. activate {} — the chore reducer is on.`;
