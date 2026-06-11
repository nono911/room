# Refactor Plan: `packages/desktop/renderer/src/App.tsx`

> สถานะ: ข้อเสนอ (ยังไม่เริ่มลงมือ) · ปรับปรุงล่าสุด: 2026-06-11 (rev.4 หลัง review รอบ 3)
> เป้าหมาย: แตกไฟล์ `App.tsx` ที่เป็น component ยักษ์ออกเป็นโครงสร้างแบบ modern, feature-based โดย **ไม่กระทบ behavior เดิม** และทำแบบ **safe / incremental**

---

## 1. สภาพปัจจุบัน (อ้างอิงจากโค้ดจริง)

- `App.tsx` = ฟังก์ชัน `App()` เดียว ~6,266 บรรทัด (บรรทัด 818–7084), ไฟล์รวม ~326KB
- ใช้ React hooks ~112 จุด (`useState/useEffect/useCallback/useMemo/useRef`) อยู่ในฟังก์ชันเดียว
- Render helpers ปนกันทั้งหมดในฟังก์ชันเดียว:
  - Markdown: `renderMathInline`, `renderMathBlock`, `renderMarkdownTable`, `renderGraphBlock`, `renderInlineMarkdown`, `renderMarkdownContent`
  - Context: `renderContextControl`, `renderContextPickerPanel`
  - Onboarding: `renderSetupChecklist`, `renderOnboardingTour`
  - ตัวยักษ์: `renderMainTab` (~3786–6700)
- `renderMainTab` แตกตาม `activeTab`: Discussions(3787), Task Run(4112), AI Members(4621), Agent editor(5004), + Documents / Tasks / Context / MCP Servers / Settings
- `window.electronAPI` ถูก type แบบ inline (`interface Window` 86–201), เรียก IPC 32 ตัว (handler อยู่ใน `packages/desktop/main/main.ts`)
- สไตล์เป็น inline ทั้งหมด แม้จะมี `renderer/src/styles/index.css` อยู่
- **ฝั่ง desktop ไม่มีเทสต์เลย** (engine มี Vitest ครบ) → จุดเสี่ยงหลักต่อความ "safe"

---

## 2. หลักการ Safe Refactor

1. **Behavior-preserving เท่านั้น** — แต่ละเฟสคือการ "ย้าย/แยก" โค้ด ไม่แก้ logic ไม่เปลี่ยน UI พฤติกรรมต้องเหมือนเดิมเป๊ะ
2. **เล็กและ shippable ทีละเฟส** — จบแต่ละเฟสต้อง `npm run build:desktop` ผ่าน + แอปรันได้ ก่อนไปต่อ (1 เฟส = 1 commit/PR)
3. **TypeScript เป็นตาข่ายนิรภัย** — strict เปิดอยู่แล้ว การย้ายโค้ดที่ type ครบจะจับ regression ส่วนใหญ่ตอน compile
4. **เพิ่ม safety net ก่อนแตะของหนัก** — เสริม smoke test ขั้นต่ำในเฟส 0
5. **Pure extraction มาก่อน optimize ทีหลัง** — ห้ามผสม refactor กับการเพิ่มฟีเจอร์/แก้บั๊กในเฟสเดียวกัน

---

## 3. โครงสร้างปลายทางที่เสนอ (feature-based + hooks)

```text
renderer/src/
  App.tsx                      // เหลือ ~150 บรรทัด: providers + layout + routing
  types/
    electronAPI.ts             // ย้าย interface Window/ElectronAPI ออกมา
    domain.ts                  // ProjectData, UIMessage, TaskBoardCard, ฯลฯ
  lib/
    api.ts                     // typed wrapper ครอบ window.electronAPI
    markdown/                  // ย้าย render markdown ทั้ง 6 ตัวมาเป็นโมดูล
      MarkdownContent.tsx
      mathBlock.tsx, table.tsx, graph.tsx ...
  store/                       // Zustand stores แยกตาม domain (ดูส่วนที่ 5)
    useWorkspaceStore.ts       // projectPath, projectData, recentProjects
    useDiscussionStore.ts      // discussionMessages (streaming), run state
    useTaskRunStore.ts         // codingTaskMessages (streaming), run state
    useProvidersStore.ts
  hooks/
    useProject.ts              // open/init/close/scan workspace
    useDiscussion.ts           // run/continue/summarize discussion
    useTaskRun.ts
    useProviders.ts
    useContextPicker.ts
    useOnboarding.ts
    useCommandPalette.ts
  components/
    layout/Sidebar.tsx, ContextPanel.tsx, ErrorBanner.tsx
    onboarding/OnboardingTour.tsx, SetupChecklist.tsx
    context/ContextPickerPanel.tsx, ContextControl.tsx
  screens/
    DiscussionsScreen.tsx
    TaskRunScreen.tsx
    AIMembersScreen.tsx
    AgentEditorScreen.tsx
    DocumentsScreen.tsx
    TaskArchiveScreen.tsx
    ContextScreen.tsx
    McpServersScreen.tsx
    SettingsScreen.tsx
```

