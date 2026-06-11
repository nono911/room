# Refactor Plan (Phase 2): ปรับสู่ Feature-based Architecture

> สถานะ: **เริ่ม execute แล้วบางส่วน** · ปรับปรุงล่าสุด: 2026-06-11 (rev.4 — sync กับ working tree + scrutinize รอบ 2)
> ต่อยอดจาก `docs/refactor-app-tsx-plan.md` (เฟส 0–5 ทำเสร็จแล้ว: แตก screens เป็น component, ย้าย types/markdown/api client)
> เป้าหมาย: ไม่ใช่แค่ลด `App.tsx` ให้สั้น แต่ปรับ **สถาปัตยกรรมทั้งแอป** ให้เติม feature ใหม่ได้โดยไม่บวมกลับมา — โดยคุมความเสี่ยงเป็นชั้นๆ และ behavior-preserving

---

## 0. สถานะที่ทำไปแล้ว (Current implemented state — ตรวจจาก working tree)

มีการเริ่มลงมือแล้ว ก่อนทำต่อให้เช็คของจริงเสมอ:

| รายการ | สถานะ | หลักฐาน |
|--------|-------|---------|
| Screen components แตกแล้ว | ✅ done | `renderer/src/components/screens/*` |
| Test infra (vitest + setup + jsdom mock) | ✅ done | `vitest.setup.ts`, `vite.config.ts` |
| Test: welcome→open→สลับทุก tab + verify IPC | ✅ done | `App.test.tsx:6` |
| Test: **runTask** streaming events | ✅ done | `App.test.tsx:160` |
| **saveSkill(source) bug** | ✅ **fixed แล้ว** | `main.ts:1533` ใช้ `source === 'roles' ? 'roles' : 'skills'` |
| `shared/ipc/contract.ts` | ⚠️ มีแล้วแต่ **ยัง impure** | สร้างที่ `packages/desktop/shared/ipc/contract.ts` แต่ `import type ... from '../../renderer/src/types/domain.js'` (contract.ts:9) → ยังลาก dependency กลับ renderer |
| Test: **runDiscussion** streaming | ❌ ยังไม่มี | มีแต่ runTask |
| Phase B–G (feature slices, main split) | ❌ ยังไม่เริ่ม | – |

> **หมายเหตุตำแหน่ง:** implementer วาง contract ที่ `packages/desktop/shared/` (top-level ใต้ desktop) ซึ่ง **ดีกว่า** ที่แผน rev.3 เสนอ (`renderer/src/shared/`) เพราะเป็น neutral boundary นอกทั้ง main/renderer จริง — ใช้ตำแหน่งนี้ต่อ แต่ต้องแก้ให้ pure (ดู 2.5)

---

## 1. ทำไม `App.tsx` ยังใหญ่ (วิเคราะห์จากของจริง)

| ก้อน | บรรทัด (โดยประมาณ) | ลักษณะ |
|------|------|--------|
| Static data ก่อน `function App()` | 44–573 (~530) | `roleTemplateSkills` (~400), `PROVIDER_PRESETS`, `taskTypeOptions`, `teamPresets`, `agentPersonaTemplates` — **ข้อมูลล้วน ไม่มี logic** |
| ตัว `function App()` | 574–3274 (~2,700) | `useState` 103 ตัว, handler 24 ตัว, `useEffect` 10 ตัว, JSX shell (sidebar + routing + context picker) |

สาเหตุที่ใหญ่: เฟส 1–5 ทำ **pure extraction** คือย้าย JSX (presentational) ออก แต่ **เก็บ state ทั้งหมดไว้ที่ App แล้วส่ง props** screen เลยบาง แต่ container กองอยู่ที่เดียว — เป็น trade-off ที่ตั้งใจเพื่อความปลอดภัย ตอนนี้ถึงจังหวะเก็บความสะอาดต่อ

---

## 2. สถาปัตยกรรมเป้าหมาย (Target Architecture)

