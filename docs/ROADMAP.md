# E2EE Chat Architectural Roadmap
*This is the persistent roadmap. Do not lose these core system priorities.*

## PHASE 1 — CURRENT (IN PROGRESS)
- [x] Fix edit message version sync
- [x] Enforce `cache.version === server.version`
- [x] Stabilize socket update flow

## PHASE 2 — STATE AUTHORITY (NEXT)
- [x] Inject version in backend schema (`Note.js`)
- [x] Enforce version increment ONLY on server
- [x] Reject stale socket packets globally

## PHASE 3 — HYDRATION ENGINE
- [x] Rewrite `MessageLifecycleManager`
- [x] Remove blind cache usage
- [ ] Deterministic rebuild pipeline

## PHASE 4 — GROUP MESSAGING (FUTURE READY)
- [ ] Multi-recipient key encryption
- [ ] Per-user `encryptedKeysMap` expansion
- [ ] Scalable session handling

## PHASE 5 — MEDIA SYSTEM HARDENING
- [ ] Blob cache recovery after refresh
- [ ] Streaming decrypt for large files
- [ ] Background media key rotation

## PHASE 6 — WHATSAPP-LEVEL FEATURES
- [ ] Reply threading (fully encrypted)
- [ ] Message reactions
- [ ] Forwarding with re-encryption
- [ ] Ephemeral messages

---

🔴 **GLOBAL RULE:** DO NOT MODIFY ENCRYPTION CORE.  
ALL CHANGES MUST RESPECT: `Server` → `Socket` → `Cache` → `UI`
