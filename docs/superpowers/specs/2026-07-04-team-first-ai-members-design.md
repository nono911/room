# Team-First AI Members Design

## Summary

ROOM should move from a flat AI member list to a team-first workspace model. Users primarily manage teams such as `UX/UI`, `Dev`, or `PM`, while each person inside a team remains a saved AI member with independent persona, skills, model, and provider configuration.

The design keeps the existing saved member concept but adds team files as an organizing and selection layer. It also keeps temporary discussion/task members for one-off work.

## Goals

- Show AI Members as teams first, not as one long list of every saved member.
- Let users create teams and add multiple members from the same template.
- Auto-generate persona variants so cloned members do not behave identically.
- Keep every generated team member as a saved, editable member.
- Let a member belong to multiple teams.
- Let Discuss select a whole team, selected members from a team, or temporary members.
- Preserve member order from each team when adding teams to a discussion.

## Non-Goals

- Do not remove the existing `.room/members/*.json` member format.
- Do not make team-local hidden agents in the first version.
- Do not implement a full command palette for member selection in the first version.
- Do not make deleting a team delete its members.

## Domain Model

### Template

A template is a built-in persona blueprint from ROOM, such as `UX`, `Developer`, or `Reviewer`. Templates are used to generate saved members.

### Member

A member is a saved AI agent configuration in `.room/members/*.json`. Each member has its own:

- name
- role
- provider
- model
- system prompt
- skills
- local CLI execution settings when applicable

Members are reusable. The same member can appear in multiple teams.

### Team

A team is an ordered group of saved member references. Teams live in `.room/teams/*.json` and store member names in workflow order.

Example:

```json
{
  "name": "UX/UI",
  "description": "Design review and interface strategy team",
  "memberNames": ["UX Researcher", "UX Interaction Designer", "UX Visual Critic"],
  "createdAt": "2026-07-04T00:00:00.000Z",
  "updatedAt": "2026-07-04T00:00:00.000Z"
}
```

### Persona Variant

A persona variant is a generated specialization used when creating more than one member from the same template. For example, creating three members from the `UX` template can generate:

- `UX Researcher`
- `UX Interaction Designer`
- `UX Visual Critic`

Each generated member starts with a different prompt angle and may have different default skills. Users can edit names, persona angles, prompts, skills, provider, and model before saving.

### Unassigned

`Unassigned` is a virtual team. It contains saved members that are not referenced by any user-created team. It has no team file and cannot be deleted.

### Temporary Member

A temporary member is a one-run discussion/task participant. It is not saved into `.room/members` and does not become part of any team.

## Data Storage

### Members

Keep existing saved member files:

```text
.room/members/*.json
```

### Teams

Add one file per team:

```text
.room/teams/*.json
```

Team filenames should be generated from a sanitized slug of the team name. Team contents store display `name`, optional `description`, ordered `memberNames`, `createdAt`, and `updatedAt`.

### References

Teams reference members by member name in the first version. When a member is renamed, team references must be updated. When a member is deleted, all team references to that member must be removed.

## AI Members Page

### Empty Team State

If the workspace has no user-created teams, AI Members shows:

- a short empty-state explanation
- Recommended Teams
- Create Team

Recommended Teams are starter flows only. They are not the primary page once the user has teams.

### Team List State

Once at least one user-created team exists, AI Members shows team cards as the primary content.

Each team card shows:

- team name
- member count
- a short preview of member roles/names
- empty-team status when applicable
- Detail action

The page should also include:

- Create Team
- optional access to Recommended Teams inside the create flow
- Unassigned team when unassigned members exist

### Team Detail

Team detail shows:

- team name and description
- ordered member list
- reorder controls
- add existing member
- add new members from templates
- remove member from team
- edit member action

Removing a member from a team does not delete the member.

### Member Detail

Member detail keeps existing agent editing behavior but adds team usage visibility:

```text
Used in: UX/UI, PM
```

This is informational only. Saving is not blocked when a member belongs to multiple teams.

## Create Team Wizard

The first version should use a guided wizard.

### Step 1: Team Basics

User enters:

- team name
- optional description

### Step 2: Add Templates

User chooses one or more templates and counts. Example:

- `UX` x 3
- `Product` x 1

### Step 3: Generate Variants

ROOM auto-generates member variants. If names collide with existing members, ROOM applies suffixes such as `UX Researcher 2`.

Generated variants should be deterministic enough to feel predictable, but broad enough to avoid identical agents. For common roles, preferred variant angles should be curated. For unknown combinations, use generic angles such as:

- Strategy
- Execution
- Critique
- Research
- QA

### Step 4: Review

Before creating, user can edit:

- generated member names
- roles
- persona angle
- skills
- provider/model if needed

### Step 5: Create

Create saved member files first, then create the team file referencing the new members in review order.

If any save fails, return an error and do not write a partial team. Already-written member files should be either rolled back or clearly reported for cleanup. The preferred implementation is to validate all payloads before writing files.

## Discuss Selection

Discuss should support:

- selecting a whole team
- expanding a team to select individual members
- adding temporary members
- reordering the final workflow

### Team Chips

Use team chips as the first-level selector. Selecting a team appends its members in team order.

### Expandable Members

Each team chip can expand to show member chips. Users can select or deselect individual members.

### Dedupe

If multiple selected teams reference the same member, the final participant list dedupes by member name. The first selected occurrence determines position.

### Ordering

Default order follows `memberNames` in each selected team. If several teams are selected, append teams in selection order. Users can still reorder selected participants in Discuss.

## Task Run Selection

Task Run can continue to select doer/reviewers from members, but it should eventually use the same team/member roster abstraction as Discuss. The first implementation may keep Task Run changes smaller, as long as member lookup remains compatible with saved members and temporary members.

## IPC And Engine Changes

Add team IPC handlers:

- `load-teams`
- `save-team`
- `delete-team`
- `update-team-members`

Update member deletion:

- delete member file
- remove the member name from every team file
- keep empty teams

Update workspace data loading:

- include `teams`
- compute `unassignedMembers`
- keep `agents` for compatibility until UI and tests fully migrate to teams

## Migration

Existing workspaces have members but no teams. On first load:

- do not write migration files automatically
- show all existing saved members under virtual `Unassigned`
- show Recommended Teams because there are no user-created teams
- user can create teams and add existing members

This avoids surprising writes to existing workspaces.

## Error Handling

- Invalid team files should be skipped with an error surfaced in workspace diagnostics or the UI.
- Missing member references should be ignored in runtime selection and shown as stale references in team detail.
- Saving a team with duplicate member names should normalize to one reference per team.
- Deleting a member must remove that member from all teams.
- Renaming a member must update all team references.

## Testing

Minimum validation:

- `rtk npm run build:engine`
- `rtk npm run build:desktop`

Focused tests should cover:

- loading teams from `.room/teams`
- virtual `Unassigned` computation
- create team wizard payload generation
- member deletion removing team refs
- member rename updating team refs
- Discuss selecting whole teams and deduping member names
- migration behavior for existing member-only workspaces

## Implementation Slices

1. Engine/main-process team persistence and validation.
2. Workspace data shape includes teams and unassigned members.
3. AI Members page team-first view and team detail.
4. Create Team wizard with generated persona variants.
5. Discuss team selector with expandable members and dedupe.
6. Cleanup: reduce legacy file size by extracting team/member components.

## Open Decisions

No open product decisions remain for the first implementation. Visual details such as exact card layout and wizard copy can follow ROOM's existing dark, compact desktop UI style.
