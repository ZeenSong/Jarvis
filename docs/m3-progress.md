# M3 implementation and acceptance ledger

Baseline: `dev_guidlines/Jarvis_M3_Investor_Demo_Milestone.md`,
`Jarvis_Product_Architecture_v2.md`, and `Jarvis_Experience_Dynamic_UI_v2.md` (2026-09-09).
The milestone remains **in progress**. Existing M2 functionality does not prove M3 acceptance.

## Requirements and evidence

| Scope | Required completion evidence | Current state |
| --- | --- | --- |
| WP1 Product shell | Chinese Web routes /login, /home, /jarvis, /tasks, /tasks/:id, /apps, /apps/:id, /spaces, /system, /integrations; native Android counterparts; screenshots and navigation tests; shared dark design language and light theme interface | Pending |
| WP2 Dynamic UI | Versioned View/Section/Layout, intent, registry, negotiation/fallback, at least 12 implemented React and Compose components; same Server Incident shown in distinct layouts | Initial TypeScript semantic schema and negotiation tests implemented; renderers and transport pending |
| WP3 CasaOS | Real store/installed reads, install/start/stop, update status, logs, metadata, native detail, advanced console | Pending |
| WP3 Grafana | Real metrics.query and alert.list, normalized MetricSeries/Alert, native monitoring | Pending |
| WP3 Portainer | Real list/inspect/logs/restart with approval, Container resource and native view | Pending |
| WP3 Immich | Real photo search, albums/timeline, Photo resources and native photo/memory view | Pending |
| WP4 Integration Agent | Real application discovery → OpenAPI inspection → resources/capabilities → sandboxed read-only declaration → generated semantics/tests → verification → approval → registration; six capabilities in demo | Pending |
| WP5 Identity | Register/login, user management, sessions/devices, role checks, user-scoped conversation/task/memory | Pending |
| WP5 Memory | User/environment/capability memory, corrections, updates, isolation, actual Core retrieval | Pending |
| WP5 Search | App/capability/task/conversation/memory/file/photo search; real Web provider; combined Core invocation and unified entry | Pending |
| WP5 Schedule | Once/daily/weekly, enable/disable/delete, next run, persisted prompt/task binding and restart recovery | Pending |
| WP5 Notifications | Server-backed notification/approval center and Android task/approval deep links | Pending |
| Frozen contracts | Stable/versioned User, Session, Device, Memory, Conversation, Message, Task, Run, Agent, Skill, Resource, Capability, Action, Integration, Application, Event, Approval, Notification, Schedule, ViewSpec, Artifact; schema tests | Pending beyond initial ViewSpec |
| Agent execution | Core → domain agent → actual run; progress/events/children/artifacts/approval/result; cancel and recovery; results in conversation/workspace | M2 implementation exists; M3 integration and audit pending |
| Demo 1–6 | Continuous login/home → incident → container approval → photos/display queue → learned app → managed execution, no mocks or manual database/CLI repair | Pending |
| Quality gates | Loading/empty/error; Chinese visual inspection; provider health and capability availability; recovery; server/Web/Android automated coverage; ≥4 automated demo paths | Pending |
| Delivery | Runnable deployment/configuration, real provider validation, demo instructions and final requirement-by-requirement acceptance record | Pending |

## Current protocol work

`packages/ui-protocol-v2/src/index.ts` defines a strict semantic ViewSpec 2.0 candidate,
27 component identifiers, bounded actions, unique section IDs, renderer capabilities,
numeric version negotiation, feature flags, and inert text fallback. Component identifiers
are contracts, **not evidence that 27 renderer components are implemented**.
Web placement separates activity/main/resources; Android places summary first and
actions/details in a sheet. This placement helper still needs actual client integration.
Authorization remains a server responsibility; presentation negotiation never grants it.

Verified with `npx tsx --test tests/ui-protocol-v2.test.ts` (5 passing tests) and
`npm run typecheck`. Protocol freeze requires integration and parity evidence from both clients.

## Accepted implementation order (user correction)

Start with **native CasaOS on the current server**, retaining Jarvis/K3s and existing Docker
workloads. Do not prioritize isolated protocol or identity development ahead of proving this
application substrate. The full scope above remains required.

1. CasaOS deployment, authentication and real AppManagement API acceptance.
2. Freeze contracts against actual provider data; administrator/member identity; Web/Android
   login → store → install approval → Task → App Detail → stop/start → activity vertical slice.