---

## 4. เฟสการทำงาน (เรียงตามลำดับ ทำทีละเฟส)

### เฟส 0 — ตั้งตาข่ายนิรภัย (ก่อนแตะโค้ด)

**0a. แก้ tsconfig path mapping ก่อน (Prerequisite — Blocker)**
> `vite.config.ts` มี alias `@` → `renderer/src` แล้ว แต่ `packages/desktop/tsconfig.json` ไม่มี `baseUrl`/`paths`
> `build:renderer` ใช้ `vite build` (esbuild) จึงไม่ type-check ตอน build — **แต่ editor (tsserver) และ vitest จะ resolve `@/` ไม่เจอ** ถ้าโครงสร้างใหม่ใช้ alias `@/`
> ต้องเพิ่ม path mapping ให้ตรงกับ vite ก่อนเริ่มสร้างโมดูลใหม่:
```jsonc
// packages/desktop/tsconfig.json -> compilerOptions
"baseUrl": ".",
"paths": {
  "@/*": ["./renderer/src/*"]
}
```

**0b. ติดตั้งชุดเทสต์ + เพิ่ม typecheck script (ระบุชัดเจน)**
> `build:desktop` = `vite build` (renderer, ไม่ type-check) + `tsc` (main เท่านั้น) → **renderer ไม่ถูก type-check ตอน build** ดังนั้น "TS เป็น safety net" จะเป็นจริงก็ต่อเมื่อเพิ่ม typecheck แยก
```bash
npm i -D -w packages/desktop vitest @testing-library/react @testing-library/jest-dom jsdom
```
- เพิ่ม script ใน `packages/desktop/package.json`:
  - `"typecheck": "tsc -p tsconfig.json --noEmit"`  (type-check renderer)
  - `"test": "vitest run"`
- เพิ่ม `test` config ใน `vite.config.ts` (หรือ `vitest.config.ts`):
  ```ts
  // ⚠️ vite.config.ts ตั้ง root: path.resolve(__dirname, 'renderer') (vite.config.ts:7)
  // setupFiles แบบ relative จะถูก resolve ใต้ renderer/ ไม่ใช่ packages/desktop/
  // ต้องใช้ absolute path กันหาไฟล์ไม่เจอ
  test: {
    environment: 'jsdom',
    setupFiles: [path.resolve(__dirname, 'vitest.setup.ts')], // วางไฟล์ที่ packages/desktop/vitest.setup.ts
  }
  ```
  > ทางเลือก: ถ้าอยากใช้ `'./vitest.setup.ts'` แบบ relative ต้องวางไฟล์ที่ `packages/desktop/renderer/vitest.setup.ts` (ใต้ root ของ vite) แทน — เลือกอย่างใดอย่างหนึ่งให้สอดคล้องกัน