> เหตุผล: เฟส 0–5 และการ "ย้าย state" เป็นการเก็บกวาดของเดิม แต่ไม่ได้กันการบวมรอบใหม่ โครงสร้างปัจจุบันเป็น **layer-based** (แยกตามชนิดไฟล์) ทำให้ feature เดียวกระจายหลายโฟลเดอร์ และคนเติม feature ใหม่มักโยน state ขึ้น App → บวมกลับ
> อาการบวมเกิดทั้ง 3 ชั้นแล้ว: `main/main.ts` 76KB รวม 32 IPC handler, screen ที่เพิ่งแตกบางตัวก็ใหญ่ตั้งแต่เกิด (`AgentEditorScreen` 35KB, `TaskRunScreen` 30KB)

### 2.1 ภาพรวม 3 ชั้น + ทิศทาง dependency ทางเดียว

```text
┌─────────────────────────────────────────────┐
│  RENDERER (UI)   features/* vertical slices   │  React, ไม่มี business logic
└───────────────────────┬───────────────────────┘
                        │ เรียกผ่าน IPC contract (typed)
┌───────────────────────▼───────────────────────┐
│  MAIN (Electron)  ipc/* adapters thin layer    │  แปลง IPC → เรียก engine
└───────────────────────┬───────────────────────┘
                        │ import ตรง
┌───────────────────────▼───────────────────────┐
│  ENGINE (core/domain)  UI-agnostic, มี test    │  ตรรกะธุรกิจทั้งหมดอยู่ที่นี่
└─────────────────────────────────────────────┘

กฎเหล็ก: renderer → (IPC contract) → main → engine → ไม่ขึ้นกับใคร
engine ห้าม import จาก main/renderer เด็ดขาด
```

หลักการเดียวที่สำคัญสุด: **business logic ดันลง engine, renderer บางที่สุด (แสดงผล + UI state), main เป็นตัวเชื่อมบางๆ**

### 2.2 ชั้น Engine (core) — ขยายของเดิม
จัดดีอยู่แล้ว (`providers/`, `discussion/`, `decisions/`, `events/` + มี test) คงทิศทาง: logic ที่ไม่ใช่ UI อยู่ที่นี่ ใช้ซ้ำทั้ง CLI/desktop เติม feature ที่มี logic → เริ่มที่ engine

### 2.3 ชั้น Main — แตก `main.ts` เป็น adapter บางๆ
```text
packages/desktop/main/
  main.ts            // bootstrap window + ลงทะเบียน ipc เท่านั้น
  ipc/
    workspace.ts     // select/open/init/scan
    discussions.ts   // run-discussion, summarize, generate-tasks
    tasks.ts         // run-task, load-task-board
    agents.ts        // save/delete/preview agent, detect cli
    providers.ts     // load/save/test provider, detect models
    mcp.ts  files.ts
    register.ts      // typed ipcMain.handle helper
```
แต่ละ handler ต้องบางมาก: รับ args → เรียก engine → ส่งผลกลับ ไม่มี logic ของตัวเอง

### 2.4 ชั้น Renderer — feature-based vertical slice
```text
packages/desktop/
  shared/
    ipc/
      contract.ts          // ⭐ pure types เท่านั้น ห้าม import electron — เป็น boundary กลาง
  renderer/src/
    app/                     // shell บางๆ (เป้า ~200 บรรทัด)
      App.tsx                // providers + routing + layout
      routes.tsx
    features/
      discussions/
        components/          // DiscussionsScreen + sub-components
        useDiscussion.ts     // state + onDiscussionEvent listener + handler
        api.ts               // เรียกเฉพาะ IPC ของ discussion
        index.ts             // public surface ของ feature
      task-run/  ai-members/  providers/  mcp/  workspace/  settings/
    shared/
      components/            // Sidebar, ErrorBanner, ContextPanel
      lib/markdown/
      store/                 // cross-feature เท่านั้น: projectPath, activeTab
      ipc/
        client.ts            // typed client wrap window.electronAPI
      types/
```

