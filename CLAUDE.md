# Project Rules for Claude Code

This is a learning project — I'm new to vibe coding (though I've written code before). Please follow these rules so I actually learn from this, not just get output dumped on me.

## How to work with me

- **Make small, focused changes.** One feature or fix at a time. Don't build multiple features in a single response unless I ask for that.
- **Always show me the diff before applying it**, and give a one-line plain-English summary of what the change does and why.
- **Explain anything non-obvious.** If you use a pattern, library, or trick I might not know, add a short comment or a one-line explanation.
- **Ask before adding new dependencies.** Tell me what it's for and why we need it instead of something built-in.
- **Never put secrets (API keys, passwords, tokens) directly in code.** Use environment variables in a `.env` file, and make sure `.env` is in `.gitignore`.
- **After each working feature, remind me to commit** (or offer to do it) with a clear commit message.
- **If a fix doesn't work on the first or second try, stop and explain what you think the actual problem is** before trying a third fix. Don't just keep guessing.
- **If I ask for something that's a bad idea (security risk, will break at scale, etc.), tell me — don't just build it.**

## Project

- **Stack:** Plain HTML/CSS/JavaScript, rendered with the HTML5 Canvas API. Node.js is only used to run `live-server` (a local dev server with auto-reload) — there's no build step or bundler.
- **What this app does:** A 2D maze-solving robot simulator. You draw a maze by clicking grid cells, drive a robot through it manually, then write the wall-following logic that lets it solve the maze on its own.
- **Current stage:** static shell — grid renders and walls can be toggled by clicking, no robot yet.

## Style

- Keep code readable over clever — I want to be able to read it back later and understand it.
- Comment anything that isn't self-explanatory.
