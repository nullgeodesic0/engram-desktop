import { app } from 'electron'
import { copyFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  ATTEST_NOTE_MAX,
  type CourseLabEvidence,
  type CourseList,
  type CourseManifest,
  type CourseRecords,
  type CourseView,
  type PartManifest,
  type PreparedCourseTopic,
  checkPreparedGraph,
  isCourseTopicId,
  parseCourseManifest,
} from '../../shared/course'
import { milestonePassedAt } from './labStore'
import { type LoadedPack, loadedPacks, resolveInside } from './packStore'

/**
 * Courses, main side. A pack's course.json is read where it sits, like its
 * labs. What this module writes is the learner's own course records under
 * app userData/courses/<pack>/:
 *
 *   records.json            attested milestone parts, and topics started
 *                           before their prerequisites were consolidated
 *   topics/<topic>.graph.json   a staged copy of a prepared concept map
 *   topics/<topic>.outline.md   a staged copy of an outline
 *
 * The staged copies exist so the tutor is pointed at a file the app checked
 * (its topic id and node count) and that cannot change under it mid-sitting.
 * The app never registers a topic itself: the tutor does, inside a sitting,
 * with the engine's own add-topic (see the course-seeded-topic overlay).
 *
 * Doctrine: a pinned writer (D2), to app userData only. Nothing here reads or
 * writes the learning home, and nothing here reads what a map's nodes say:
 * checkPreparedGraph looks at the topic id, the title and the node count.
 */

function courseDir(packId: string): string {
  return join(app.getPath('userData'), 'courses', packId)
}

function recordsPath(packId: string): string {
  return join(courseDir(packId), 'records.json')
}

async function writeAtomic(path: string, text: string): Promise<void> {
  const tmp = `${path}.${process.pid}.tmp`
  await writeFile(tmp, text, 'utf-8')
  await rename(tmp, path)
}

async function readRecords(packId: string): Promise<CourseRecords> {
  try {
    const raw = JSON.parse(await readFile(recordsPath(packId), 'utf-8')) as Partial<CourseRecords>
    return {
      attested: raw.attested && typeof raw.attested === 'object' ? raw.attested : {},
      startedAnyway: raw.startedAnyway && typeof raw.startedAnyway === 'object' ? raw.startedAnyway : {},
    }
  } catch {
    return { attested: {}, startedAnyway: {} }
  }
}

let writing: Promise<unknown> = Promise.resolve()

/** Read-modify-write of one pack's records, one at a time. */
function updateRecords(packId: string, fn: (r: CourseRecords) => void): Promise<CourseRecords> {
  const next = writing.then(async () => {
    const r = await readRecords(packId)
    fn(r)
    await mkdir(courseDir(packId), { recursive: true })
    await writeAtomic(recordsPath(packId), JSON.stringify(r, null, 2))
    return r
  })
  writing = next.catch(() => {})
  return next
}

interface LoadedCourse {
  pack: LoadedPack
  course: CourseManifest
}

async function loadCourse(pack: LoadedPack): Promise<LoadedCourse> {
  const rel = pack.manifest!.course!
  const file = await resolveInside(pack.root!, pack.root!, rel)
  let raw: unknown
  try {
    raw = JSON.parse(await readFile(file, 'utf-8'))
  } catch (e) {
    throw new Error(`${rel} could not be read: ${e instanceof Error ? e.message : String(e)}`)
  }
  const parsed = parseCourseManifest(raw)
  if (!parsed.ok) throw new Error(parsed.error)
  return { pack, course: parsed.value }
}

function packsWithCourses(packs: LoadedPack[]): LoadedPack[] {
  return packs.filter((p) => p.manifest?.course && p.root)
}

async function labEvidence(
  pack: LoadedPack,
  course: CourseManifest,
  warnings: string[],
): Promise<Record<string, CourseLabEvidence>> {
  const wanted = new Map<string, Set<string>>()
  const want = (lab: string, m?: string) => {
    if (!wanted.has(lab)) wanted.set(lab, new Set())
    if (m) wanted.get(lab)!.add(m)
  }
  for (const t of Object.values(course.topics)) for (const l of t.labs) want(l)
  for (const s of course.stages)
    for (const p of [...(s.checkpoint?.parts ?? []), ...s.milestones])
      if (p.evidence.kind === 'lab') want(p.evidence.lab, p.evidence.milestone)
  const out: Record<string, CourseLabEvidence> = {}
  for (const [labId, ms] of wanted) {
    const lab = pack.labs.find((l) => l.manifest.id === labId)
    if (!lab) {
      warnings.push(`The course names the lab ${labId}, which this pack does not have.`)
      continue
    }
    const passed: Record<string, string | null> = {}
    const milestoneTitles: Record<string, string> = {}
    for (const m of lab.manifest.milestones) {
      milestoneTitles[m.id] = m.title
      if (m.hidden) passed[m.id] = await milestonePassedAt(pack.manifest!.id, labId, m.id).catch(() => null)
    }
    for (const m of ms) {
      if (!(m in passed)) warnings.push(`The course names ${labId} ${m}, which is not a milestone with tests.`)
    }
    out[labId] = { title: lab.manifest.title, passed, milestoneTitles }
  }
  return out
}