### 2.5 IPC contract = สัญญากลางที่ share ทั้งสองฝั่ง
จุดที่พังบ่อยเวลาเติม feature คือ main/renderer ตกลง payload ไม่ตรง → มี type ของ channel ชุดเดียวเป็น **source of truth**

> ⚠️ **ตำแหน่ง + ความ pure ของ contract** (จาก review): contract ต้อง pure ไม่พึ่งทั้ง main และ renderer
> - ตำแหน่งจริงที่ใช้: `packages/desktop/shared/ipc/contract.ts` (neutral boundary นอก main/renderer — ดีแล้ว)
> - **ปัญหาปัจจุบัน:** `contract.ts:9` ยัง `import type ... from '../../renderer/src/types/domain.js'` = boundary ลาก dependency กลับเข้า renderer → **ยังไม่ pure จริง**
> - **แก้:** ย้าย domain types ที่ contract ใช้ (`WorkspaceFileEntry`, `ContextPickerItem`, `MaskedProvider`, `DetectedAgent`, `TaskBoardCard`, `DiscussionIpcEvent`, ...) ไป `packages/desktop/shared/types/` แล้วให้ **ทั้ง renderer และ main import จาก `shared/` เท่านั้น** (`renderer/src/types/domain.ts` re-export จาก shared เพื่อไม่ให้ของเดิมพัง)
> - **main** import `type` จาก contract (type-only, ไม่เกิด runtime coupling), เพิ่ม helper `register.ts` สำหรับ typed `ipcMain.handle`
> - **renderer** `shared/ipc/client.ts` ใช้ contract เดียวกัน
> - **`preload.js` ยังเป็น JS ไม่ถูก typecheck** — แปลงเป็น `preload.ts` (เข้า `tsconfig.main.json`) หรือ sync มือ + มี contract test ครอบ

### 2.6 กติกา 4 ข้อ (สำคัญกว่าโครงสร้าง)
1. **State ownership** — state อยู่ใน feature ที่ใช้; ขึ้น `shared/store` เฉพาะที่ข้าม feature จริง (`projectPath`, `activeTab`)
2. **เพิ่ม feature = เพิ่มโฟลเดอร์ ไม่แก้ไฟล์กลาง** — `App.tsx`/`main.ts` แทบไม่ต้องแตะ
3. **ไฟล์เกิน ~300–400 บรรทัด = สัญญาณให้แตก** sub-component
4. **public surface ผ่าน `index.ts`** — feature อื่น import ได้แค่ของที่ export

### 2.7 ขอบเขต (ไม่ over-engineer)
โปรเจกต์เป็น local-first desktop ไม่ใช่ enterprise — **ไม่ต้อง** Redux เต็มรูป / DI container / event bus ซับซ้อน แค่ 3 ชั้น + feature slice + IPC contract + กติกา 4 ข้อก็พอ และเอื้อ contributor (โฟลเดอร์ feature ชัด หาของเจอ)

---

## 3. หลักการ (เหมือนเดิม)

- Behavior-preserving, incremental, 1 เฟส = 1 commit
- verify ทุกเฟส: `rtk npm run typecheck -w packages/desktop && rtk npm run build:desktop && rtk npm test -w packages/desktop` (ใช้ prefix `rtk` ตาม AGENTS.md เมื่อรันผ่าน Codex)
- ห้ามผสมการเพิ่มฟีเจอร์ (toast / ปุ่ม Stop) เข้ามาในเฟส refactor
- **เสริม test ก่อนแตะ state ที่ใช้ร่วม/streaming** (ดูเฟส A)
- **เป้าปลายทางทุกการย้ายคือ `features/*`** ไม่ใช่ layer-based เดิม — ทำรอบเดียวจบ ไม่ย้ายซ้ำ

