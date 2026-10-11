/**
 * ABCD's components: four that hold product code, and ABCD-TestingScript, the
 * automation suite that tests all of them. Coverage is measured across the four
 * code components against the tests in ABCD-TestingScript.
 */
import type { Requirement } from './report'

export type ComponentKind = 'service' | 'ui' | 'batch' | 'etl' | 'tests'

export interface Component {
  id: string
  kind: ComponentKind
  role: string
  /** How Matrix tests this component from ABCD-TestingScript. */
  testStyle: string
}

export const TEST_REPO = 'ABCD-TestingScript'

export const COMPONENTS: Component[] = [
  { id: 'ABCD-service', kind: 'service', role: 'REST APIs and business rules', testStyle: 'API tests' },
  { id: 'ABCD-ui', kind: 'ui', role: 'Operations and customer screens', testStyle: 'UI tests' },
  { id: 'ABCD-batch', kind: 'batch', role: 'End-of-day and scheduled jobs', testStyle: 'Batch job tests' },
  { id: 'ABCD-etl', kind: 'etl', role: 'Reporting feeds and reference-data loads', testStyle: 'Data checks' },
  { id: TEST_REPO, kind: 'tests', role: 'Automation suite for every component', testStyle: '' },
]

export const CODE_COMPONENTS = COMPONENTS.filter((c) => c.kind !== 'tests')

export const component = (id: string) => COMPONENTS.find((c) => c.id === id)

/** Components that implement each functional area, the main one first. */
export const AREA_COMPONENTS: Record<string, string[]> = {
  'payments-processing': ['ABCD-service', 'ABCD-ui', 'ABCD-batch'],
  'validation-exception-handling': ['ABCD-service', 'ABCD-ui'],
  'customer-account-workflows': ['ABCD-ui', 'ABCD-service'],
  'reporting-and-audit': ['ABCD-etl', 'ABCD-service', 'ABCD-ui'],
  'reference-data-management': ['ABCD-etl', 'ABCD-service'],
  'user-access-permissions': ['ABCD-service', 'ABCD-ui'],
  'notifications-alerts': ['ABCD-batch', 'ABCD-service'],
  'batch-scheduling': ['ABCD-batch'],
}

/** Components a requirement runs through: its main one, plus the one it hands off to for some. */
export function componentsFor(areaSlug: string, i: number): string[] {
  const list = AREA_COMPONENTS[areaSlug] ?? ['ABCD-service']
  const main = list[i % list.length]
  const next = list[(i + 1) % list.length]
  return i % 3 === 0 && next !== main ? [main, next] : [main]
}

/** Where the code for a requirement lives in its main component. */
export function sourceFileFor(componentId: string, stem: string) {
  switch (component(componentId)?.kind) {
    case 'ui':
      return `src/app/…/${kebab(stem)}.component.ts`
    case 'batch':
      return `src/main/java/…/batch/${stem}Step.java`
    case 'etl':
      return `src/main/java/…/etl/${stem}Load.java`
    default:
      return `src/main/java/…/${stem}Handler.java`
  }
}

/** Where Matrix puts the tests for a requirement in ABCD-TestingScript, in the style of its main component. */
export function testFileFor(req: Pick<Requirement, 'components' | 'areaSlug'>, stem: string) {
  const pkg = req.areaSlug.split('-')[0]
  switch (component(req.components[0])?.kind) {
    case 'ui':
      return `ui-tests/${pkg}/${kebab(stem)}.spec.ts`
    case 'batch':
      return `batch-tests/src/test/java/com/abcd/${pkg}/${stem}JobTest.java`
    case 'etl':
      return `data-tests/src/test/java/com/abcd/${pkg}/${stem}LoadTest.java`
    default:
      return `api-tests/src/test/java/com/abcd/${pkg}/${stem}ApiTest.java`
  }
}

/** Test steps that drive the requirement through each component it touches. */
export function stepsThrough(componentIds: string[]): string[] {
  const steps: string[] = []
  componentIds.forEach((id, i) => {
    const kind = component(id)?.kind
    if (kind === 'ui') steps.push(i === 0 ? `Open the screen in ${id} with a prepared user` : `Check the result shows in ${id}`)
    if (kind === 'service') steps.push(i === 0 ? `Call the ${id} API with a prepared request` : `Read the stored record through the ${id} API`)
    if (kind === 'batch') steps.push(i === 0 ? `Stage input data and trigger the ${id} job` : `Run the ${id} job that picks it up`)
    if (kind === 'etl') steps.push(i === 0 ? `Drop a source file and run the ${id} load` : `Run the ${id} load and query the target tables`)
  })
  steps.push('Assert the outcome against the acceptance criterion')
  return steps
}

function kebab(s: string) {
  return s.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase()
}
