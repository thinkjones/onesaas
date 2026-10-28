## Your Application

- What's your LinkedIn?
    
    https://www.linkedin.com/in/drgenejones/
    
- What's your Twitter/X?
    
    https://x.com/foursignalsdev
    
- What's your Github?
    
    https://github.com/thinkjones
    
- Where do you live (City, State, Country)?
    
    Seattle, WA, USA
    
- Are you applying for the startup track or indie dev track? (you can change your track anytime)
    
    Indie Dev Track
    
- Where do you study or work?
    
    Four Signals
    
- What do you want to build for this hackathon?
    
    I’ve spent the past year building with agentic harnesses, and they’re powerful. But they only work for people who already think like engineers. Even for me, agent work quickly turns into a sprawl of prompts, folders and half-finished files. Business users give up long before that point, and small business owners don’t start at all. My dad is one of those people, and I want to build something he will actually use. I’m building a visual workflow tool for non-technical people. You describe a task in plain English, like “every Monday, pull last week’s invoices, flag anything overdue, and draft reminder emails.” The tool turns that into a DAG you can see and edit: one box per step, with arrows showing what feeds into what. Agents then run through the graph one node at a time. Each node shows what it received, what it did, and what it produced. Visibility is the core of the idea. You can watch a run live, see where it stopped and why, and change a single step without starting over. There are no folders to manage and no prompts to babysit. I’ll use Muse Spark through the Meta Model API to plan the graph and run the agent at each node. My goal for the ten days is a working demo my dad can run on a real task without my help.
    
- Tell us about an AI project you recently built that showcases your technical skills. (hint: Include what you built, the techniques you used) 
    
    SohoForms (forms.sohogo.app) turns paper forms into working web forms. You upload a PDF or describe the form in plain English, and in about two minutes you have a live form. It handles sections and repeating rows, totals that recalculate as you type and are re-checked on the server, show/hide logic, and custom themes. Submissions go to Slack, Google Sheets or email. Extraction: a Python/LangGraph pipeline sends the PDF directly to Claude, with Gemini as the fallback, and outputs a FormDefinition JSON with sandboxed jexl expressions. In the spike, this design got 13 of 13 computed totals correct on a GSA construction estimate. Stack: an edge-first stack of TanStack Start (React 19) on Cloudflare Workers, with R2, Neon Postgres via Hyperdrive, Drizzle, Better Auth and Stripe. The pipeline runs as a Cloudflare Container behind a Service Binding. How it was built: the real experiment was whether an agentic software factory could ship a full-stack MVP end to end. I built the harness on Gas City and acted as product owner, architect and reviewer while the agents did the building. Five CI tiers, golden tests and ADRs the agents must follow kept the work production-grade. Every agent action is a git-backed commit, so I get retry, resume and an audit trail. Two open-source Go tools came out of keeping that agent work under control: Intelligent Package Manager (IPM): a workflow tool for managing agentic artifacts. It indexes the repos you choose into a searchable catalog, and a TUI lets you search it and browse the artifact tree. It builds packs (Claude Code plugins) for user or project scope and installs them to Claude Code and Gas City. Codex and Cursor are listed as coming soon. Easy Config (ezc): one git-backed store for secrets and variables, layered by environment into every repo. Secrets are encrypted with SOPS/age and can only be decrypted with a local private key. Access is managed through join requests and user and CI bot keys. Each repo’s environment is validated against a manifest, then loaded via mise, direnv or ezc run. Links: github.com/thinkjones/intelligent-package-manager · github.com/thinkjones/easy-config · foursignals.dev/building
    
- Have you used Meta Model API before?
    
    Yes
    
- How likely are you to build with Meta Model API?
    
    Somewhat likely
    
- How would you describe your overall opinion of Meta Model API?
    
    Somewhat favorable
    
- How did you hear about this hackathon?
    
    Instagram Reel