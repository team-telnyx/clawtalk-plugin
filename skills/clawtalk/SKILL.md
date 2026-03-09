# ClawTalk Skill

Voice calls, SMS, missions, and approvals via the ClawTalk plugin.

## Tools

### Communication
| Tool | Description |
|------|-------------|
| `clawtalk_call` | Initiate an outbound phone call |
| `clawtalk_call_status` | Check status of an active call |
| `clawtalk_sms` | Send an SMS message |
| `clawtalk_sms_list` | List recent SMS messages |
| `clawtalk_sms_conversations` | List SMS conversations |
| `clawtalk_approve` | Request push notification approval for sensitive actions |
| `clawtalk_status` | Check ClawTalk connection and account status |

### Mission Lifecycle
| Tool | Description |
|------|-------------|
| `clawtalk_mission_init` | Create a new mission with targets and plan |
| `clawtalk_mission_setup_agent` | Configure voice AI assistant for a mission |
| `clawtalk_mission_schedule` | Schedule call/SMS events for mission targets |
| `clawtalk_mission_event_status` | Check status of scheduled events |
| `clawtalk_mission_complete` | Mark mission as complete with summary |
| `clawtalk_mission_update_step` | Update a plan step status |
| `clawtalk_mission_log_event` | Log a mission event (note, outcome, etc.) |
| `clawtalk_mission_memory` | Save/load mission memory (context persistence) |
| `clawtalk_mission_list` | List all missions |
| `clawtalk_mission_get_plan` | Get the full plan for a mission run |
| `clawtalk_mission_cancel_event` | Cancel a scheduled event |

### Standalone
| Tool | Description |
|------|-------------|
| `clawtalk_assistants` | List and manage voice AI assistants |
| `clawtalk_insights` | Get conversation insights and recordings |

## Mission Lifecycle

1. **Init**: `clawtalk_mission_init` with name, description, targets, mission class
2. **Setup Agent**: `clawtalk_mission_setup_agent` to create/configure voice AI assistant
3. **Schedule**: `clawtalk_mission_schedule` to queue calls/SMS for each target
4. **Monitor**: `clawtalk_mission_event_status` to poll scheduled event progress
5. **Complete**: `clawtalk_mission_complete` with summary when all events done

### Mission Classes
- **parallel_sweep**: Call all targets simultaneously (e.g., customer outreach)
- **sequential_negotiation**: Call targets in order, results inform next call
- **broadcast**: Same message to all targets (announcements)
- **survey**: Collect structured responses from targets
- **escalation**: Try targets in priority order until one succeeds

### Polling Strategy
Use OpenClaw cron jobs to poll mission event status:
```
Schedule a cron job every 5 minutes to check clawtalk_mission_event_status
for active missions. Report completed/failed events.
```

## Approval Flow

Before sensitive actions during voice calls, request approval:
1. Call `clawtalk_approve` with action description
2. User receives push notification on their phone
3. Wait for response: approved, denied, timeout, no_devices
4. If timeout: offer voice confirmation as fallback

Use `biometric: true` for high-security actions (financial, destructive).

## Voice Call Context

During active calls, the agent automatically receives:
- Voice rules (short responses, natural speech, no markdown)
- Drip progress updates (brief status after each tool call)
- Approval instructions (when/how to request)
- Full tool access reminder

## Common Pitfalls

- **Slug consistency**: Mission slugs must be unique and consistent across all tool calls
- **Save memory**: Use `clawtalk_mission_memory` to persist context between polling intervals
- **Check status before complete**: Always verify all events are done before completing
- **Event scheduling**: Schedule events after agent setup, not before
- **Phone format**: Always use E.164 format (+1234567890)

## Health Check

The plugin exposes `GET /clawtalk/health` on the gateway server with:
- WebSocket connection status
- Doctor checks (local + server-side)
- Plugin version and uptime

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
