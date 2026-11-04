// Worked builder examples for the system prompt. Flow 1 mirrors
// apps/server/src/seed/flow1.json exactly (same step types, titles, configs
// and bindings), so the agent learns the real shapes. Flow 2 is the M4
// booking flow; its step ids below are shortened — the prompt tells the
// builder to read the real ids off the Links line. Flow 4 builds TWO reducers
// in one turn (email branch, then create_workflow, then the photo branch),
// with no test_run/activate: the turn is for building both, and Dad turns
// both on himself.

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

9. activate {} — the automation is on.`;

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

13. activate {} — the automation is on.`;

export const flow4ExampleUser =
  'When a new customer emails, do what you did before, and also let me drop in a product photo to turn into a post for Facebook and Instagram.';

/**
 * Flow 4 as a worked example: TWO reducers built in sequence in one turn.
 * The email branch is the flow 1 button flow plus a new-customer check (look
 * the sender up in Customers, sort new-or-known, flag new ones); then
 * create_workflow starts the photo reducer (drop a photo → cutout →
 * generated post image → caption → log it → approve → prepare the post in
 * Business Suite). Step ids are shortened like flow 2's. No test_run, no
 * activate: a test or activation would target only the second reducer, and
 * the turn is for building both — Dad turns both on himself.
 *
 * LIMITATION (email branch, steps 3–4): `where` must be a record, so
 * bindings can't express {email: X} — the lookup filters on the WHOLE
 * extract output (name, email, need, urgency), and a returning customer
 * with a new need matches zero rows (count 0). The classify step therefore
 * compares emails — sender vs {{lookup.rows[0].email}}, "same email =
 * known, regardless of count" — instead of trusting count. (Upsert is
 * keyed by email, so at most one row can match a sender: rows[0] is the
 * whole candidate set.)
 */