3. CasaOS-managed Grafana, Portainer and Immich, with real metrics collection/history,
   user-authorized photos and files, health/error handling and advanced fallback.
4. High-fidelity shells following all six concept images; shared design tokens; 16 actual
   native components; same Incident spec in Web workspace and Android summary/sheet layouts.
5. Core/domain-agent execution, ownership-filtered events/results, memory, internal + Brave
   search, once/daily/weekly schedules and notification/approval center.
6. CasaOS-installed Gitea → discovered OpenAPI → six generated read-only capabilities →
   sandbox verification → approval → persistent registry → native generated UI.
7. Six-scene continuous demonstration, at least four real E2E paths, migration/recovery,
   visual inspection, reproducible release artifacts and acceptance A–G, then Demo Freeze.

User choices: high-fidelity concept visuals; administrator + family members; independent real
Immich demonstration library; existing open-source app for Integration Agent; commercial Web
Search API (Brave selected in accepted plan). Private data is not shared by default. Historical
unowned M2 data must be explicitly claimed by an administrator with prior valid device identity,
not assigned to the first public registration. Legacy APIs must not bypass user isolation.

### CasaOS bootstrap evidence

`deploy/m3/casaos-host.mjs prepare` passed host preflight and prepared checksum-verified
installer scripts in `.local/m3-casaos`. Host: Ubuntu 20.04 amd64, Docker 26.1.2,
minimum API 1.24, no CasaOS or existing rclone. The upstream installer attempts to overwrite a
Docker service override and restart Docker; the reviewed adaptation skips that unnecessary
call and uses a unique temporary extraction directory. Root-owned pre-install configuration
backup and existing-container checks are part of the install entrypoint.

**Native installation has not run:** `sudo -n true` reports that a password is required.
User terminal action is documented in `deploy/m3/README.md`. No Docker privilege workaround
was attempted. The installer archives still require digest locking before final release.
No real CasaOS API or M3 end-to-end acceptance can yet be claimed.

User-authorized APT bypass is now implemented as `prepare/install --without-apt`.
It uses an isolated dependency planning status copy, downloads 12 additional packages with
repository SHA-256 verification, pins Samba to the already installed library version, and
installs only those archives through dpkg. No package upgrades/removals, NVIDIA packages or
force-depends are allowed. Host APT remains broken; only its unrelated conflict is excluded
from the temporary solver input. Prepared successfully; five bootstrap checks/tests and bash
syntax validation pass. User subsequently completed root installation successfully.

### Native CasaOS installed and authenticated

All six CasaOS services are active; version reported by installation is 0.4.15. Existing
Jarvis readiness remains healthy. User initialized their CasaOS account. Login and protected
LAN API requests verified successfully; tokens are stored in git-ignored private configuration
with directory/file permissions 0700/0600, and the password is not persisted.

`packages/integration-casaos/src/index.ts` now supplies the server-side API transport, localized
store metadata, installed/update reads, details/logs/Compose reads and lifecycle methods.
Provider failures are classified without echoing secrets; redirects are refused and response
size/time are bounded. The real store contains nullable descriptions, now handled explicitly.

`npx tsx tests/check-casaos-live.ts` passed against the real authenticated LAN gateway:
177 store applications including all four demo targets, zero installed apps, zero updates,
Gitea Compose retrieval, and unauthenticated LAN requests rejected with 401. Typecheck passed.
Lifecycle writes, token refresh, registry, ownership/approval routing and UI remain pending;
transport methods are not yet exposed as authorized client actions. Earlier bootstrap blockers
above are historical and no longer describe the current CasaOS service state.

## Web visual correction — incomplete, not a visual acceptance

The initial M3 screenshots did not match concept 05: oversized hero, vertical gauges,
geometric placeholder covers, and absent installed-application launcher. Functional
browser checks did not prove visual fidelity. Item 3 remains open.

The current revision compacts the desktop command area, displays six space entries,
groups semantic summary metrics horizontally, removes crowded gauge tick labels,
and keeps object-valued summaries full-width. It also fixes vertically centered short
pages. Web typecheck/build and the browser navigation/command/semantic-view test,
including direct `/system` reload and narrow-screen overflow, pass locally.