### แบ่งเป็น 3 track อิสระ (อย่าทำ target architecture ทั้งแอปในลูปเดียว)
> จาก scrutinize review: ตอนนี้มี runtime contract ที่ยังไม่ตรงกัน + state บางก้อนที่เคยคิดว่า single-screen จริงๆ ใช้ร่วมหลายหน้า → ลด scope เป็น 3 track ที่ลงได้ทีละอันโดยไม่ต้องรอกัน
> - **Track 0 (prerequisite, ทำก่อน):** แก้ behavior/contract bug ที่ของจริงเพี้ยนอยู่ (saveSkill) + เสริม streaming test — ดูเฟส A
> - **Track 1:** renderer feature extraction (เฟส B–E)
> - **Track 2:** IPC contract + main split (เฟส G) — ทำคู่ขนานกับ Track 1 ได้

---

## 4. การจัดกลุ่ม state/handler ตาม domain (อ้างอิง inventory จริง)

| Domain | state หลัก | handler | ใช้ที่ screen | ปลายทาง |
|--------|-----------|---------|--------------|---------|
| **Workspace** | projectPath, isRoomProject, projectData, recentProjects, newWorkspaceName, hasCompletedScan, scanStatus, scanStartedAt | handleOpenProject, handleCreateWorkspace, handleSelectRecentProject, handleInitProject, handleCloseProjectWorkspace | ทั้งแอป (shared) | `useWorkspace` (context/hook) |
| **Providers + CLI/model detection** ⚠️ shared | providers, providerKeyDrafts, providerTestResults, addProviderOpen, addProviderDraft, **detectedClis, dynamicCliModels** | handleSaveProviderKey, handleClearProviderKey, handleAddProvider, handleDeleteProvider, handleTestProvider | **Settings + AIMembers + AgentEditor** (App.tsx:2707/2747/2875) | `features/providers/` (owner) — AIMembers/AgentEditor/Settings **consume** ไม่ใช่ถือเอง |
| **Discussion** ⚠️ | selectedDiscussionAgents, discussion*(ReviewMode/MaxRounds/QualityGate/...), discussionMessages, activeDiscussionId, openRounds, expandedMsgKeys, taskBoardCards, lastDiscussion* | handleSendDiscussion | Discussions | `useDiscussion` (streaming + onDiscussionEvent) |
| **Task Run** ⚠️ | codingTask*(Input/Messages/DeveloperName/ReviewerNames/MaxCycles), taskRunType, taskRunView, lastCodingTaskResult, selectedCodingTaskContextRefs | handleRunCodingTask | Task Run | `useTaskRun` (streaming) |
| **Context Picker** | contextPickerTarget, contextPickerQuery, contextPickerTab, contextPickerItems, contextPickerLoading | – | Discussions/TaskRun | `useContextPicker` |
| **AI Members / Agent editor** | newAgent*(Name/Role/Provider/Command/Prompt/Skills/Preset/...), editingAgent, customSkill*, editingSkill*, skillPreview | handleRoleChange, handleSaveAgent, handleAddTeamPreset, handleDeleteAgent, handleAddCustomSkill, handleSaveEditingSkill, handlePreviewAgentSkills | AIMembers/AgentEditor | `features/ai-members/` — **consume** providers/detectedClis/dynamicCliModels จาก `features/providers` |
| **MCP** | mcpConfig, selectedMcpServer, mcpServerName/Command/Args/Env | handleSaveMcpServer, handleDeleteMcpServer, handleSelectMcpServer | McpServers | ย้าย state **เข้า screen** |
| **File/Doc/Task viewers** | workspaceFiles*, selectedWorkspaceFile*, selectedDecision*, selectedTask*, selectedReview*, contextOverviewDraft, contextStructureDraft | – | Files/Documents/TaskArchive/Context/Decisions | ย้าย state **เข้า screen** |
| **Onboarding** | showOnboardingTour, onboardingStep, dismissedOnboarding, onboardingSessionDismissed | – | shell | `useOnboarding` |
| **Settings/Theme** | contentTheme, contentFontFamily, contentFontSize, contentLineHeight, projectConfig | handleUpdateProjectConfig | Settings | `useSettings` |
| **UI shell** | activeTab, loading, errorMsg, showContextPanel, sidebarExpanded, showInspector, aiMembersSidebarExpanded, aiMemberDetailsExpanded | handleKeyDown | shell | คงไว้ที่ App |

