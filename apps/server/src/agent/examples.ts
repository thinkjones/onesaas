// Worked builder examples for the system prompt. Flow 1 mirrors
// apps/server/src/seed/flow1.json exactly (same step types, titles, configs
// and bindings), so the agent learns the real shapes. Flow 2 is the M4
// booking flow; its step ids below are shortened — the prompt tells the
// builder to read the real ids off the Links line.

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

export const flow2ExampleUser =
  'When someone emails asking to book a time, check my calendar, save the booking and put it in my calendar, then draft a confirmation for me to check.';

/**
 * Flow 2 as a worked example: the booking flow from the M4 plan (new email →
 * read → sort → extract → calendar check → save → event → write → approval →
 * draft). Step ids below are shortened ("sort", "extract", …): in a real
 * build every add_step result shows up on the Links line with its full id
 * (e.g. trigger → sort-booking-asks-k7m2p9), and the builder must use those
 * real ids in "after", bindings and the "when" condition.
 */
export const flow2Example = `Example: "${flow2ExampleUser}"

The builder thinks: a new email starts it on its own, then read the whole
email, check it is a booking ask, pull out the details, check the calendar,
save the booking, add the event, write a confirmation, check it with Dad,
and draft it.

New-email triggers carry no body, so the first step reads the full email.
The sort keeps the plain yes/no options, and the extract step only runs on
"yes" — added after the sort step first (a plain wire), then the same two
steps are connected again with "when", which replaces the plain wire with
the conditional one. Ids below are shortened; use the real ids from the
Links line.

Tool calls:

1. create_table {"name": "bookings", "label": "Bookings", "columns": [{"name": "name", "label": "Name", "type": "text"}, {"name": "email", "label": "Email", "type": "email"}, {"name": "service", "label": "Service", "type": "text"}, {"name": "start", "label": "Start", "type": "datetime"}, {"name": "end", "label": "End", "type": "datetime"}, {"name": "status", "label": "Status", "type": "text"}], "displayField": "name"}

2. set_trigger {"type": "trigger.email", "config": {}, "title": "New email", "summary": "Runs when a new customer email arrives."}

3. add_step {"type": "gmail.read", "title": "Read email", "summary": "Read the full email.", "config": {}, "inputs": {"threadId": "{{trigger.email.threadId}}"}, "after": "trigger"}

4. add_step {"type": "ai.classify", "title": "Sort booking asks", "summary": "Check whether the email asks to book an appointment.", "config": {"question": "Is this asking to book an appointment?", "options": ["yes", "no"]}, "inputs": {"text": "{{read.body}}"}, "after": "<the read step's id>"}

5. add_step {"type": "ai.extract", "title": "Extract booking", "summary": "Pull the booking details out of the email.", "config": {"instructions": "Extract the booking details from this email.", "fields": [{"name": "name", "type": "text", "description": "Who wants to book"}, {"name": "email", "type": "email", "description": "Their email address"}, {"name": "service", "type": "text", "description": "What they want to book, in a few words"}, {"name": "start", "type": "datetime", "description": "When the booking starts"}, {"name": "end", "type": "datetime", "description": "When the booking ends"}]}, "inputs": {"text": "{{read.body}}"}, "after": "<the sort step's id>"} — then connect {"from": "<the sort step's id>", "to": "<the extract step's id>", "when": "<the sort step's id>.choice == 'yes'"} to make that wire conditional.

6. add_step {"type": "calendar.freeBusy", "title": "Check calendar", "summary": "Check whether the time is free.", "config": {}, "inputs": {"start": "{{extract.start}}", "end": "{{extract.end}}"}, "after": "<the extract step's id>"}

7. add_step {"type": "table.insert", "title": "Save booking", "summary": "Save the booking to the Bookings list.", "config": {"table": "bookings"}, "inputs": {"row": "{{extract}}"}, "after": "<the calendar step's id>"}

8. add_step {"type": "calendar.createEvent", "title": "Add event", "summary": "Put the booking in the calendar.", "config": {}, "inputs": {"title": "Booking for {{extract.name}}", "start": "{{extract.start}}", "end": "{{extract.end}}"}, "after": "<the save step's id>"}

9. add_step {"type": "ai.write", "title": "Write confirmation", "summary": "Write a confirmation, or offer another time when busy.", "config": {"instructions": "Write a short confirmation email for the booking below. When it says the slot is taken (free is false), offer the closest free time instead and ask if that works. Sign off as the owner.", "tone": "friendly"}, "inputs": {"context": "Name: {{extract.name}}, service: {{extract.service}}, start: {{extract.start}}, end: {{extract.end}}, free: {{check.free}}"}, "after": "<the event step's id>"}

10. add_step {"type": "approval.ask", "title": "Approve confirmation", "summary": "Check the confirmation with you before drafting it.", "config": {}, "inputs": {"text": "{{write.text}}"}, "after": "<the write step's id>"}

11. add_step {"type": "gmail.draftReply", "title": "Draft reply", "summary": "Draft the confirmation in Gmail.", "config": {}, "inputs": {"body": "{{approve.text}}", "threadId": "{{trigger.email.threadId}}"}, "after": "<the approve step's id>"}

12. test_run {} — read the one-line-per-step preview. Reads need Dad's computer: when Gmail or Calendar is not open the read previews fail ("I need Gmail open in Chrome to do this") and the rest show skipped. That failure is environmental, not shape — keep the steps. The Problems line is the shape oracle: fix anything it names.

13. activate {} — the chore reducer is on.`;
