/**
 * Prototype findings for ABCD. Sample data: the files and lines are the
 * prototype's, while the CWE/CVE IDs and their fixes are real-world patterns.
 */
import { REPORT, findRequirement } from '../data/report'
import { TEST_REPO } from '../data/components'
import { storyFor, testCasesFor } from '../pipeline/data'
import type { RemediationState, Severity } from './types'

export interface Finding {
  id: string
  title: string
  cwe: string
  cweName: string
  cve?: string
  severity: Severity
  scanner: 'SAST' | 'SCA' | 'Secrets'
  /** The ABCD component the vulnerable code is in. */
  repo: string
  file: string
  line: number
  /** Code around the finding; `hit` marks the vulnerable line. */
  evidence: { n: number; text: string; hit?: boolean }[]
  triage: { verdict: 'fix' | 'false_positive'; confidence: number; exploitability: string; reason: string }
  fix: FixApproach
  /** Other ways to fix it, offered when you ask for another approach in chat. */
  alternatives: FixApproach[]
  /** Plain-language risk, for "explain the risk". */
  risk: string
  tests: { id: string; title: string; kind: 'exploit' | 'regression' | 'unit' }[]
  /** Short name for the feature branch. */
  slug: string
  /** Functional requirements whose behaviour the fix changes: these need tests before the PR. */
  impact: string[]
}

export interface FixApproach {
  label: string
  summary: string
  before: string[]
  after: string[]
}

