---
name: room-ui-aesthetics
description: Checklist and best practices for creating gorgeous, responsive, glassmorphic React interfaces in ROOM.
---

# ROOM UI & Aesthetics Development Guide

Use this skill when designing, building, or modifying components in the React frontend (`packages/desktop/renderer/src/`).

## 1. Aesthetic Design System
- **Dark Mode First**: Focus on deep rich dark mode interfaces. Avoid generic black (`#000`); use deep hues (e.g. `#0d0f12`, `#14171c`).
- **Glassmorphic Panels**: Use semi-transparent layers for panels, sidebars, and cards:
  ```css
  .panel-glass {
    background: rgba(20, 23, 28, 0.7);
    backdrop-filter: blur(16px);
    -webkit-backdrop-filter: blur(16px);
    border: 1px solid rgba(255, 255, 255, 0.08);
    box-shadow: 0 8px 32px 0 rgba(0, 0, 0, 0.3);
  }
  ```
- **Vibrant Highlights & Gradients**: Use curated gradients for headers, selected items, or buttons (e.g. indigo-to-purple, teal-to-emerald).

---

## 2. Micro-Animations & Transitions
Ensure the application feels alive and interactive.

- **Standard Timing**: For interactive hover effects, use smooth, short durations:
  ```css
  .interactive-element {
    transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
  }
  .interactive-element:hover {
    transform: translateY(-1px);
    border-color: rgba(255, 255, 255, 0.2);
  }
  ```
- **Focus Rings**: Style focus outlines cleanly. Never use native browser focus outline; use custom glow effects or box-shadow transitions.

---

## 3. Desktop Application Details
- **Custom Styled Scrollbars**: Make default scrollbars match the dark theme aesthetics:
  ```css
  ::-webkit-scrollbar {
    width: 6px;
    height: 6px;
  }
  ::-webkit-scrollbar-track {
    background: transparent;
  }
  ::-webkit-scrollbar-thumb {
    background: rgba(255, 255, 255, 0.15);
    border-radius: 4px;
  }
  ::-webkit-scrollbar-thumb:hover {
    background: rgba(255, 255, 255, 0.3);
  }
  ```
- **Responsive Fluid Layouts**: Always use flexbox and grid layouts so that resizing the Electron window dynamically stretches the panels without breaking layout boundaries.