**0c. mock `window.electronAPI` ใน setup (กัน JSDOM crash)**
> App เรียก IPC หลายตัวทันทีตอน mount — ต้อง stub ให้ครบ ไม่งั้นเทสต์พังเพราะ JSDOM ไม่มี `window.electronAPI`:
> - `detectLocalAgents()` (App.tsx ~L1022)
> - `loadProviders()` (~L1034)
> - `detectApiModels(normalizeProviderId(newAgentProvider))` — trigger ตอน mount เพราะ `newAgentProvider` default = `'gemini'` (L842) ใน useEffect ที่ L1062
> - `onDiscussionEvent(callback)` — **ต้องคืน unsubscribe function** ตาม preload contract (preload.js:19 `return () => ipcRenderer.removeListener(...)`) ถ้า mock คืน `undefined` cleanup ของ `useEffect` จะ throw
- สร้าง `vitest.setup.ts` (ที่ `packages/desktop/vitest.setup.ts` ให้ตรงกับ absolute path ใน 0b) ที่ stub `window.electronAPI` ครบทุก method (default คืน `{ success: true, ... }`) ด้วย `vi.fn()`; `onDiscussionEvent` ให้คืน `vi.fn()` (เป็น unsubscribe)
- import `@testing-library/jest-dom` ใน setup เพื่อใช้ matcher เช่น `toBeInTheDocument`

**0d. เขียน smoke test ขั้นต่ำ + ตรวจ IPC contract**
- แอป render ได้, สลับ `activeTab` แต่ละหน้าไม่ crash
- ใช้ `vi.spyOn`/mock ของ `window.electronAPI` ตรวจว่าเปิดหน้า/ทำ action แล้ว **ส่ง argument ถูกต้องและลำดับถูก** ไปยัง main process (มี IPC 32 ตัวใน `preload.js` ที่อาจเพี้ยนได้ตอนย้ายไป API client ในเฟส 3)
- ✅ verify (มาตรฐานทุกเฟสนับจากนี้):
  ```bash
  npm run typecheck -w packages/desktop && \
  npm run build:desktop && \
  npm test -w packages/desktop
  ```

### เฟส 1 — แยก types ออก (low risk — ต้องระวัง mechanics ของ global augmentation)
- ย้าย domain interfaces (`ProjectData`, `UIMessage`, `TaskBoardCard`, `ContextPickerItem`, ฯลฯ) → `types/domain.ts` (export ปกติ)
- ย้าย `interface Window`/ElectronAPI **ไม่ใช่แค่ cut/paste** — ตอนนี้อยู่ใน `declare global { interface Window { electronAPI: {...} } }` (App.tsx L85):
  - `types/electronAPI.ts` ต้องเป็น **global augmentation module**: ห่อด้วย `declare global { ... }` และมี `export {}` ปิดท้าย เพื่อให้ TS ถือว่าเป็น module (ไม่งั้น `declare global` จะ error)
  - ไฟล์ต้องถูก include โดย `tsconfig.json` (ปัจจุบัน `include: ["renderer/src"]` ครอบให้แล้ว — วางไฟล์ใต้ `renderer/src/types/`)
  - ถ้า augmentation อ้าง type จาก `domain.ts` ให้ `import type { ... }` ภายในไฟล์ และ **ระวัง circular import** ระหว่าง `electronAPI.ts` ↔ `domain.ts` (domain ห้าม import จาก electronAPI)
- ✅ verify: `npm run typecheck -w packages/desktop` (สำคัญสุดในเฟสนี้ เพราะ vite build ไม่จับ type error) + build

### เฟส 2 — แยก markdown renderer (pure functions)
- ย้าย render markdown ทั้ง 6 ตัว → `lib/markdown/` เป็น pure component/function
- เสี่ยงต่ำสุดเพราะแทบไม่พึ่ง state ของ App
- ✅ verify: build + เทียบ render หน้า Documents/Discussions ด้วยตา

### เฟส 3 — สร้าง typed API client
- ทำ `lib/api.ts` ครอบ `window.electronAPI` ทุกตัว (ยังเรียกตัวเดิมข้างใน)
- ค่อยๆ เปลี่ยน call site มาใช้ `api.xxx()` → component หลุดจากการพึ่ง global โดยตรง เตรียมพร้อม test/mocking
- ✅ verify: build ผ่าน

### เฟส 4 — แยก component ที่ state ภายในไม่ซับซ้อน (low risk)
- ย้าย `Sidebar`, `ContextPanel`, `ErrorBanner`, `OnboardingTour`, `SetupChecklist`, `ContextPickerPanel`, `ContextControl`
- รับทุกอย่างผ่าน props ก่อน (props drilling ชั่วคราวรับได้)
- ✅ verify: build + คลิกผ่านแต่ละส่วนด้วยตา