export const FINDINGS: Finding[] = [
  {
    id: 'VULN-101',
    title: 'SQL injection in report sorting',
    cwe: 'CWE-89',
    cweName: 'SQL injection',
    severity: 'high',
    scanner: 'SAST',
    repo: 'ABCD-service',
    file: 'src/main/java/com/abcd/audit/ReportQueryDao.java',
    line: 88,
    evidence: [
      { n: 86, text: 'public List<Report> list(String sortColumn) {' },
      { n: 87, text: '    // sortColumn comes straight from the ?sort= request parameter' },
      { n: 88, text: '    String sql = "SELECT * FROM reports ORDER BY " + sortColumn;', hit: true },
      { n: 89, text: '    return jdbc.query(sql, reportMapper);' },
      { n: 90, text: '}' },
    ],
    triage: { verdict: 'fix', confidence: 0.96, exploitability: 'Reachable from an authenticated API; user input reaches the query unchanged.', reason: 'Request parameter is concatenated into SQL.' },
    fix: {
      label: 'Recommended',
      summary: 'Only allow known column names; anything else falls back to the default order.',
      before: ['String sql = "SELECT * FROM reports ORDER BY " + sortColumn;'],
      after: [
        'private static final Set<String> SORTABLE = Set.of("created_at", "name", "status");',
        'String column = SORTABLE.contains(sortColumn) ? sortColumn : "created_at";',
        'String sql = "SELECT * FROM reports ORDER BY " + column;',
      ],
    },
    tests: [
      { id: 'SEC-101-01', title: 'Injection payload in ?sort= is rejected, default order used', kind: 'exploit' },
      { id: 'SEC-101-02', title: 'Each allowed column still sorts correctly', kind: 'regression' },
    ],
    slug: 'sql-injection-report-sort',
    impact: ['FR-673', 'FR-672'],
    risk: 'An attacker who can call the reports API can change the query: read other tables, or slow the database down. Sorting looks harmless, which is why ORDER BY injection often survives reviews.',
    alternatives: [
      {
        label: 'Map sort keys to columns',
        summary: 'Accept a sort key from a fixed enum and map it to a column name, so request text never reaches SQL at all.',
        before: ['String sql = "SELECT * FROM reports ORDER BY " + sortColumn;'],
        after: ['ReportSort sort = ReportSort.fromKey(sortKey).orElse(ReportSort.CREATED);', 'String sql = "SELECT * FROM reports ORDER BY " + sort.column();'],
      },
    ],
  },
  {
    id: 'VULN-102',
    title: 'Log4Shell in log4j-core 2.14.1',
    cwe: 'CWE-917',
    cweName: 'Expression language injection',
    cve: 'CVE-2021-44228',
    severity: 'critical',
    scanner: 'SCA',
    repo: 'ABCD-batch',
    file: 'pom.xml',
    line: 64,
    evidence: [
      { n: 62, text: '<dependency>' },
      { n: 63, text: '  <groupId>org.apache.logging.log4j</groupId><artifactId>log4j-core</artifactId>' },
      { n: 64, text: '  <version>2.14.1</version>', hit: true },
      { n: 65, text: '</dependency>' },
    ],
    triage: { verdict: 'fix', confidence: 0.99, exploitability: 'Known exploited; any logged user input can trigger a JNDI lookup.', reason: 'Vulnerable version range 2.0-beta9 to 2.14.1.' },
    fix: { label: 'Recommended', summary: 'Upgrade log4j-core to 2.17.1, which removes message lookups and restricts JNDI.', before: ['<version>2.14.1</version>'], after: ['<version>2.17.1</version>'] },
    tests: [
      { id: 'SEC-102-01', title: 'Logging a ${jndi:ldap://…} string makes no outbound lookup', kind: 'exploit' },
      { id: 'SEC-102-02', title: 'Dependency check: no log4j-core below 2.17.1 on the classpath', kind: 'unit' },
      { id: 'SEC-102-03', title: 'Batch job logs still written in the expected format', kind: 'regression' },
    ],
    slug: 'log4shell',
    impact: ['FR-901', 'FR-938'],
    risk: 'Log4Shell lets anyone who can get a string into a log line run code on the server. It’s actively exploited, so it’s the most urgent finding here.',
    alternatives: [
      {
        label: 'Remove JndiLookup (stopgap)',
        summary: 'Strip the JndiLookup class from the jar as a temporary mitigation if you can’t upgrade yet. Upgrading is still required.',
        before: ['<version>2.14.1</version>'],
        after: ['<version>2.14.1</version>  <!-- JndiLookup.class removed at build; upgrade pending -->'],
      },
    ],
  },
  {
    id: 'VULN-103',
    title: 'Hard-coded SFTP password',
    cwe: 'CWE-798',
    cweName: 'Hard-coded credentials',
    severity: 'high',
    scanner: 'Secrets',
    repo: 'ABCD-batch',
    file: 'src/main/java/com/abcd/batch/config/SftpConfig.java',
    line: 23,
    evidence: [
      { n: 22, text: 'private static final String USER = "abcd-batch";' },
      { n: 23, text: 'private static final String PASSWORD = "••••••••••••";  // literal in source', hit: true },
      { n: 24, text: 'private static final String HOST = "sftp.abcd.internal";' },
    ],
    triage: { verdict: 'fix', confidence: 0.94, exploitability: 'Anyone with repository access has the credential; it is also in Git history.', reason: 'High-entropy literal assigned to a password field.' },
    fix: {
      label: 'Recommended',
      summary: 'Read the credential from the secret manager at start-up. The old password must also be rotated: that part is yours.',
      before: ['private static final String PASSWORD = "••••••••••••";'],
      after: ['private final String password = secrets.get("batch/sftp/password");'],
    },
    tests: [
      { id: 'SEC-103-01', title: 'Config loads the password from the secret manager', kind: 'unit' },
      { id: 'SEC-103-02', title: 'Secret scan finds no credential literals in the module', kind: 'regression' },
    ],
    slug: 'hardcoded-sftp-password',
    impact: ['FR-904'],
    risk: 'Anyone who can read the repository, or its history, can log in to the SFTP server as the batch user. Removing it from the code doesn’t revoke it: it has to be rotated.',
    alternatives: [
      {
        label: 'Environment variable',
        summary: 'Read the password from an environment variable injected by the deployment. Simpler, but the secret manager gives you rotation and audit.',
        before: ['private static final String PASSWORD = "••••••••••••";'],
        after: ['private final String password = System.getenv("ABCD_SFTP_PASSWORD");'],
      },
    ],
  },
  {
    id: 'VULN-104',
    title: 'Stored XSS in profile bio',
    cwe: 'CWE-79',
    cweName: 'Cross-site scripting',
    severity: 'medium',
    scanner: 'SAST',
    repo: 'ABCD-ui',
    file: 'src/main/resources/templates/profile.html',
    line: 42,
    evidence: [
      { n: 41, text: '<h2 th:text="${user.displayName}"></h2>' },
      { n: 42, text: '<p class="bio" th:utext="${user.bio}"></p>', hit: true },
    ],
    triage: { verdict: 'fix', confidence: 0.9, exploitability: 'Users can edit their own bio; it renders unescaped for every viewer.', reason: 'Unescaped output of user-controlled data.' },
    fix: { label: 'Recommended', summary: 'Render the bio escaped.', before: ['<p class="bio" th:utext="${user.bio}"></p>'], after: ['<p class="bio" th:text="${user.bio}"></p>'] },
    tests: [
      { id: 'SEC-104-01', title: 'A <script> bio renders as text, not markup', kind: 'exploit' },
      { id: 'SEC-104-02', title: 'Plain-text bios render unchanged', kind: 'regression' },
    ],
    slug: 'stored-xss-profile-bio',
    impact: ['FR-193'],
    risk: 'A user can put a script in their bio that runs in the browser of everyone who views their profile, for example to steal session tokens.',
    alternatives: [
      {
        label: 'Sanitise and allow basic formatting',
        summary: 'Keep bold, italics and links in bios by running them through an allow-list HTML sanitiser before rendering.',
        before: ['<p class="bio" th:utext="${user.bio}"></p>'],
        after: ['<p class="bio" th:utext="${@htmlSanitizer.basicFormatting(user.bio)}"></p>'],
      },
    ],
  },
  {
    id: 'VULN-105',
    title: 'Path traversal in file import',
    cwe: 'CWE-22',
    cweName: 'Path traversal',
    severity: 'medium',
    scanner: 'SAST',
    repo: 'ABCD-etl',
    file: 'src/main/java/com/abcd/etl/refdata/FileImportService.java',
    line: 57,
    evidence: [
      { n: 56, text: 'public ImportResult importFile(ImportRequest request) {' },
      { n: 57, text: '    File file = new File(importDir, request.getFileName());', hit: true },
      { n: 58, text: '    return parser.parse(file);' },
    ],
    triage: { verdict: 'fix', confidence: 0.88, exploitability: 'File name comes from the request; "../" escapes the import directory.', reason: 'User-controlled path joined without normalisation.' },
    fix: {
      label: 'Recommended',
      summary: 'Resolve and normalise the path, then refuse anything outside the import directory.',
      before: ['File file = new File(importDir, request.getFileName());'],
      after: [
        'Path file = importDir.resolve(request.getFileName()).normalize();',
        'if (!file.startsWith(importDir)) throw new BadRequestException("Invalid file name");',
      ],
    },
    tests: [
      { id: 'SEC-105-01', title: '"../../etc/passwd" is rejected', kind: 'exploit' },
      { id: 'SEC-105-02', title: 'Files inside the import directory still import', kind: 'regression' },
    ],
    slug: 'path-traversal-file-import',
    impact: ['FR-701', 'FR-702'],
    risk: 'A crafted file name can read files outside the import folder, such as configuration with credentials.',
    alternatives: [
      {
        label: 'Allow-list file names',
        summary: 'Accept only simple file names (letters, digits, dashes, .csv) and reject anything with a path separator.',
        before: ['File file = new File(importDir, request.getFileName());'],
        after: ['String name = FileNames.requireSimpleCsvName(request.getFileName());', 'File file = new File(importDir, name);'],
      },
    ],
  },
  {
    id: 'VULN-106',
    title: 'MD5 used in TokenUtil',
    cwe: 'CWE-327',
    cweName: 'Broken or risky crypto',
    severity: 'low',
    scanner: 'SAST',
    repo: 'ABCD-service',
    file: 'src/main/java/com/abcd/notify/TokenUtil.java',
    line: 31,
    evidence: [
      { n: 30, text: '// cache key for rendered templates' },
      { n: 31, text: 'String key = DigestUtils.md5Hex(templateId + locale);', hit: true },
    ],
    triage: { verdict: 'false_positive', confidence: 0.86, exploitability: 'Not reachable as a security control.', reason: 'MD5 builds a cache key; no secret, signature or integrity check depends on it.' },
    fix: { label: 'Recommended', summary: 'No fix proposed. Dismiss as a false positive, or switch to SHA-256 if your policy bans MD5 outright.', before: [], after: [] },
    tests: [],
    slug: 'md5-cache-key',
    impact: [],
    risk: 'Low risk here: MD5 only builds a cache key, so collisions would at worst serve a stale template, not expose data.',
    alternatives: [
      {
        label: 'Switch to SHA-256 anyway',
        summary: 'If policy bans MD5 outright, use SHA-256 for the cache key. Behaviour is unchanged apart from the key length.',
        before: ['String key = DigestUtils.md5Hex(templateId + locale);'],
        after: ['String key = DigestUtils.sha256Hex(templateId + locale);'],
      },
    ],
  },
]