Evidence: `.local/evidence/m3-web-home.png` and `m3-web-workspace.png`.
These are isolated-test screenshots, not a production deployment or full visual
acceptance. Real cover artwork, actual app launcher data, richer workspace composition,
and full Web/Android visual parity remain unfinished. Grafana/Portainer installation
remains deferred by the user.

## 2026-09-10 — artwork and read-only application surface

Replaced CSS geometric cover placeholders with generated decorative PNG artwork in
`apps/web/public/artwork/`; exact prompts and built-in generation provenance are in
`PROVENANCE.md` there. These are not user photo assets. Static image routes use an
explicit filename allowlist. Browser checks verify all six images load successfully.

Added authenticated `application.list` through the existing paired-device gateway,
configured explicitly with `CASAOS_SESSION_FILE` pointing to a private 0600 session
file. The read-only bridge exposes only normalized application IDs, names, provider
and conservative states, never raw Compose/environment/credentials. Home and Apps
now consume it and distinguish unconfigured, expired-auth, unavailable and empty
states. It is a paired-owner interim bridge, not completed multiuser authorization.

Typechecks, Web build, normalizer secret-exclusion test and browser regression pass.
Live read currently returns `authentication_required`: saved CasaOS credentials are
no longer accepted. Real installed-list rendering is therefore not yet verified;
do not treat the two known installations as proof of current API state. No lifecycle
writes, deployment, or full item-3 acceptance has been performed.

### Live application UI verification

Reauthenticated with the user-provided account without persisting its password.
The live browser test then exposed an expired access token. Added one bounded
refresh-and-retry using CasaOS `/v1/users/refresh`, private atomic session replacement,
and same-process concurrent-refresh deduplication. Verified the actual refresh response
shape against the installed service (tokens are directly in `data`).

The browser test with `M3_LIVE_CASAOS=1` now verifies Home Assistant and Immich both
show `运行中` on Home, verifies two installed apps on Apps, reloads Apps, and returns
to Home. Passed against real CasaOS with an isolated Jarvis test database. Screenshot:
`.local/evidence/m3-web-live-applications.png`. Earlier authentication blocker is resolved.
Production deployment, application detail/actions, actual brand icons and complete
third-item visual acceptance remain pending.

Application cards now open an accessible native dialog with provider description,
current state and service count, all normalized from the installed Compose metadata.
Provider descriptions are collapsed by default to avoid a wall of text. No raw service
configuration is exposed. Live browser verification passed for Immich detail opening,
state/count display, Escape dismissal and focus restoration; screenshot recorded at
`.local/evidence/m3-web-live-app-detail.png` (before collapsing the description).
Typechecks, Web build and the secret-exclusion normalizer test also passed. This is
read-only detail, not the full application management experience or production rollout.

### Android application surface

Android now requests `application.list` on repository refresh and on entering Apps,
shows the same normalized applications on Home and Apps, and provides native bottom-sheet
detail (state, service count, ID and expandable provider description). Missing connection,
expired authentication and an actually empty list have distinct states. Manual refresh is
available; failed requests do not reuse old application state as if it were live.

Offline debug APK and Android test APK builds passed. Direct emulator instrumentation
`cloud.jarvis.app.ProductApplicationsTest` passed both component tests: native detail
open/expand/close/refresh and expired-auth distinction. These tests use explicit fixtures;
Android-to-live-CasaOS end-to-end verification and visual screenshot comparison remain
pending. The updated APK was installed only on the test emulator, not a user's phone.

Android live E2E is now verified by `tests/run-android-m3-applications.ts`: fresh
emulator pairing to an isolated Jarvis database, real CasaOS Home Assistant/Immich
reads, Immich detail with four services, activity recreation and refreshed list.
Instrumentation passed (1 test); screenshot inspected at
`.local/evidence/m3-android-live-app-detail.png`. The runner refuses physical-device
serials before clearing test app state. Screenshot review identified remaining default
gray surfaces and low-contrast status-bar icons; visual acceptance remains open.

### Dynamic resource updates

Fixed stale embedded v2 section data: the composer now includes optional source path
and source revision, and both renderers bind newer resource snapshots from their
existing live-resource stores. Older resources do not replace the embedded snapshot;
unknown-component fallbacks remain unbound because their source is removed by negotiation.
Web typecheck/build, five protocol tests and Android debug/test APK builds passed.
Android `DynamicV2Test` includes a targeted newer-resource binding assertion (12 -> 78),
alongside existing version fallback and native action-sheet checks. Full streaming/reconnect
acceptance, refreshed visual screenshots and production deployment remain outstanding.

