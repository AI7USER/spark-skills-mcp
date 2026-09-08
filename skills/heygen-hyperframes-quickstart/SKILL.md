---
name: heygen-hyperframes-quickstart
description: HeyGen Hyperframes Quickstart reference. Use when the user asks about HeyGen Hyperframes, how to initialize a project, preview or render videos.
---

# HeyGen Hyperframes Quickstart Reference

This skill provides the quickstart guide and workflow for HeyGen Hyperframes.

## Workflow Overview

Go from zero to a rendered MP4 — either by prompting your AI agent or by starting a project manually.

### 1. With an AI coding agent (Recommended)

Install the HyperFrames skills, then describe the video you want:

`ash
npx skills add heygen-com/hyperframes
`

Core skills package includes:
- /hyperframes: Entry skill, read first. Routes requests to the correct workflow.
- /hyperframes-core: Composition contract (HTML structure, timed elements, clips, tracks).
- /hyperframes-animation: Animation engine & GSAP / Lottie / CSS runtime adapters.
- /hyperframes-creative: Design direction (palettes, typography, beat planning).
- /hyperframes-cli: Dev-loop CLI (init, lint, preview, render, doctor).

### 2. Manual Project Loop

#### Prerequisites
- **Node.js 22+**
- **FFmpeg** (v7+ recommended, required for local renders)

#### Steps:
1. **Scaffold Project**:
   `ash
   npx hyperframes init my-video
   cd my-video
   `
2. **Preview in Browser**:
   `ash
   npx hyperframes preview
   `
3. **Render to MP4**:
   `ash
   npx hyperframes render --output output.mp4
   `

## Composition Structure Rules

When creating or modifying compositions, remember these rules:
- **Root Element**: Must have data-composition-id, data-width, and data-height.
- **Timed Elements**: Must have data-start, data-duration, data-track-index, and class="clip".
- **GSAP Timelines**: Must be created with { paused: true } and registered on window.__timelines (e.g. window.__timelines["my-video"] = tl;).
