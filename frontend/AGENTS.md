<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## Active React Checks

When changing active React code, run these from the repo root alongside Fallow:

```bash
pnpx react-compiler-marker
pnpm --dir frontend exec biome lint --only=correctness/useExhaustiveDependencies --only=a11y/noStaticElementInteractions --only=a11y/noLabelWithoutControl --only=style/useGlobalThis --max-diagnostics=none .
```

Fix every reported React Compiler or targeted Biome issue before handoff.
