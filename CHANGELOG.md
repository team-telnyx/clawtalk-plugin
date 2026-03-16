# Changelog

All notable changes to this project will be documented in this file.

## [0.1.2] - 2026-03-13

### Added
- MissionObserver: background cron loop replaces heartbeat-driven polling
- Mission event handling via WebSocket (call_completed, call_failed, insights_ready, sms_delivered)
- SMS thread context injected into mission sessions
- Tool-level guardrails for mission lifecycle (state machine enforcement)
- Mission SKILL.md rewritten for webhook-driven architecture

### Changed
- Mission lifecycle is now fully event-driven (WebSocket push, observer as safety net)
- Loosened MissionObserver `collectActions` for edge cases

## [0.1.1] - 2026-03-11

### Added
- `openclaw clawtalk doctor` and `openclaw clawtalk config` CLI commands
- `openclaw clawtalk logs` for tailing WebSocket log

### Fixed
- Biome lint and formatting cleanup
- CI: use `npm install` for cross-version compatibility
- Replace `stty` with `tty.ReadStream` for portability

### Removed
- Install script (replaced by `openclaw plugins install`)

## [0.1.0] - 2026-03-09

Initial release.

### Added
- **Phase 1:** Plugin scaffold (openclaw.plugin.json, TypeScript, Biome, Vitest)
- **Phase 2:** ClawTalkClient SDK with Stripe-style namespaced API (calls, sms, missions, assistants, numbers, insights, approvals, doctor, user)
- **Phase 3:** Event handlers (CallHandler, DeepToolHandler, SmsHandler, WalkieHandler, ApprovalManager)
- **Phase 4:** 20 agent tools (7 communication, 11 mission, 2 standalone)
- **Phase 5:** MissionService with full lifecycle management, MissionEventHandler for real-time events
- **Phase 6:** Plugin entry point with CoreBridge (in-process agent execution), WebSocketService with persistent connection, health endpoint
- **Phase 7A:** GitHub Actions CI workflow, VoiceService, DoctorService
- PIN authentication for inbound calls
- Whitelist support for calls and SMS
- External caller tool blocking (whitelisted callbacks cannot invoke agent tools)
- WebSocket log file with API key redaction and rotation
- TypeBox schemas for all tool parameters
- 110+ tests across SDK, services, and tools