Follow-up: Android live application E2E passed again with the navy surface tokens;
the refreshed detail screenshot confirms panel colors changed from default gray.
System-bar contrast in the modal screenshot still needs attention. Web view loading
now clears the previous semantic view and uses a request generation guard, preventing
an older async view request from overwriting a subsequently selected view. Web typecheck
and production asset build passed; targeted navigation race testing remains pending.

Added `ui-resource-binding.test.ts` and extracted Web resource binding into a tested
protocol helper. Five passing cases cover newer revisions without snapshot mutation,
older/equal/unrelated resource rejection, missing-field clearing with zero/false retained,
own-property-only path reads, and inert negotiated fallbacks. Both TypeScript checks pass.
This verifies the binding algorithm, not end-to-end websocket/reconnect behavior.

Android v2 persistence wiring added: negotiated semantic views are cached alongside
legacy views, the repository restore dispatcher now accepts the semantic cache key,
and loading a legacy view clears the semantic cache. A view request generation guards
against older network results replacing a newer selection. Debug compilation passed;
process-death restoration and concurrent-request behavior still require targeted tests.

Two emulator instrumentation repository tests now pass for compatible v2 snapshot
restore/null clearing and incompatible-version fallback preserving the v1 view. Added
defensive cached protocol/section type checks. These are direct repository restore tests
with an in-memory DAO, not proof of full OS process-death/Room persistence recovery.

Web navigation now uses controlled outline icons and accessible current-page state;
task details keep Tasks selected. Live CasaOS browser regression passed after this
change. Screenshot review found the return-to-Home capture preceded metric loading;
added an explicit metric-ready assertion before capture. Moved the application region
before task/activity panels to follow the desktop concept hierarchy more closely.

Updated the existing Web M2 end-to-end navigation to the new System/Tasks entries
without dropping its behavioral assertions. Passed pairing, shared conversations,
reload/reconnect, task input, cancellation and retained artifacts under the new shell.
Preserved `code_diff` as a dedicated negotiated v2 component on Web/Android instead
of degrading it into a generic log, retaining native added/deleted-line rendering.

Web Tasks now groups real runs into user-attention, active and terminal states, with
counts and goal search. Unknown statuses remain explicitly unconfirmed, not completed.
Existing task input/cancel/history regression passed with a new search assertion;
the captured task-page screenshot is `.local/evidence/m3-web-tasks.png`. This improves
the task surface but does not implement the separate M3 Task domain or approval model.

Android photo/file space cards now reuse the generated decorative covers already
documented in Web artwork provenance, packaged locally under drawable-nodpi. The
mobile presentation remains two columns with a readable bottom gradient. Debug/test
builds and real-CasaOS Android application E2E passed again, including visible cover
caption assertion and a Home capture: `.local/evidence/m3-android-live-home.png`.
The covers are not user photos; space resource navigation/content remains incomplete.

Android Tasks now has horizontally scrollable state filter chips, counts and goal
search, using the same active/waiting/terminal meanings as Web and keeping unknown
statuses unconfirmed. Debug/test APK builds passed; the emulator component test covers
filtering, search and preservation of the selected task ID when opening details.

Android M2 control regression updated for Tasks navigation and v2 action bottom sheets,
retaining the original conversation streaming, recreation, input acknowledgement and
cancellation-result assertions. Direct emulator instrumentation against an isolated
Jarvis database passed (1 test, 7.067 seconds). This proves the retained control path
under the new shell; it does not cover M3 multiuser Task/Approval semantics.

Home Assistant and Immich now use the installed provider's official SVG icons in Web,
served from a fixed local allowlist with restrictive SVG response headers. Android
uses VectorDrawable resources preserving the same SVG path data; no remote-image
dependency is added. Provenance is recorded in `apps/web/public/app-icons/PROVENANCE.md`.
Typechecks, Web build and Android debug build passed. Live Web browser checks also
passed with explicit icon visibility and successful decoding assertions. Android icon
visual inspection remains pending; arbitrary app icons still fall back to initials.

