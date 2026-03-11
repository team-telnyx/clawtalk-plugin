# ClawTalk

Voice calls, SMS, AI missions, and approvals via the ClawTalk plugin.

## Tools

### Communication
| Tool | Description |
|------|-------------|
| `clawtalk_call` | Initiate an outbound phone call |
| `clawtalk_call_status` | Check/end an active call |
| `clawtalk_sms` | Send an SMS (or MMS with media) |
| `clawtalk_sms_list` | List recent SMS messages |
| `clawtalk_sms_conversations` | List SMS conversations |
| `clawtalk_approve` | Request push notification approval for sensitive actions |
| `clawtalk_status` | Check connection, account, and WebSocket health |

### Mission Lifecycle
| Tool | Description |
|------|-------------|
| `clawtalk_mission_init` | Create mission with run and optional plan |
| `clawtalk_mission_setup_agent` | Create voice assistant and link to mission |
| `clawtalk_mission_schedule` | Schedule call/SMS events |
| `clawtalk_mission_event_status` | Check scheduled event status |
| `clawtalk_mission_update_step` | Update plan step status (state machine enforced) |
| `clawtalk_mission_log_event` | Log a mission event |
| `clawtalk_mission_memory` | Save/load/append mission memory |
| `clawtalk_mission_complete` | Complete mission (all steps must be terminal) |
| `clawtalk_mission_list` | List active missions |
| `clawtalk_mission_get_plan` | Get plan steps for a mission |
| `clawtalk_mission_cancel_event` | Cancel a scheduled event |

### Standalone
| Tool | Description |
|------|-------------|
| `clawtalk_assistants` | List/create/update voice assistants |
| `clawtalk_insights` | Get AI-generated conversation insights |

---

## When to Use a Mission vs a Simple Call

**Use a mission when:**
- Multiple calls or SMS to different targets
- Multi-step workflow with tracking and audit trail
- Need retries, failure tracking, or result comparison
- Complex outreach: surveys, negotiations, screening

**Skip the mission when:**
- Single outbound call or one-off SMS
- No need for plans, state tracking, or recovery
- One step, one action, done

For simple calls: create/reuse an assistant, schedule the call, check status, get insights. No mission overhead needed.

---

## Mission Lifecycle

### Phase 0: Planning Interview

**Before creating a mission, run a structured interview with the user.** Do not jump straight to `clawtalk_mission_init`. Missions started with insufficient detail get stuck, waste calls, and produce poor results.

**Gather the following before proceeding:**

1. **Goal** — What is the desired outcome? Be specific. "Get quotes" is vague. "Get per-floor pricing from at least 3 commercial window washing contractors in Chicago" is actionable.
2. **Targets** — Who are we contacting? Names, phone numbers (E.164), relationship/context. If not known yet, define the research step to find them.
3. **What to collect** — Exactly what information should the assistant extract from each call/SMS? Rates, availability, insurance, callback times?
4. **Acceptance criteria** — How do we know the mission succeeded? "Got 3+ quotes" vs "Found cheapest option under $500."
5. **Edge cases** — What if nobody answers? What if they say no? What if voicemail? What if the price is way too high? Define fallback behaviour.
6. **Notification preferences** — How should the user be notified of progress and results? SMS to their verified number? Summary at the end?
7. **Timing** — When should calls happen? Business hours in which timezone? Any deadlines?
8. **Mission class** — Based on the answers, identify the class (parallel sweep, sequential negotiation, etc.) and explain the approach.

**Ask for what's missing. Don't assume.** If the user says "call some plumbers", you need to know: which plumbers, what area, what service, what to ask, what's a good price. Push back until the mission is well-defined.

Once you have clear answers, summarise the plan back to the user for confirmation. Then proceed to init.

### Phase 1: Initialize

```
clawtalk_mission_init
  name: "Descriptive mission name"
  instructions: "What this mission is about"
  request: "Original user request"
  steps: '[{"title":"Step 1","description":"..."}, ...]'
```

Returns a `slug` (auto-generated from name). **Use this exact slug for ALL subsequent calls.** Mismatched slugs = broken linkage.

If a mission with the same slug exists, it resumes automatically (idempotent).

### Phase 2: Setup Agent