**ข้อสังเกตสำคัญ:** state จำนวนมาก (state บางส่วนของ AI Members, MCP, viewers) ถูกใช้แค่ **screen เดียว** — พวกนี้ไม่ควรอยู่บน App ตั้งแต่แรก การย้าย "ลง" ไปอยู่ใน screen เป็น pure relocation ที่เสี่ยงต่ำกว่าและลด props drilling ทันที ส่วน state ที่ shared/streaming จริงๆ (Workspace/Providers/Discussion/TaskRun/ContextPicker) ค่อยยกขึ้น hook

> **ปลายทางตาม target architecture (ส่วนที่ 2):** ทุก hook/component/state/api ของ domain หนึ่งไปอยู่ใน `features/<domain>/` ไม่ใช่ `hooks/` หรือ `screens/` แยก layer — เช่น `useDiscussion` + DiscussionsScreen + api ของ discussion อยู่ใน `features/discussions/` รวมกัน; state ที่ "คงไว้ที่ App" จริงๆ มีแค่ UI shell ซึ่งย้ายไป `shared/store`

---

## 5. เฟสการทำงาน (เรียงตามผลตอบแทนต่อความเสี่ยง)

> ทุกเฟสมุ่งสู่ target architecture (ส่วนที่ 2): renderer = `app/` + `features/*` + `shared/`, main = `ipc/*`

### เฟส A — Track 0: เสริม remaining safety net (prerequisite)
> ส่วนนี้ทำไปแล้วบางส่วน (ดูส่วนที่ 0) — ที่เหลือคือ A.3 discussion path

**A.1 แก้ `saveSkill(source)` bug — ✅ DONE**
- แก้แล้วที่ `main.ts:1533` (`source === 'roles' ? 'roles' : 'skills'`)
- Remaining: เพิ่ม IPC contract test ยืนยัน `saveSkill(dir, name, content, 'roles')` เขียนลง `roles/` (ถ้ายังไม่มี)

**A.2 smoke + tab switching — ✅ DONE**
- `App.test.tsx:6` ครอบ welcome→open workspace→สลับทุก tab + verify IPC แล้ว
- Remaining: เช็คว่าไม่เหลือ act() warning (ถ้ามี ใช้ `await findBy/waitFor`)

**A.3 streaming/event test — ⚠️ ทำครึ่งเดียว (สำคัญสุด — กัน regression เฟส E)**
> ของจริง (ref แก้ให้ถูก): `api.onDiscussionEvent` subscribe ที่ **App.tsx:2021 = TASK path** (มี guard `if (!event.discussionId.startsWith('task-')) return;`) และ **App.tsx:2271 = DISCUSSION path**
- ✅ DONE: runTask streaming test (`App.test.tsx:160`)
- ❌ Remaining: **runDiscussion streaming test** — emit `agent_started` → `agent_chunk` → `message_completed` → (fail) `discussion_failed`, assert message/UI state + final replacement หลัง resolve + `unsubscribe` ถูกเรียกใน `finally`
- ❌ Remaining: **ทดสอบ discussion path ไม่กิน `task-*` event** — ⚠️ ตอนนี้ task path มี filter แต่ **discussion path (2271) ยังไม่มี guard** ว่า event ขึ้นต้น `task-` ควรเพิ่ม test ที่ fail ก่อน แล้วเติม guard (เป็น behavior fix เล็กๆ ใน Track 0)
- ✅ verify มาตรฐาน (rtk)

### เฟส B — Track 1: สร้างโครง `app/features/shared` + ย้าย static data (zero risk)
- วางโครงโฟลเดอร์เปล่าตามส่วนที่ 2.4: `app/`, `features/`, `shared/`
- ย้าย shared ที่มีอยู่แล้ว: `lib/markdown` → `shared/lib/markdown`, `components/layout` → `shared/components`, `types/` → `shared/types`, `lib/api.ts` → `shared/ipc/client.ts`
- **แก้ contract purity** (2.5): ย้าย domain types ไป `shared/types/`, ให้ `contract.ts` เลิก import จาก renderer
- ย้าย static data → `shared/data/` (หรือใน feature ที่ใช้): `roleTemplates.ts` (~400 บรรทัด), `providers.ts`, `taskTypes.ts`, `teamPresets.ts`
- เป็น cut/paste + แก้ import path ล้วน