export const flow4Example = `Example: "${flow4ExampleUser}"

The builder thinks: two different jobs in one sentence. The email branch is
the button flow from before plus a new-customer check; the photo branch is a
whole separate automation. Build the email branch first, then start the second
automation and build the photo branch there — never mix both jobs' steps into
one automation.

The Customers and Posts lists already exist (see the lists section), so this
build needs no create_table calls. When a list is missing, create it first:
Customers (name text, email email, need text, urgency text, shown by name,
keyed by email) and Posts (caption text, image text, shown by caption).

Ids below are shortened; use the real ids from the Links line.

Build straight through without explain calls — the lists section already
shows every column, and both automations must fit in this one turn. Every step
below is required: do not stop after the email branch, and do not skip the
Posts log (it is how Dad finds the post later). Finish the whole email
branch (steps 1–9, through the draft and the conditional edge) before
create_workflow — there is no way back to the email automation afterwards.

Tool calls (email branch):

1. set_trigger {"type": "trigger.gmailButton", "config": {"label": "✨ Save as lead & reply"}, "title": "Gmail button", "summary": "Runs when you click the button in Gmail."}

2. add_step {"type": "ai.extract", "title": "Extract details", "summary": "Read the name, email, need and urgency from the email.", "config": {"instructions": "Extract the customer's details from this email.", "fields": [{"name": "name", "type": "text", "description": "The customer's full name"}, {"name": "email", "type": "email", "description": "The customer's email address"}, {"name": "need", "type": "text", "description": "What the customer is asking for, in a few words"}, {"name": "urgency", "type": "text", "description": "How urgent the request seems (low, normal or high)"}]}, "inputs": {"text": "From {{trigger.email.fromName}} <{{trigger.email.from}}>\\nSubject: {{trigger.email.subject}}\\n\\n{{trigger.email.body}}"}, "after": "trigger"}

3. add_step {"type": "table.query", "title": "Look up customer", "summary": "Find this sender in the Customers list.", "config": {"table": "customers"}, "inputs": {"where": "{{extract}}"}, "after": "<the extract step's id>"} — the whole extract output doubles as the lookup filter (name, email, need and urgency are all Customer columns).

4. add_step {"type": "ai.classify", "title": "Check if new", "summary": "Check whether this sender is a new customer.", "config": {"question": "Is this person new? The sender is known when their email matches the known customer email, regardless of the matching-customers count — only a blank known customer email means new.", "options": ["yes", "no"]}, "inputs": {"text": "From {{extract.name}} <{{extract.email}}> about {{extract.need}}. Matching customers: {{lookup.count}}. Known customer email: {{lookup.rows[0].email}}."}, "after": "<the lookup step's id>"}

5. add_step {"type": "notify", "title": "Flag new customer", "summary": "Tell Dad when a new customer emails.", "config": {}, "inputs": {"text": "New customer: {{extract.name}}"}, "after": "<the sort step's id>"} — then connect {"from": "<the sort step's id>", "to": "<the flag step's id>", "when": "<the sort step's id>.choice == 'yes'"} to make that wire conditional.

6. add_step {"type": "table.upsert", "title": "Save to Customers", "summary": "Save the customer to the Customers list.", "config": {"table": "customers", "keyField": "email"}, "inputs": {"row": "{{extract}}"}, "after": "<the lookup step's id>"} — chained AFTER the lookup, never beside it: the lookup must read the list before this save writes, or a new customer would match their own just-saved row and the flag would never fire.

7. add_step {"type": "ai.write", "title": "Write reply", "summary": "Write a short, warm reply.", "config": {"instructions": "Write a short, warm reply that thanks them and says we'll get back to them about their need within one business day. Sign off as the owner.", "tone": "friendly"}, "inputs": {"context": "{{extract}}"}, "after": "<the save step's id>"}

8. add_step {"type": "approval.ask", "title": "Approve reply", "summary": "Check the reply with you before drafting it.", "config": {"question": "Is this reply OK to put in Gmail?"}, "inputs": {"text": "{{write.text}}"}, "after": "<the write step's id>"}

9. add_step {"type": "gmail.draftReply", "title": "Draft reply", "summary": "Draft the reply in Gmail.", "config": {}, "inputs": {"body": "{{approve.text}}", "threadId": "{{trigger.email.threadId}}"}, "after": "<the approve step's id>"}

Tool calls (photo branch — a separate automation):

10. create_workflow {"name": "Product photo posts", "description": "Turns a dropped-in product photo into a Facebook and Instagram post."} — only after steps 1–9 are all built; there is no way back. Now building the photo reducer; set its trigger next.

11. set_trigger {"type": "trigger.upload", "config": {"prompt": "Drop a product photo here"}, "title": "Photo upload", "summary": "Runs when you drop a photo."}

12. add_step {"type": "image.cutout", "title": "Cut out the product", "summary": "Cut the product out of the photo.", "config": {"thing": "the product"}, "inputs": {"file": "{{trigger.file}}"}, "after": "trigger"}

13. add_step {"type": "image.generate", "title": "Make the post image", "summary": "Make an eye-catching post image from the cutout.", "config": {"style": "A warm, eye-catching social-media post background in soft daylight"}, "inputs": {"reference": "{{cutout.file}}"}, "after": "<the cutout step's id>"}

14. add_step {"type": "ai.write", "title": "Write caption", "summary": "Write a short caption for the post.", "config": {"instructions": "Write one short, warm caption for a Facebook and Instagram product post, ending with two hashtags.", "tone": "friendly"}, "inputs": {"context": "A product photo for a Facebook and Instagram post."}, "after": "<the image step's id>"}

15. add_step {"type": "ai.extract", "title": "Shape the Posts row", "summary": "Copy the caption and image id into a Posts row.", "config": {"instructions": "Copy the caption and image file id into the row fields exactly as written.", "fields": [{"name": "caption", "type": "text", "description": "The post caption, copied exactly"}, {"name": "image", "type": "text", "description": "The image file id, copied exactly"}]}, "inputs": {"text": "Caption: {{caption.text}} Image file id: {{art.file.fileId}}."}, "after": "<the caption step's id>"} — bindings only carry whole step outputs, so this step shapes the row the Posts list needs.

16. add_step {"type": "table.insert", "title": "Log the post", "summary": "Log the caption and image in the Posts list.", "config": {"table": "posts"}, "inputs": {"row": "{{row}}"}, "after": "<the row step's id>"}

17. add_step {"type": "approval.ask", "title": "Approve post", "summary": "Check the post with you before preparing it.", "config": {"question": "Is this post OK to prepare in Business Suite?"}, "inputs": {"text": "{{caption.text}}"}, "after": "<the log step's id>"}

18. add_step {"type": "meta.draftPost", "title": "Prepare Facebook post", "summary": "Open the post in Meta Business Suite.", "config": {}, "inputs": {"text": "{{approve.text}}", "image": "{{art.file}}"}, "after": "<the approve step's id>"}

Finally, say both automations are built and Dad can turn them on. No test_run, no activate: each would target only the photo reducer, and the turn is for building both in sequence.`;