Web now offers persisted dark/light appearance selection. Light mode covers shell,
cards, forms, task/application state surfaces, conversation and detail dialog while
keeping photographic covers dark for label contrast. Live browser regression verifies
switching and reload persistence, with `.local/evidence/m3-web-home-light.png` inspected.
Chart instances now react to theme changes and use contrasting gauge labels. Full
cross-page light-theme visual acceptance remains pending.

Android now exposes a persisted dark/light preference and updates system-bar icon
style with it. The dark photographic/gradient hero keeps explicit light text in both
themes. Debug and instrumentation APK builds pass. The expanded live test includes
theme switching and activity recreation, but its first invocation could not run because
the previous test emulator was no longer present; a fresh emulator session was started.
Do not treat this as a passed Android appearance-persistence test yet.

After verified emulator boot, the expanded live test passed (1 test, 4.511 seconds),
including light-theme preference surviving activity recreation, switching back to dark,
real installed applications and detail checks. Full light-theme screenshot acceptance
and process-death persistence remain separate unverified checks.

Fixed v1-to-v2 action parameter loss: composer preserves permitted action payload
fields, including `approved:false` and input text. Web prevents payload fields from
overriding capability/target; Android copies only legacy-approved text/approved fields.
A dedicated composer regression passes, as do both typechecks, Web build and Android
debug build. This does not prove or enable the pending M3 approval authorization model.

Web space cards now open individual integration-status explanations instead of sending
five different cards to the same generic placeholder. Photo/family dialogs link to the
application center; knowledge links to Jarvis. These are explicit unfinished-space
states, not implemented space content. Decorative photos are identified as such.
Web typecheck/build and the live-CasaOS Playwright shell test passed, including dialog
Escape/focus return and application navigation. Inspected the updated home screenshot;
this is not full concept-image visual acceptance and is not deployed to production.

Dynamic UI v2 log sections now have dedicated Web/Compose renderers rather than a
Markdown alias. Supported snapshot data is a string or `{text:string}`; filtering,
line numbers, explicit empty/malformed states and latest 1000-line/200000-character
bounds are implemented. ANSI color sequences are stripped and markup is plain text.
Web typecheck/build and 2 snapshot unit tests passed. Android APKs built and all 4
DynamicV2Test instrumentation cases passed on emulator-5554, including log filtering
and literal markup. Real backend log subscription/composition and Web log screenshot
acceptance are still pending; this does not complete the M3 logging workflow.

Task resource snapshots now include an event_log derived from actual persisted event
timestamps/IDs/types (last 1000 events). The semantic task workspace binds a dedicated
log section to this field, including subsequent resource revisions. Payloads/tool
arguments/output are deliberately excluded; this is an event log, not container stdout.
Full TypeScript checking, 4 log/action unit tests and the Web M2 interaction regression
passed. Also corrected missing NodeNext import extensions in the previous log test.
End-to-end assertions specifically covering the visible event log, screenshot acceptance,
and container log integration remain pending. Production deployment is unchanged.

Expanded Web task regression now asserts the visible event log, unmatched filtering,
completion-event updates and timestamp rendering. Screenshot inspection caught the
incorrect created_at event field; corrected it to the database timestamp column.
Task status now binds a presentation summary rather than rendering internal database
columns. Typecheck, event-log unit test and expanded browser regression passed.
Evidence: .local/evidence/m3-web-task-workspace.png. Remaining visual problems include
the long inspector/actions, timestamp formatting and empty result panels; not accepted
as final concept fidelity. No production deployment was performed.

Semantic task composition now omits input/cancel/resume controls for explicit terminal
statuses and omits an empty diff only after termination; real diffs remain visible.
Web run events recompose the view, and Android refresh requests updated task composition.
Web end-to-end assertions verify obsolete controls and empty diff disappear after task
completion. Two composition tests cover all terminal statuses and preserved diffs.
Both TypeScript checks, Web build and Android debug build passed. Android terminal-state
interaction has not yet been instrumented, and this is presentation gating, not a new
authorization boundary. Production remains unchanged.

Android task refresh now derives its task source from the persisted semantic view,
not the transient runId field, and retains the current semantic screen during refresh
instead of flashing legacy content. Expanded M2 instrumentation passed on emulator-5554
(1 test, 7.803s), including input completion, disappearance of obsolete controls,
activity recreation and cancellation. APK builds passed. Dedicated emulator app state
was cleared for pairing; host applications and production Jarvis were not changed.