### เฟส B.5 — Track 1: แยก `loadProjectData` hydration (pure extraction, ทำก่อน C)
> ⚠️ `loadProjectData` (App.tsx:1221) ไม่ได้โหลดแค่ project data แต่ set state ของหลาย feature ปนกัน (Context, Discussions, Task Run, Files, MCP, Settings, Task Board) ในก้อนเดียว — ถ้าย้าย MCP/files/providers เข้า feature ก่อนโดยไม่แยก hydration จะต้องส่ง setter ข้าม feature หรือ duplicate load
- แยกเป็นฟังก์ชันย่อย (ยังอยู่ใน App ก่อน, pure extraction ไม่เปลี่ยน behavior):
  - `loadWorkspaceCoreData` (projectData/overview/structure/decisions/docs/discussions list)
  - `loadWorkspaceFiles`
  - `loadMcpConfig`
  - `loadProjectConfig`
  - `selectDefaultAgents` (agent-default selection ของ discussion/task-run)
- พอแยกแล้ว เฟส C–E ค่อยย้ายแต่ละฟังก์ชันไปอยู่ใน feature/hook ที่เป็นเจ้าของ โดย App แค่เรียก `feature.load()` ตอนเปิด workspace
- ✅ verify มาตรฐาน (rtk)
- ผล: `App.tsx` 3,274 → ~2,750
- ✅ verify มาตรฐาน (rtk)

### เฟส C — Track 1: ย้าย domain เข้า `features/*` (low risk) — **owner ก่อน consumer**
> ทำทีละ feature ทีละ commit ตามลำดับ
1. **`features/mcp/`** ← McpServersScreen + mcpConfig/mcpServer* + handlers MCP (โดดเดี่ยวจริง ทำก่อน)
2. **`features/workspace-files/`** (viewers: Files/Documents/TaskArchive/Context/Decisions) ← selected*/draft* ของแต่ละหน้า
3. **`features/providers/`** ← providers/providerKeyDrafts/providerTestResults/addProvider* + **detectedClis/dynamicCliModels** + handlers — เป็น **owner** ของ provider/CLI state (⚠️ ต้องทำ **ก่อน** ai-members/settings เพราะ 3 หน้านี้ consume ก้อนเดียวกัน — App.tsx:2707/2747/2875)
4. **`features/ai-members/`** ← AIMembers + AgentEditor + newAgent*/editingAgent/customSkill*/skillPreview + handlers; **consume** provider state จาก `features/providers` ไม่ถือเอง (ถ้า screen > ~400 บรรทัด ให้แตก sub-component ตามกติกาข้อ 3)
- ✅ verify + คลิกหน้านั้นจริงทุก commit

### เฟส D — Track 1: shared/non-streaming domain + hook (medium risk)
- `features/settings/` (`useSettings`: theme + projectConfig — **consume** providers/detectedClis จาก `features/providers`), + `useOnboarding`, `useContextPicker` (ใช้ร่วม Discussions/TaskRun → วางใน `shared/`)
- แต่ละ hook ห่อ state + effect + handler ของ domain แล้ว return ให้ component ใน feature ใช้
- ✅ verify มาตรฐาน