/** Every added pack's course, with the lab evidence and the learner's records. */
export async function listCourses(): Promise<CourseList> {
  const out: CourseList = { courses: [], errors: [] }
  for (const pack of packsWithCourses(await loadedPacks())) {
    const packId = pack.manifest!.id
    const packTitle = pack.manifest!.title
    try {
      const { course } = await loadCourse(pack)
      const warnings: string[] = []
      for (const t of Object.values(course.topics)) {
        for (const rel of [t.graph, t.outline]) {
          if (rel)
            await resolveInside(pack.root!, pack.root!, rel).catch((e: Error) => warnings.push(`${t.id}: ${e.message}`))
        }
      }
      const view: CourseView = {
        packId,
        packTitle,
        course,
        labs: await labEvidence(pack, course, warnings),
        records: await readRecords(packId),
        warnings,
      }
      out.courses.push(view)
    } catch (e) {
      out.errors.push({ packId, packTitle, error: e instanceof Error ? e.message : String(e) })
    }
  }
  return out
}

async function findCourse(packId: string): Promise<LoadedCourse> {
  const pack = packsWithCourses(await loadedPacks()).find((p) => p.manifest!.id === packId)
  if (!pack) throw new Error(`No added content pack with a course has the id ${packId}.`)
  return loadCourse(pack)
}

/**
 * Stages what the tutor needs to start a course topic: a checked copy of its
 * prepared map, or of its outline. Called when the learner starts a topic the
 * engine does not have yet.
 */
export async function prepareCourseTopic(packId: string, topicId: string): Promise<PreparedCourseTopic> {
  if (!isCourseTopicId(topicId)) throw new Error('That is not a topic id.')
  const { pack, course } = await findCourse(packId)
  const t = course.topics[topicId]
  if (!t) throw new Error(`The course ${course.title} has no topic ${topicId}.`)
  const dir = join(courseDir(packId), 'topics')
  await mkdir(dir, { recursive: true })
  let graphPath: string | null = null
  let outlinePath: string | null = null
  if (t.graph) {
    const src = await resolveInside(pack.root!, pack.root!, t.graph)
    const text = await readFile(src, 'utf-8')
    let raw: unknown
    try {
      raw = JSON.parse(text)
    } catch {
      throw new Error(`${t.graph} is not valid JSON.`)
    }
    const problem = checkPreparedGraph(raw, topicId)
    if (problem) throw new Error(`${t.graph}: ${problem}`)
    graphPath = join(dir, `${topicId}.graph.json`)
    await writeAtomic(graphPath, text)
  } else if (t.outline) {
    const src = await resolveInside(pack.root!, pack.root!, t.outline)
    outlinePath = join(dir, `${topicId}.outline.md`)
    await copyFile(src, outlinePath)
  }
  return { packId, courseTitle: course.title, topicId, title: t.title, graphPath, outlinePath }
}

function findPart(course: CourseManifest, partId: string): PartManifest | null {
  for (const s of course.stages)
    for (const p of [...(s.checkpoint?.parts ?? []), ...s.milestones]) if (p.id === partId) return p
  return null
}

/** The learner ticks an attested part, with a note, and a link for a link part. */
export async function attestPart(
  packId: string,
  partId: string,
  note: string,
  url: string | null,
): Promise<CourseRecords> {
  const { course } = await findCourse(packId)
  const part = findPart(course, partId)
  if (!part) throw new Error(`The course has no milestone ${partId}.`)
  if (part.evidence.kind !== 'attested' && part.evidence.kind !== 'link')
    throw new Error('That milestone ticks itself from its evidence; it cannot be attested.')
  const n = String(note ?? '').trim()
  if (!n) throw new Error('Write a one-line note on what you did.')
  if (n.length > ATTEST_NOTE_MAX) throw new Error(`Keep the note under ${ATTEST_NOTE_MAX} characters.`)
  const u = url ? String(url).trim() : ''
  if (part.evidence.kind === 'link' && !/^https?:\/\/\S+$/.test(u)) throw new Error('Attach an http or https link.')
  if (u && !/^https?:\/\/\S+$/.test(u)) throw new Error('A link must start with http:// or https://.')
  return updateRecords(packId, (r) => {
    r.attested[partId] = { note: n, url: u || null, at: new Date().toISOString() }
  })
}

export async function clearAttestation(packId: string, partId: string): Promise<CourseRecords> {
  await findCourse(packId)
  return updateRecords(packId, (r) => {
    delete r.attested[partId]
  })
}

/** Records that the learner started a topic before its prerequisites were consolidated. */
export async function recordStartAnyway(packId: string, topicId: string, unmet: string[]): Promise<CourseRecords> {
  const { course } = await findCourse(packId)
  if (!course.topics[topicId]) throw new Error(`The course has no topic ${topicId}.`)
  const clean = (Array.isArray(unmet) ? unmet : []).filter((u) => typeof u === 'string' && !!course.topics[u])
  return updateRecords(packId, (r) => {
    r.startedAnyway[topicId] = { at: new Date().toISOString(), unmet: clean }
  })
}