### เฟส 5 — แตก `renderMainTab` เป็น Screen components (หัวใจของงาน)
- ทำทีละหน้าจอ ทีละ commit ตามลำดับเสี่ยงต่ำ → สูง:
  Documents → Task Archive → Context → MCP Servers → Settings → AI Members → Agent Editor → Task Run → Discussions
  (Discussions/Task Run ซับซ้อนสุด ทำท้ายสุด)
- แต่ละหน้ารับ state/handler ผ่าน props ไปก่อน
- เปลี่ยน if-chain เป็น router map: `{ Discussions: <DiscussionsScreen/>, ... }[activeTab]`
- ✅ verify: build + smoke + คลิกหน้านั้นจริงทุก commit

> **🚩 จุดหยุดประเมิน (หลังเฟส 5):** ถึงตรงนี้ App.tsx ถูกแตกเป็น screens แล้วโดยยังเป็น pure extraction (state ยังอยู่ที่ App, ส่งผ่าน props) — **ถือว่าบรรลุเป้าหมายหลักของ refactor แล้ว** ให้หยุดประเมินว่าจำเป็นต้องทำเฟส 6 จริงไหม ก่อนตัดสินใจไปต่อ

### เฟส 6 — (Optional follow-up) ยุบ props drilling ด้วย Zustand store เฉพาะ domain
> ⚠️ เฟสนี้ **ไม่ใช่ pure extraction** — เป็นการเปลี่ยนที่อยู่ของ state จึงเสี่ยงกับ streaming/event paths เช่น `handleRunCodingTask` (~L2735) และ `handleSendDiscussion` (~L2985) ที่ผูก listener (`onDiscussionEvent`), `loading`, `messages`, selected context, และ final-replacement state หลายจุดเข้าด้วยกัน
> ดังนั้นทำเป็น **optional follow-up เฉพาะ domain ที่มีปัญหาจริง** ไม่ใช่ยกทั้ง 112 จุด:
- ทำเฉพาะ domain ที่ (ก) state ถูกใช้ร่วมหลาย screen จริง หรือ (ข) streaming แล้ว re-render หนัก (เช่น `discussionMessages`, `codingTaskMessages`)
- domain ที่ใช้แค่ screen เดียว → ปล่อยให้ state อยู่ใน screen component นั้น ไม่ต้องยกขึ้น store
- ย้ายทีละ domain ทีละ commit; ตอนย้าย handler ที่ผูก listener (`onDiscussionEvent`) ให้ย้าย **ยกชุด** state+effect+handler+cleanup พร้อมกัน เพื่อกัน stale closure
- ✅ verify: typecheck + build + smoke ทุกการย้าย

### เฟส 7 — เก็บกวาด
- ทยอยย้าย inline styles ที่ซ้ำบ่อย → CSS class ใน `index.css` (ทำเท่าที่คุ้ม)
- ลบ dead code, รวม util ซ้ำ
- ✅ verify: build + smoke

---

## 5. ทางเลือก State Management (เฟส 6)

**คำแนะนำหลัก: Zustand** (ปรับจากฉบับแรกที่เสนอ Context เป็นหลัก ตาม review)

เหตุผลที่เลือก Zustand แทน React Context สำหรับเคสนี้:
- **Selector-based subscription** — consumer re-render เฉพาะเมื่อ slice ที่หยิบไปใช้เปลี่ยน ไม่ลามทั้ง tree ซึ่งสำคัญมากเพราะมี state ที่ stream ถี่ๆ เช่น `discussionMessages`, `codingTaskMessages` (ถ้าใช้ Context ค่าเดียวเปลี่ยน consumer ทุกตัว re-render)
- **Boilerplate น้อย** — ไม่ต้อง wrap provider ซ้อนหลายชั้นรอบ tree
- **แยก store ตาม domain ได้ตรงๆ** — `useWorkspaceStore`, `useDiscussionStore`, `useTaskRunStore`, `useProvidersStore`
- **mock ใน test ง่าย** — เข้ากับ safety net เฟส 0

ติดตั้ง: `npm i -w packages/desktop zustand`

**ทางเลือกสำรอง — React Context + useReducer**: ใช้ได้ถ้าต้องการเลี่ยง dependency เพิ่ม เหมาะกับ state ที่เปลี่ยนไม่ถี่ (เช่น Workspace/Onboarding) — สามารถผสมได้: state เปลี่ยนไม่บ่อยใช้ Context, state ที่ stream ใช้ Zustand store