Added native semantic list renderers on Web and Android with bounded typed rows,
title/description/status, explicit empty/malformed states and scroll containment.
Task artifacts now use this component via presentation.artifacts rather than a narrow
raw database table. Artifact content and arbitrary links/actions are not rendered.
Web typecheck/build, full TypeScript check, list validation test and Android debug
build passed. List-specific browser/Android instrumentation and visual acceptance
remain pending. Production unchanged.

List verification: expanded Web regression passed with real persisted task artifacts
rendered as list rows, and 5 Android DynamicV2 instrumentation tests passed including
valid metadata, malformed data fallback and ignored executable fields. Inspected updated
task-workspace screenshot: artifact panel is compact; timeline was still overlong.
Added bounded Web timeline scrolling and localized display timestamps (original UTC in
title). Web typecheck/build passed after this adjustment; the final timeline adjustment
has not yet been screenshot-verified. No production deployment.

Added dedicated Web/Compose task components displaying goal, explicit status, actor and
localized timestamps. Task composition places this in the summary region; internal
fields are not displayed and unknown states are not classified as success. Typechecks,
task schema unit test, both builds and Web task interaction regression passed. Inspected
the new screenshot and corrected missing full-width summary placement; that final width
fix needs screenshot rerun. Android task-specific instrumentation remains pending.

Task card follow-up verification completed: Web regression explicitly measures full
summary width and passes; inspected updated m3-web-task-workspace.png and confirmed
the narrow-card defect is gone. Six Android DynamicV2 instrumentation cases passed
(5.518s), including unknown task status, invalid time fallback and hidden internal data.
This verifies these component behaviors, not overall M3/concept-image completion.

Web workspace now offers activity/inspector visibility toggles, a bounded desktop
side-panel width slider and layout reset. Hidden panels remain mounted to preserve
local form state; mobile hides the desktop-only width control. Expanded Web task
regression verifies hiding/restoring both panels while preserving task behavior and
full-width summary placement. Typecheck/build and browser regression passed. Slider
keyboard/geometry checks, layout persistence and full split-pane visual acceptance
remain pending; these controls do not complete the full Workspace requirement.

Workspace panel preferences now persist locally (only widths/visibility, no task data).
Malformed/out-of-range stored values recover to defaults; unavailable browser storage
does not prevent rendering. Unit test, both TypeScript checks and Web build passed.
Expanded browser regression verifies keyboard slider adjustment changes measured pane
width, survives reload, and resets to defaults. Full draggable Split Pane interaction
and broader responsive/visual acceptance are still unfinished.

Desktop workspace now has pointer-captured draggable vertical separators, keyboard
arrows/Home/End, double-click reset, bounded 18–30% shared side widths, and narrow-screen
separator hiding. Expanded browser regression verifies actual pointer dragging, keyboard
minimum and responsive hiding alongside persistence/control regressions. Web typecheck,
build and browser test passed. Side widths remain symmetric; independent left/right
widths and overall concept fidelity are not claimed. Production unchanged.

Full server/unit suite was run against a fresh isolated PostgreSQL database: all 35
tests passed, none skipped (including M1 migration and authenticated M2 integration).
Found and fixed multi-action sections only rendering their first operation: Web and
Compose now render each declared action separately using its label and original
capability/target. Web additionally rejects unsupported component versions before any
action rendering. Focused multi-action interaction tests remain pending; no new server
permissions were granted and this is not M3 approval authorization completion.

Multi-action interaction verification now passes: 7 Android DynamicV2 cases (6.906s)
and a dedicated browser renderer test assert distinct action targets and approved:false.
Browser test also asserts unsupported component versions expose no action button.
Initial browser harness incorrectly ran after Vite fallback and timed out; registering
test middleware before fallback corrected the harness, and rerun passed (661ms).
This tests presentation callbacks, not real approval execution/authorization.

Dangerous semantic actions now show explicit risk styling/text and require a native
confirmation dialog on both clients. Cancel leaves the callback untouched; confirm
dispatches the original payload. Confirmation identifies the target and explicitly
does not replace server authorization/approval. Web build/typecheck and browser risk
interaction test passed; Android builds and 8 DynamicV2 instrumentation tests passed
(7.345s), including cancel/confirm behavior. No real dangerous action was executed.