export const SEVERITY_ORDER: Severity[] = ['critical', 'high', 'medium', 'low']

export function findingById(id: string) {
  return FINDINGS.find((f) => f.id === id)
}

/** Pull CWE and CVE IDs out of whatever the user pasted. */
export function parseIds(text: string): string[] {
  const ids = (text.toUpperCase().match(/\b(CWE-\d{1,4}|CVE-\d{4}-\d{4,7})\b/g) ?? []).map((x) => x.trim())
  return [...new Set(ids)]
}

/** Which findings an imported list matches, and which IDs match nothing. */
export function matchImported(ids: string[]) {
  const matched = FINDINGS.filter((f) => ids.includes(f.cwe) || (f.cve && ids.includes(f.cve))).map((f) => f.id)
  const unmatched = ids.filter((id) => !FINDINGS.some((f) => f.cwe === id || f.cve === id))
  return { matched, unmatched }
}

export function selectedFindings(r: Pick<RemediationState, 'fix'>) {
  return r.fix.map(findingById).filter(Boolean) as Finding[]
}

export function remTests(r: Pick<RemediationState, 'fix' | 'revision'>) {
  const tests = selectedFindings(r).flatMap((f) => f.tests.map((t) => ({ ...t, finding: f.id })))
  if (r.revision > 1 && tests.length) tests.push({ id: 'SEC-REV-01', title: 'Added after code review: negative cases for each fix', kind: 'regression', finding: tests[0].finding })
  return tests
}