```
clawtalk_mission_setup_agent
  slug: "<slug from init>"
  name: "Agent Name"
  instructions: "Detailed agent instructions..."
  greeting: ""          # Empty for outbound (recipient speaks first)
  voice: "Rime.ArcanaV3.astra"  # Default
  model: "openai/gpt-4o"        # Default
```

Creates assistant, links to mission run, assigns phone number. Idempotent.

**Assistant instructions matter.** Be specific about: what to ask, what to collect, how to handle edge cases (voicemail, IVR, no answer). Include context about who the assistant represents.

### Phase 3: Schedule Events

```
clawtalk_mission_schedule
  slug: "<slug>"
  channel: "call" | "sms"
  to: "+15551234567"        # E.164 format always
  scheduledAt: "ISO 8601"   # Must be in the future
  stepId: "step-id"         # Links event to plan step
  textBody: "Message"       # Required for SMS
```

**Business hours:** Schedule calls during 9 AM - 5 PM local time for the recipient. Stagger multiple calls 1-2 minutes apart.

### Phase 4: Real-Time Events (Webhook-Driven)

The server pushes mission events to the plugin via WebSocket in real-time. **No polling required** for standard call/SMS lifecycle.

#### Events You Receive

| Event | When | Key Data |
|-------|------|----------|
| `mission.call_started` | AI conversation begins | conversation_id, from, to |
| `mission.call_completed` | Call ends normally | duration_sec, reason, transcript |
| `mission.call_failed` | Call failed (no answer, busy, error) | reason |
| `mission.insights_ready` | AI insights generated (~7s after hangup) | summary |
| `mission.sms_delivered` | Outbound SMS delivered/failed | status, errors |

**On `mission.call_completed`:** You get the full transcript (last 20 messages). Review it, extract key information, save to mission memory, update the step.

**On `mission.call_failed`:** Decide if retryable (no-answer, busy) or terminal. Reschedule or mark step failed.

**On `mission.insights_ready`:** AI-generated summary arrives automatically. Save to memory for final analysis.

#### Overdue Safety Net

If WebSocket disconnects, a backup polling mechanism fires periodically to catch stuck events. This is disaster recovery only; normal flow is webhook-driven.

### Phase 5: Complete

```
clawtalk_mission_complete
  slug: "<slug>"
  summary: "Results summary"
  payload: '{"key": "structured results"}'
```

**This will REJECT if any steps are non-terminal.** All steps must be completed, failed, or skipped first.

---

## Step Lifecycle (State Machine)

Steps follow a strict state machine. No going backwards from terminal states.

```
pending ──→ in_progress ──→ completed
  │                    ├──→ failed
  │                    └──→ skipped
  └──→ skipped
```

**Valid transitions:**
- `pending` → `in_progress` (starting work)
- `pending` → `skipped` (not needed)
- `in_progress` → `completed` (success)
- `in_progress` → `failed` (unrecoverable failure)
- `in_progress` → `skipped` (no longer relevant)

**Invalid:**
- `completed` → anything (terminal)
- `failed` → anything (terminal)
- `skipped` → anything (terminal)
- `pending` → `completed` (must go through in_progress)
- `pending` → `failed` (must go through in_progress)

### YOU Own the Lifecycle

The server does NOT auto-update steps. That is your job. For every step:

1. Mark `in_progress` when starting
2. Do the work (schedule call, wait for webhook, etc.)
3. Mark `completed`, `failed`, or `skipped` based on outcome
4. Log events for the audit trail
5. Save results to mission memory

**After every step change, ask: is this mission finished?**

```
Step finished →
  All steps terminal? → COMPLETE MISSION
  More steps remain? → Continue to next
  Unrecoverable failure? → Mark remaining steps skipped, COMPLETE with failure summary
```

---

## Mission Memory

Use `clawtalk_mission_memory` to persist context between events. The frontend reads from server memory.

**Save after every significant action.** If you don't save it, it doesn't show up.

```
# Save structured data
clawtalk_mission_memory action=save slug="<slug>" key="contacts" value='[{"name":"Alice","phone":"+1234"}]'

# Append to a list
clawtalk_mission_memory action=append slug="<slug>" key="call_results" value='{"step":"call-alice","outcome":"got quote","amount":"$500"}'

# Retrieve
clawtalk_mission_memory action=get slug="<slug>" key="contacts"
```

