# Matrix UI

*Measure twice, ship once.*

Clickable prototype of Matrix, demoed on the app ID **ABCD**: four code components (ABCD-service, ABCD-ui, ABCD-batch, ABCD-etl) and the automation repository ABCD-TestingScript.

- **Coverage gaps.** Testmind maps every functional requirement to the components that implement it and to the tests in ABCD-TestingScript. Matrix closes the gaps: it writes tests in each component's style, commits them to a feature branch, runs them through Harness on HyperExecute (post-commit and post-merge) and re-measures.
- **Vulnerability remediation.** Matrix scans the components, triages findings and fixes them on a feature branch. Before raising the PRs it checks that tests cover what each fix changes. If they don't, it shows the gaps and either writes the missing tests or asks a developer. After merge, the full automation suite runs.

Teammates can review Matrix's work at each gate.

All backends are mocked inside the Vite dev server, so the app runs on its own.

## Run

```bash
npm install
npm run dev          # http://localhost:5173 (add -- --host to reach it from other devices)
npm run build        # typecheck + production bundle
```

Requires Node 20.19+ or 22.12+.

## Layout

| Path | What's there |
| --- | --- |
| `src/pages` | Welcome, Conversation, History, Reviews, Connections |
| `src/components` | Chat, side panels, pipeline, remediation and team-review UI |
| `src/state` | Store (`useReducer`, persisted to localStorage), the scripted agent, types |
| `src/pipeline`, `src/remediation` | Stage definitions, fixture data and chat messages for each flow |
| `src/data` | Coverage report and App Workspace fixtures |
| `src/styles` | Design tokens (`--mx-*`), light/dark theme, app styles |
| `mock` | Mock APIs mounted into Vite: analysis runs, coverage pipelines, remediations, per-user secret store |

## Mock backend settings

| Variable | Default | Effect |
| --- | --- | --- |
| `TESTMIND_RUN_SECONDS` | `30` | Length of a coverage analysis run |
| `MATRIX_STAGE_SCALE` | `1` | Multiplier on pipeline stage durations (e.g. `0.2` for quick demos) |
| `MATRIX_PIPELINE_ENV` | `SIT` | Environment the mocked Harness pipelines report testing against |
| `MATRIX_MASTER_KEY` | generated | 32-byte key (base64) for the secret store; otherwise one is created in `mock/.data` |

## Prototype limits

- The signed-in user is a fixed header (`X-Matrix-User`). Production needs SSO.
- The secret store encrypts tokens (AES-256-GCM, per-user keys) into `mock/.data`, which is git-ignored. Use test tokens only, never real PATs.
- Agent replies are scripted, not model-generated.