> **หมายเหตุขอบเขต:** ส่วนนี้ใช้กับ **เฟส 6 ซึ่งเป็น optional follow-up เท่านั้น** เป้าหมายหลักของ refactor (แตก App.tsx แบบ pure extraction) จบที่เฟส 5 แล้ว — อย่าเริ่มยก state เข้า store จนกว่าจะประเมินหลังเฟส 5 ว่าจำเป็นจริง และทำเฉพาะ domain ที่มีปัญหา ไม่ใช่ยกทั้ง 112 จุด

---

## 6. ความเสี่ยง & การลดความเสี่ยง

- **ความเสี่ยงหลัก:** behavior เพี้ยนตอนแตก `renderMainTab` เพราะ state ผูกกันเยอะ → ทำทีละหน้า + props ไปก่อน (ไม่ย้าย state พร้อมกัน) + smoke test
- **ไม่มี git history ปกติ** (ตาม AGENTS.md) → commit ย่อยถี่ๆ ต่อเฟส เพื่อ rollback ได้
- **closure/stale state:** ตอนย้าย handler ออกเป็น hook ระวัง dependency array ของ `useEffect/useCallback` → ย้ายแบบยกชุด state+effect+handler ของ domain เดียวพร้อมกัน
- **ข้อห้าม:** ห้ามรวมการเพิ่มฟีเจอร์ (เช่นปุ่ม Stop/toast) เข้ามาในเฟส refactor — แยกทำหลัง refactor เสร็จ

---

## 7. คำสั่ง verify ประจำ

```bash
# มาตรฐานทุกเฟส (หลังเฟส 0): typecheck สำคัญเพราะ vite build ไม่จับ type error ของ renderer
npm run typecheck -w packages/desktop && \
npm run build:desktop && \
npm test -w packages/desktop

# รันแอปจริงเพื่อ smoke ด้วยตา
npm run dev:desktop
```

> หมายเหตุ: `build:desktop` รัน `vite build` (renderer) + `tsc` (main เท่านั้น) → **renderer ไม่ถูก type-check ตอน build** จึงต้องมี `typecheck` (`tsc -p tsconfig.json --noEmit`) เป็นด่านแยก ไม่งั้น "TS เป็น safety net" ใช้ไม่ได้จริงกับฝั่ง renderer

---

## 8. Checklist ความคืบหน้า

- [ ] เฟส 0 — safety net (tsconfig paths + typecheck script + Vitest + electronAPI mock + smoke/IPC test)
- [ ] เฟส 1 — แยก types (global augmentation module)
- [ ] เฟส 2 — แยก markdown renderer
- [ ] เฟส 3 — typed API client
- [ ] เฟส 4 — แยก layout/onboarding/context components
- [ ] เฟส 5 — แตก renderMainTab เป็น screens ← **🚩 เป้าหมายหลักจบที่นี่ หยุดประเมิน**
- [ ] เฟส 6 — (optional) ยก state เข้า Zustand store เฉพาะ domain ที่มีปัญหาจริง
- [ ] เฟส 7 — (optional) เก็บกวาด styles/dead code

---

## 9. บันทึกการ Review (rev.2)

ปรับแผนตาม findings จากการ review (ตรวจยืนยันกับโค้ดจริงแล้วทั้งหมด):

- **Finding 1 (Blocker) — tsconfig path mapping:** `vite.config.ts` มี alias `@` แต่ `tsconfig.json` ไม่มี `baseUrl`/`paths` → เพิ่มเป็นขั้น 0a (prerequisite)
  - หมายเหตุความแม่นยำ: `build:renderer` ใช้ `vite build` (esbuild) จึงไม่ type-check ตอน build จริง ดังนั้น `build:desktop` อาจไม่พังตรงๆ แต่ editor (tsserver) + vitest จะ resolve `@/` ไม่เจอ จึงต้องเพิ่ม paths อยู่ดี