Android now displays all six space covers using the existing generated Web artwork
(four additional local drawable copies). Removed the spaces route's no-op click handler:
space sheets explain actual missing capabilities, photos/family link to Apps, knowledge
to Jarvis, development to Tasks. Decorative imagery is explicitly not user photos.
Debug/test builds and SpaceTiles instrumentation passed (1 test, 2.152s). Space data
services remain unfinished; this completes neither gallery integration nor full M3.

Web semantic sections now have individual render error boundaries. A malformed known
component shows its fallback without removing sibling panels; newer view/resource
revisions retry rendering. Dedicated browser test injects an invalid timeline row,
verifies sibling content survives, then verifies recovery with corrected data. Both
renderer tests, TypeScript checks and Web build passed. React's expected development
error log appears during this injection. Android malformed-known-component parity and
async/chart/event-handler errors are outside this boundary and remain to be addressed.

Android removed unsafe casts for view/block envelopes, malformed timeline/run-graph
rows and nested chart metrics. Invalid structured rows show panel-local incompatibility;
non-finite or malformed chart values remain missing rather than entering Canvas math.
Debug/test builds and 9 DynamicV2 instrumentation tests passed (7.999s), including a
malformed timeline and nested chart surviving alongside valid content, then recovering
after corrected data. This is targeted hardening, not proof against all malformed data.

Dedicated Web/Compose timeline components now display localized event time, title and
optional human-readable description rather than raw payload JSON. Lists are bounded to
200 latest events with an explicit truncation notice; Android uses a bounded lazy list.
Malformed input uses section fallback. Web build/typecheck and 2 renderer tests passed;
Android debug/test builds and 9 instrumentation cases passed (8.116s). Updated timeline
screenshots and long-history scrolling acceptance remain pending. The browser malformed
timeline test now exercises validation fallback, not an actual error-boundary exception.

Long timeline verification passed: Web tests now load real product CSS and assert
bounded scroll height, 250-to-200 truncation notice, last-event reachability and detail
expansion without raw payload fields. Corrected the test's non-JSON undefined fixture.
Android 10 DynamicV2 tests passed (11.11s), including scrolling the lazy list to event
249. Web timeline scroll container is now keyboard-focusable. Overall screenshots and
cross-device visual acceptance remain unfinished; no production deployment.

Rebuilt Web and reran the complete task interaction browser regression successfully;
inspected the fresh task-workspace screenshot and confirmed compact localized timeline,
task summary, artifacts and split controls. Android navigation now uses matching native
vector paths from the Web outline icon set instead of text glyphs; task detail routes
keep Tasks selected. Android debug build passed. Updated Android navigation screenshot
and live interaction verification remain pending; no production deployment.

Started missing Gallery delivery: shared gallery data contract requires bounded items,
unique IDs and gateway-relative thumbnail paths (no external URLs, query tokens or
traversal). Web gallery/photo_grid now provides image tiles, unavailable-image state,
native detail dialog and Escape/focus return. Typechecks/build, media-path unit test
and 4 renderer browser tests passed. Gateway /api/media endpoints, successful real-image
loading and Android gallery remain unimplemented; this is not a real photo integration.

Android Gallery/photo_grid now renders a native two-column lazy grid and metadata
sheet using the shared item shape. Gateway thumbnail loader permits only scoped media
paths, attaches device authentication, rejects redirects, bounds downloads to 2MB and
allows JPEG/PNG/WebP only. Bitmap decoding is off-main-thread with dimension limits and
sampling; failures are explicit and cancellation propagates. Builds and GalleryViewTest
passed (1 test, 1.685s). Actual server media endpoint, successful image decode/network
tests, captured-time detail parity and real provider integration remain pending.

Added authenticated /api/media/:id/thumbnail serving server-published device-scoped
ephemeral thumbnails (5-minute TTL, bounded in-memory capacity, 2MB/image). Other devices
receive 404, unauthenticated access 401; responses use private/no-store and nosniff.
No provider credentials or global Immich session are read by this endpoint. Typecheck
and 2 media tests with isolated PostgreSQL passed. Tests verify access/headers/bytes,
not successful image decoding. This temporary transport has no provider publisher yet;
restart/expiry requires regenerated references, and user-level media ownership remains
part of the pending multiuser integration work.