### เฟส E — streaming/event features (highest risk — ทำท้ายสุด)
> `handleSendDiscussion`/`handleRunCodingTask` ผูก `onDiscussionEvent` listener + loading + messages + final-replacement state เสี่ยง stale closure
- `shared/store` ก่อน: cross-feature state (`projectPath`, `activeTab`, `errorMsg`, `loading`) — เป็นฐานให้ feature อื่นพึ่ง (`useWorkspace`)
- `features/discussions/useDiscussion.ts` — ยกชุด state + `onDiscussionEvent` subscribe/unsubscribe + handler พร้อมกัน, ใช้ `useRef` กัน stale closure ใน listener
- `features/task-run/useTaskRun.ts` — แบบเดียวกัน
- พิจารณา **Zustand** เฉพาะ 2 feature นี้ถ้า re-render จาก streaming หนัก (selector-based) — ตัดสินจากของจริง
- ผล: `App.tsx` → `app/App.tsx` เหลือ ~200–300 บรรทัด (providers + routing + layout)
- ✅ verify + smoke ด้วยตา (`rtk npm run dev:desktop`) เน้น Discussions/Task Run streaming

### เฟส G — Track 2: แตก IPC ฝั่ง main + contract กลาง (แยกอิสระ ทำคู่ขนาน Track 1 ได้)
> `main/main.ts` 76KB รวม 32 handler ในไฟล์เดียว — บวมแบบเดียวกับ App.tsx เวอร์ชันแรก
- แตกเป็น `main/ipc/{workspace,discussions,tasks,agents,providers,mcp,files}.ts` + `main/ipc/register.ts` (typed `ipcMain.handle` helper) ตามส่วนที่ 2.3
- **contract อยู่ที่ boundary กลาง** `packages/desktop/shared/ipc/contract.ts` = pure types ไม่มี electron import; main import แบบ `import type` จากที่นั่น (ไม่เกิด runtime coupling) — **ห้าม** วาง contract ใต้ `main/` (สวนทิศ dependency, renderer import ข้าม boundary ไม่ได้)
- **`preload.js`**: ตัดสินใจชัด — แปลงเป็น `preload.ts` (เข้า `tsconfig.main.json`) เพื่อให้ contract บังคับถึง preload ด้วย, หรือถ้าคงเป็น JS ต้อง sync มือ + มี contract test ครอบ
- handler เหลือบางๆ: รับ args → เรียก engine → ส่งกลับ
- ✅ verify: `rtk npm run build:desktop` (รัน tsc บน main) + `rtk npm run typecheck`

### เฟส F — Track 1: เก็บกวาดความสะอาดทั่วไป (optional, ต่อเนื่อง)
- ลด `any` ใน api/handlers (เช่น `saveAgent(agent: any)`) ให้เป็น type จาก `shared/types`
- ย้าย inline styles ที่ซ้ำบ่อย → CSS class ใน `index.css`
- รวม util ซ้ำ, ลบ dead code (noUnusedLocals ช่วยจับอยู่แล้ว)
> หมายเหตุ: `saveSkill(source)` ถูกยกไปแก้เป็น prerequisite ใน A.1 แล้ว (เป็น bug จริง ไม่ใช่ optional)

---

## 6. เป้าหมายผลลัพธ์