**What to save:**
| Action | Memory Key | Value |
|--------|-----------|-------|
| Found targets via research | `targets` | Array of contacts |
| Scheduled events | `scheduled_events` | Event IDs and details |
| Call completed | `call_results` | Transcript summary, key data |
| Got quote/info | `quotes` or domain-specific | Structured results |
| Decision made | `decisions` | Reasoning and choice |
| Error occurred | `errors` | What failed and why |

---

## Mission Classes

Identify the class before planning. This determines parallelism and dependencies.

### Class 1: Parallel Sweep
Same question to many targets. Schedule all calls in one batch (stagger 1-2 min). Analysis after all complete.
*Example: "Call 10 contractors and get quotes"*

### Class 2: Parallel Screening with Rubric
Fan out calls with structured scoring criteria. Rank results via insights.
*Example: "Call candidates and score on communication, experience, availability"*

### Class 3: Sequential Negotiation
Calls run serially. Each call's strategy depends on prior results. Use `clawtalk_assistants(action=update)` between calls to inject context. **Never parallelize.**
*Example: "Get quotes, then call back the cheapest two and negotiate"*

### Class 4: Multi-Round / Follow-up
Distinct phases with possible human approval gates between rounds.
*Example: "Broad outreach round 1, narrow to top 3, schedule demos"*

### Class 5: Information Gathering → Action
Call to find info, then act on it. Cancel remaining calls when goal is met.
*Example: "Find a plumber available today"*

---

## Inbound Routing

### SMS Replies
When a mission target replies via SMS, the server matches the sender against active mission targets and routes the message (with thread context) into the mission session. Non-mission SMS flows normally.

### Callback Calls
When a mission target calls back, the server matches caller ID against active missions. If matched: skips PIN verification and connects directly to the mission assistant. The mission assistant handles the conversation with full context.

**Multiple missions targeting same number:** Most recent active event wins.

---

## Approval Flow

For sensitive actions (especially during voice calls):

1. Call `clawtalk_approve` with description
2. User gets push notification
3. Responses: `approved`, `denied`, `timeout`, `no_devices`
4. Use `biometric: true` for high-security (financial, destructive)

---

## Operational Notes

### IVR Navigation
Expect IVRs when calling businesses. Instruct assistants to press 0 or say "representative". The `send_dtmf` tool is included by default.

### Retry Strategy
| Recipient Type | Retry Delay | Max Retries |
|---------------|-------------|-------------|
| Automated systems | 5-15 min | 3 |
| Service industry | 30 min - 2 hours | 2 |
| Professionals | Next business day | 1 + voicemail |

Retryable call statuses: `no-answer`, `busy`, `failed` (network error).
Non-retryable: `completed` (even if conversation went badly, handle at mission level).

### Phone Number Format
Always E.164: `+15551234567`. No spaces, no dashes.

### Assistant Instructions Tips
- Be specific about what to collect
- Include fallback behaviour (voicemail, IVR, can't talk now)
- State who the assistant represents
- For outbound: empty greeting (let recipient speak first)
- For sequential missions: update instructions between calls with prior context

---

## Common Pitfalls

| Mistake | Symptom | Fix |
|---------|---------|-----|
| Slug mismatch between tools | Agent not linked, events invisible | Copy slug from init response exactly |
| Not saving to memory | Frontend shows nothing | Save immediately after every action |
| Not updating step status | Mission stuck "running" forever | Update steps as you go, complete when done |
| Trying to complete with pending steps | Error from complete tool | Mark all steps terminal first |
| Trying to revert a completed step | Error from update-step | Terminal states are final |
| Scheduling outside business hours | No answer, wasted calls | Check recipient's local time |
| Not staggering batch calls | Rate limiting | Space calls 1-2 min apart |

---

## Configuration

Set in OpenClaw config under `plugins.clawtalk`:

```yaml
plugins:
  clawtalk:
    apiKey: "your-api-key"
    server: "https://clawdtalk.com"
    ownerName: "Your Name"
    agentName: "Your Agent"
    autoConnect: true
    missions:
      enabled: true
```

## Health Check

Plugin exposes `GET /clawtalk/health` with WebSocket status, doctor checks, version, and uptime.