- **Finding 2 (Major) — JSDOM crash:** ยืนยัน App.tsx ~L1022/L1034 เรียก `detectLocalAgents()`/`loadProviders()` ตอน mount → ระบุแพ็กเกจ (`vitest`, `@testing-library/react`, `jsdom`, `@testing-library/jest-dom`) + `vitest.setup.ts` ที่ stub `window.electronAPI` ในขั้น 0b–0c
- **Finding 3 (Major) — เลือก Zustand เป็นหลัก:** ปรับส่วนที่ 5 ให้ Zustand เป็นทางเลือกหลัก (selector กัน re-render จาก streaming `discussionMessages`/`codingTaskMessages`), Context เป็นทางเลือกสำรองสำหรับ state ที่เปลี่ยนไม่ถี่
- **Finding 4 (Nit) — IPC contract test:** เพิ่มขั้น 0d ให้ใช้ `vi.spyOn`/mock ตรวจ argument + ลำดับที่ส่งไป main process (IPC 32 ตัวใน `preload.js`)

---

## 10. บันทึกการ Review (rev.3)

ปรับแผนตาม findings รอบ 2 (ตรวจยืนยันกับโค้ดจริงแล้วทั้งหมด):

- **Finding 1 — TS ยังไม่เป็น safety net จริงสำหรับ renderer:** `build:desktop` = `vite build` (renderer, ไม่ type-check) + `tsc` (main เท่านั้น) ที่ `package.json:12,15` → เพิ่ม script `typecheck: "tsc -p tsconfig.json --noEmit"` และเปลี่ยน verify มาตรฐานทุกเฟสเป็น `typecheck && build:desktop && test` (ขั้น 0b + ส่วนที่ 7)
- **Finding 2 — mock list ยังไม่ครบ immediate IPC:** `newAgentProvider` default = `'gemini'` (App.tsx:842) ทำให้ useEffect ที่ L1062 เรียก `detectApiModels(...)` ตอน mount, และ `onDiscussionEvent` ต้องคืน unsubscribe ตาม preload contract (preload.js:19) → ขยาย mock list ในขั้น 0c ให้ครอบ `detectLocalAgents`, `loadProviders`, `detectApiModels`, และ `onDiscussionEvent` (คืน `vi.fn()` เป็น unsubscribe)
- **Finding 3 — เฟส 6 เกินขอบเขต pure extraction:** การยก 112 state เข้า global store เสี่ยงกับ streaming/event paths เช่น `handleRunCodingTask` (~L2735), `handleSendDiscussion` (~L2985) ที่ผูก listener/loading/messages/context เข้าด้วยกัน → ลดเฟส 6 เป็น **optional follow-up เฉพาะ domain ที่มีปัญหาจริง**, เพิ่มจุดหยุดประเมินหลังเฟส 5 (เป้าหมายหลักจบที่เฟส 5)
- **Finding 4 — เฟส 1 ไม่ใช่ zero risk ต้องระบุ global augmentation:** `interface Window` อยู่ใน `declare global { ... }` (App.tsx:85) → ระบุชัดในเฟส 1 ว่า `types/electronAPI.ts` ต้องเป็น global augmentation module (ห่อ `declare global` + `export {}`), ถูก include โดย tsconfig (`include: ["renderer/src"]`), และห้าม circular import กับ `domain.ts`

---

## 11. บันทึกการ Review (rev.4)

- **Finding — `vitest.setup.ts` path คลุมเครือเพราะ Vite root = renderer:** `vite.config.ts:7` ตั้ง `root: path.resolve(__dirname, 'renderer')` ทำให้ `setupFiles` แบบ relative (`./vitest.setup.ts`) ถูก resolve ใต้ `packages/desktop/renderer/` ไม่ใช่ `packages/desktop/` → เฟส 0 อาจ fail เพราะหา setup file ไม่เจอ หรือ JSDOM mock ไม่โหลด
  - แก้: ระบุใน 0b ให้ใช้ `setupFiles: [path.resolve(__dirname, 'vitest.setup.ts')]` (absolute) + วางไฟล์ที่ `packages/desktop/vitest.setup.ts` และผูกตำแหน่งใน 0c ให้ตรงกัน; พร้อมระบุทางเลือก relative (วางที่ `renderer/`) ไว้ด้วย
- จุด blocker รอบก่อนแก้ครบแล้ว: typecheck แยกสำหรับ renderer, mock immediate IPC (`detectApiModels`/`onDiscussionEvent`), เฟส 6 เป็น optional follow-up, และ global augmentation mechanics