| จุด | ตอนนี้ | หลังเฟส B | หลังเฟส C | หลังเฟส D–E |
|-----|--------|-----------|-----------|-------------|
| `App.tsx` (บรรทัด) | ~3,274 | ~2,750 | ~1,800–2,000 | ~200–300 (`app/App.tsx`) |
| state บน App | 103 | 103 | ~50–60 | ~0 (ไป feature/shared store) |
| โครงสร้าง renderer | layer-based | + features/shared shell | feature ถือ state เอง | app shell + features/* |
| main process | main.ts 76KB | – | – | (เฟส G) ipc/* แยก domain |
| เติม feature ใหม่ | แก้ App.tsx | – | – | สร้างโฟลเดอร์ feature ใหม่ |

---

## 7. ความเสี่ยง & การลดความเสี่ยง

- **stale closure ใน event listener** (เฟส E) — ย้ายยกชุด state+effect+handler+cleanup พร้อมกัน, ใช้ `useRef` สำหรับค่าที่ listener อ่าน
- **prop/contract เพี้ยนตอนย้าย** — พึ่ง typecheck (strict) + IPC contract test เฟส A + IPC contract type เฟส G
- **circular import ระหว่าง features** — feature import กันผ่าน `index.ts` เท่านั้น; ของที่ใช้ร่วมไป `shared/` ห้าม feature import ข้ามตรงๆ
- **re-render บานปลายจาก Context** — แยก store ตาม feature, หรือ Zustand selector เฉพาะ streaming
- **ไม่มี git history ปกติ** — commit ย่อยถี่ๆ ต่อ feature/hook เพื่อ rollback ได้

---

## 8. Checklist
- [x] ~~saveSkill(source) bug~~ — ✅ fixed (main.ts:1533)
- [x] ~~tab navigation + IPC verify test~~ — ✅ App.test.tsx:6
- [x] ~~runTask streaming test~~ — ✅ App.test.tsx:160
- [ ] **เฟส A (Track 0)** — runDiscussion streaming test + เติม guard `task-*` ใน discussion path + contract test `saveSkill('roles')`
- [ ] **เฟส B (Track 1)** — วางโครง app/features/shared + ย้าย shared เดิม + **แก้ contract purity (ย้าย types ไป shared/types)** + static data
- [ ] **เฟส B.5 (Track 1)** — แยก loadProjectData → loadWorkspaceCoreData/loadWorkspaceFiles/loadMcpConfig/loadProjectConfig/selectDefaultAgents (pure extraction)
- [ ] **เฟส C (Track 1)** — features owner→consumer: mcp → workspace-files → **providers (owner)** → ai-members (consume)
- [ ] **เฟส D (Track 1)** — settings (consume providers) + onboarding + contextPicker
- [ ] **เฟส E (Track 1)** — streaming: shared store + workspace + discussions + task-run (+ Zustand ถ้าจำเป็น)
- [ ] **เฟส G (Track 2)** — main/ipc/* + contract กลางที่ shared/ipc + ตัดสินใจ preload.ts (ทำคู่ขนาน Track 1)
- [ ] **เฟส F (Track 1)** — (optional) ลด any, ย้าย styles, เก็บ dead code

---

## 9. บันทึกการ Review

### rev.4 — scrutinize รอบ 2 (sync กับ working tree)
- **สถานะ:** เพิ่มส่วนที่ 0 "Current implemented state" — saveSkill fix, test infra, tab/IPC test, runTask streaming test ทำแล้ว; contract.ts สร้างแล้วแต่ impure; runDiscussion streaming test ยังขาด
- **contract ยัง impure:** `shared/ipc/contract.ts:9` import type จาก renderer → แก้ 2.5 ให้ย้าย domain types ไป `shared/types/` แล้ว renderer/main import จาก shared (renderer re-export ของเดิม)
- **เพิ่มเฟส B.5:** แยก `loadProjectData` (App.tsx:1221) ที่ hydrate หลาย feature ปนกัน เป็น pure extraction ก่อนย้าย state เข้า feature (กันการส่ง setter ข้าม feature)
- **แก้ ref streaming ที่สลับกัน:** App.tsx:2021 = **task** (มี guard `task-`), 2271 = **discussion** (ยังไม่มี guard) → A.3 ระบุให้เพิ่ม runDiscussion test + เติม guard `task-*` ใน discussion path

### rev.3 — scrutinize รอบ 1
- **IPC contract location:** ห้ามวางใต้ `main/` → ใช้ neutral boundary `packages/desktop/shared/ipc/`
- **providers/detectedClis/dynamicCliModels เป็น shared:** ใช้ที่ AIMembers (2707), AgentEditor (2747), Settings (2875) → `features/providers` เป็น owner, เรียงเฟส C ให้ owner ก่อน consumer
- **saveSkill(source) เป็น bug จริง:** ยกขึ้น prerequisite (ตอนนี้แก้แล้ว)
- **Phase A ไม่พอสำหรับ streaming:** ระบุ test case (capture/emit/unsubscribe/filter)
- **verify command:** ใช้ `rtk npm run ...` ตาม AGENTS.md
- **Scope:** แบ่ง 3 track (Track 0 prerequisite, Track 1 renderer, Track 2 IPC/main)