/** Requirements the selected fixes touch, in order. */
export function impactedFrs(r: Pick<RemediationState, 'fix'>) {
  return [...new Set(selectedFindings(r).flatMap((f) => f.impact))]
}

/** Impacted requirements without full test evidence in the report. */
export function untestedFrs(frIds: string[]) {
  return frIds.filter((id) => findRequirement(id)?.status !== 'covered')
}

/** Functional tests added on the branch for the coverage gaps. */
export function gapTests(r: Pick<RemediationState, 'coverage'>) {
  return (r.coverage?.closed ?? []).flatMap((id) => testCasesFor(storyFor(id), 1).map((tc) => ({ ...tc, frId: id })))
}

/** What the PR checks run: the security tests, the gap tests, and the existing tests for the impacted requirements. */
export function prCheckCount(r: Pick<RemediationState, 'fix' | 'revision' | 'coverage'>) {
  const existing = impactedFrs(r).filter((id) => findRequirement(id)?.status === 'covered').length
  return remTests(r).length + gapTests(r).length + existing
}

/** Post-merge runs the whole automation suite: ABCD's existing test cases plus everything this remediation added. */
export function fullSuiteCount(r: Pick<RemediationState, 'fix' | 'revision' | 'coverage'>) {
  return REPORT.existingTests + remTests(r).length + gapTests(r).length
}

const PR_BASE: Record<string, number> = { 'ABCD-service': 517, 'ABCD-ui': 233, 'ABCD-batch': 341, 'ABCD-etl': 128, [TEST_REPO]: 486 }

/** One PR per repository the change touches: the components with fixes, and ABCD-TestingScript for gap tests. */
export function remPrs(r: Pick<RemediationState, 'fix' | 'revision' | 'coverage'>) {
  const repos = [...new Set(selectedFindings(r).map((f) => f.repo))]
  if (r.coverage?.closed.length) repos.push(TEST_REPO)
  return repos.map((repo) => ({ repo, number: PR_BASE[repo] + (r.revision - 1) }))
}

/** "ABCD-service PR #517", or "3 PRs" when there are several. */
export function prLabel(r: Pick<RemediationState, 'fix' | 'revision' | 'coverage'>) {
  const prs = remPrs(r)
  return prs.length === 1 ? `${prs[0].repo} PR #${prs[0].number}` : `${prs.length} PRs`
}

/** The approach in use for a finding: 0 = recommended, then the alternatives. */
export function approach(f: Finding, variant = 0): FixApproach {
  return variant <= 0 ? f.fix : f.alternatives[(variant - 1) % f.alternatives.length]
}

export function branchFor(app: string, findingIds: string[]) {
  if (findingIds.length === 1) return `fix/${findingById(findingIds[0])?.slug ?? findingIds[0].toLowerCase()}`
  return `fix/${app.toLowerCase()}-security-findings`
}

/** Recognise a specific finding from chat text: an ID, a CWE/CVE, or what it's called. */
export function findingFromText(text: string): Finding | undefined {
  const t = text.toLowerCase()
  const byId = t.match(/vuln-(\d{3})/)
  if (byId) return findingById(`VULN-${byId[1]}`)
  const ids = parseIds(text)
  const byCode = FINDINGS.filter((f) => ids.includes(f.cwe) || (f.cve && ids.includes(f.cve)))
  if (byCode.length === 1) return byCode[0]
  const words: [RegExp, string][] = [
    [/sql ?injection|order by/, 'VULN-101'],
    [/log4|log4shell|jndi/, 'VULN-102'],
    [/hard-?coded|password|secret|credential/, 'VULN-103'],
    [/xss|cross-site|script/, 'VULN-104'],
    [/path traversal|\.\.\/|file import/, 'VULN-105'],
    [/md5|weak (hash|crypto)/, 'VULN-106'],
  ]
  const hit = words.find(([re]) => re.test(t))
  return hit ? findingById(hit[1]) : undefined
}

export const SEV_LABEL: Record<Severity, string> = { critical: 'Critical', high: 'High', medium: 'Medium', low: 'Low' }
