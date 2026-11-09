import { ManifestError, type Parsed, list, obj, path, run, slug, str } from './contentPack'

/**
 * Courses: a pack's course.json arranges topics into stages and tracks, with
 * prerequisite edges between topics, a checkpoint at the end of each stage,
 * and a milestone checklist. The app draws it, gates topics softly on their
 * prerequisites' consolidation, and starts a topic's sittings; every grade
 * and every node state stays the engine's. See docs/content-packs.md.
 *
 * Pure: main's loader, the renderer and the tests share it.
 */

/** The fraction of a prerequisite's nodes that must be consolidated before a topic opens without a warning. */
export const DEFAULT_PREREQ_THRESHOLD = 0.6
export const MAX_STAGES = 8
export const MAX_TRACKS = 10
export const MAX_COURSE_TOPICS = 200
export const MAX_PARTS = 24
export const MAX_READINGS = 12
/** The engine's curriculum architect keeps a topic to 20 nodes; a prepared map must too. */
export const MAX_GRAPH_NODES = 20

/** Engram topic slug as the app uses it elsewhere (map annotations, settings): lowercase kebab. */
const TOPIC_ID = /^[a-z0-9][a-z0-9-]{0,63}$/

export function isCourseTopicId(v: unknown): v is string {
  return typeof v === 'string' && TOPIC_ID.test(v)
}

export type EvidenceManifest =
  /** A lab milestone whose core tests passed. */
  | { kind: 'lab'; lab: string; milestone: string }
  /** A topic with at least this fraction of its nodes consolidated, by the engine's own node states. */
  | { kind: 'topic'; topic: string; consolidated: number }
  /** The learner ticks it, with a one-line note. */
  | { kind: 'attested' }
  /** The learner ticks it and attaches a link. */
  | { kind: 'link' }

export interface PartManifest {
  id: string
  label: string
  evidence: EvidenceManifest
}

export interface ReadingManifest {
  title: string
  url: string | null
  note: string
}

export interface CourseTopicManifest {
  id: string
  title: string
  summary: string
  /** Topics that should be consolidated first. Soft: the learner can start anyway. */
  requires: string[]
  /** A prepared concept map (the engine's add-topic JSON), inside the pack. */
  graph: string | null
  /** A Markdown outline for the curriculum architect, inside the pack, when there is no prepared map. */
  outline: string | null
  /** Lab ids in this pack that belong to the topic. */
  labs: string[]
  readings: ReadingManifest[]
}

export interface TrackManifest {
  id: string
  title: string
  topics: string[]
}

export interface StageManifest {
  id: string
  title: string
  goal: string
  tracks: TrackManifest[]
  /** What must be shown to leave the stage. Every part needs a passing record. */
  checkpoint: { title: string; parts: PartManifest[] } | null
  /** The stage's milestone checklist. */
  milestones: PartManifest[]
}

export interface CourseManifest {
  id: string
  title: string
  summary: string
  /** Fraction of a prerequisite's nodes that must be consolidated for its dependents to open quietly. */
  threshold: number
  stages: StageManifest[]
  topics: Record<string, CourseTopicManifest>
}

function topicId(v: unknown, where: string): string {
  if (!isCourseTopicId(v))
    throw new ManifestError(`${where} must be a topic id: lowercase letters, digits and dashes, up to 64`)
  return v
}

function evidence(raw: unknown, where: string): EvidenceManifest {
  const o = obj(raw, where)
  switch (o.kind) {
    case 'lab':
      return { kind: 'lab', lab: slug(o, 'lab', where), milestone: slug(o, 'milestone', where) }
    case 'topic': {
      const c = o.consolidated === undefined ? 0.8 : o.consolidated
      if (typeof c !== 'number' || !(c > 0 && c <= 1))
        throw new ManifestError(`${where}: "consolidated" must be a fraction above 0 and at most 1`)
      return { kind: 'topic', topic: topicId(o.topic, `${where} topic`), consolidated: c }
    }
    case 'attested':
      return { kind: 'attested' }
    case 'link':
      return { kind: 'link' }
    default:
      throw new ManifestError(`${where}: "kind" must be lab, topic, attested or link`)
  }
}

function parts(o: Record<string, unknown>, key: string, where: string, ids: Set<string>): PartManifest[] {
  return list(o, key, where, MAX_PARTS).map((raw, i) => {
    const w = `${where} ${key}[${i}]`
    const p = obj(raw, w)
    const id = slug(p, 'id', w)
    if (ids.has(id)) throw new ManifestError(`${w}: the id ${id} is used twice in the course`)
    ids.add(id)
    return { id, label: str(p, 'label', w, { max: 200 }), evidence: evidence(p.evidence, `${w} evidence`) }
  })
}

function readings(o: Record<string, unknown>, where: string): ReadingManifest[] {
  return list(o, 'readings', where, MAX_READINGS).map((raw, i) => {
    const w = `${where} readings[${i}]`
    const r = obj(raw, w)
    const url = str(r, 'url', w, { optional: true, max: 500 })
    if (url && !/^https?:\/\/[^\s]+$/.test(url)) throw new ManifestError(`${w}: "url" must be an http or https link`)
    return {
      title: str(r, 'title', w, { max: 300 }),
      url: url || null,
      note: str(r, 'note', w, { optional: true, max: 400 }),
    }
  })
}

/** Topic ids in an order where every topic comes after the topics it requires; throws on a cycle. */
export function topicOrder(topics: Record<string, { requires: string[] }>): string[] {
  const out: string[] = []
  const state = new Map<string, 'open' | 'done'>()
  const visit = (id: string, trail: string[]) => {
    const s = state.get(id)
    if (s === 'done') return
    if (s === 'open') throw new ManifestError(`course.json: the prerequisites loop: ${[...trail, id].join(' → ')}`)
    state.set(id, 'open')
    for (const r of topics[id]?.requires ?? []) visit(r, [...trail, id])
    state.set(id, 'done')
    out.push(id)
  }
  for (const id of Object.keys(topics)) visit(id, [])
  return out
}

export function parseCourseManifest(raw: unknown): Parsed<CourseManifest> {
  return run(() => {
    const o = obj(raw, 'course.json')
    const threshold = o.threshold === undefined ? DEFAULT_PREREQ_THRESHOLD : o.threshold
    if (typeof threshold !== 'number' || !(threshold > 0 && threshold <= 1))
      throw new ManifestError('course.json: "threshold" must be a fraction above 0 and at most 1')

    const rawTopics = obj(o.topics, 'course.json topics')
    const ids = Object.keys(rawTopics)
    if (ids.length === 0) throw new ManifestError('course.json: "topics" is empty')
    if (ids.length > MAX_COURSE_TOPICS) throw new ManifestError(`course.json: more than ${MAX_COURSE_TOPICS} topics`)
    const topics: Record<string, CourseTopicManifest> = {}
    for (const id of ids) {
      const w = `course.json topic ${id}`
      topicId(id, `course.json: the topic key "${id}"`)
      const t = obj(rawTopics[id], w)
      const requires = list(t, 'requires', w, 20).map((r, i) => topicId(r, `${w} requires[${i}]`))
      const graph = path(t, 'graph', w, true)
      const outline = path(t, 'outline', w, true)
      if (graph && outline) throw new ManifestError(`${w}: give a prepared "graph" or an "outline", not both`)
      topics[id] = {
        id,
        title: str(t, 'title', w, { max: 160 }),
        summary: str(t, 'summary', w, { optional: true, max: 800 }),
        requires,
        graph,
        outline,
        labs: list(t, 'labs', w, 12).map((l, i) => {
          if (typeof l !== 'string') throw new ManifestError(`${w} labs[${i}] must be a lab id`)
          return slug({ l }, 'l', `${w} labs[${i}]`)
        }),
        readings: readings(t, w),
      }
    }
    for (const t of Object.values(topics)) {
      for (const r of t.requires) {
        if (r === t.id) throw new ManifestError(`course.json topic ${t.id} requires itself`)
        if (!topics[r])
          throw new ManifestError(`course.json topic ${t.id} requires ${r}, which the course does not define`)
      }
    }
    topicOrder(topics)

    const partIds = new Set<string>()
    const stageIds = new Set<string>()
    const placed = new Map<string, string>()
    const rawStages = list(o, 'stages', 'course.json', MAX_STAGES)
    if (rawStages.length === 0) throw new ManifestError('course.json: "stages" is empty')
    const stages = rawStages.map((rawStage, si) => {
      const w = `course.json stages[${si}]`
      const s = obj(rawStage, w)
      const id = slug(s, 'id', w)
      if (stageIds.has(id)) throw new ManifestError(`${w}: the stage id ${id} is used twice`)
      stageIds.add(id)
      const trackIds = new Set<string>()
      const tracks = list(s, 'tracks', w, MAX_TRACKS).map((rawTrack, ti) => {
        const tw = `${w} tracks[${ti}]`
        const tr = obj(rawTrack, tw)
        const tid = slug(tr, 'id', tw)
        if (trackIds.has(tid)) throw new ManifestError(`${tw}: the track id ${tid} is used twice in its stage`)
        trackIds.add(tid)
        const tt = list(tr, 'topics', tw, 40).map((x, k) => {
          const t = topicId(x, `${tw} topics[${k}]`)
          if (!topics[t]) throw new ManifestError(`${tw}: the topic ${t} is not defined under "topics"`)
          const where = placed.get(t)
          if (where) throw new ManifestError(`${tw}: the topic ${t} is already placed in ${where}`)
          placed.set(t, `${id}/${tid}`)
          return t
        })
        return { id: tid, title: str(tr, 'title', tw, { max: 120 }), topics: tt }
      })
      let checkpoint: StageManifest['checkpoint'] = null
      if (s.checkpoint !== undefined && s.checkpoint !== null) {
        const c = obj(s.checkpoint, `${w} checkpoint`)
        checkpoint = {
          title: str(c, 'title', `${w} checkpoint`, { max: 160 }),
          parts: parts(c, 'parts', `${w} checkpoint`, partIds),
        }
      }
      return {
        id,
        title: str(s, 'title', w, { max: 160 }),
        goal: str(s, 'goal', w, { optional: true, max: 600 }),
        tracks,
        checkpoint,
        milestones: parts(s, 'milestones', w, partIds),
      }
    })
    const unplaced = ids.filter((t) => !placed.has(t))
    if (unplaced.length) throw new ManifestError(`course.json: topics not placed in any track: ${unplaced.join(', ')}`)
    for (const st of stages) {
      for (const p of [...(st.checkpoint?.parts ?? []), ...st.milestones]) {
        if (p.evidence.kind === 'topic' && !topics[p.evidence.topic])
          throw new ManifestError(
            `course.json: the part ${p.id} names the topic ${p.evidence.topic}, which the course does not define`,
          )
      }
    }
    return {
      id: slug(o, 'id', 'course.json'),
      title: str(o, 'title', 'course.json', { max: 160 }),
      summary: str(o, 'summary', 'course.json', { optional: true, max: 800 }),
      threshold,
      stages,
      topics,
    }
  })
}

/** What main checks in a prepared map before the tutor is pointed at it: its id and size, nothing it says. */
export function checkPreparedGraph(raw: unknown, topicIdWanted: string): string | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return 'The prepared map is not a JSON object.'
  const g = raw as Record<string, unknown>
  if (g.topic !== topicIdWanted)
    return `The prepared map's "topic" is ${JSON.stringify(g.topic)}, not ${topicIdWanted}.`
  if (typeof g.title !== 'string' || !g.title) return 'The prepared map has no title.'
  const nodes = g.nodes
  if (!nodes || typeof nodes !== 'object' || Array.isArray(nodes)) return 'The prepared map has no nodes.'
  const n = Object.keys(nodes).length
  if (n === 0) return 'The prepared map has no nodes.'
  if (n > MAX_GRAPH_NODES) return `The prepared map has ${n} nodes; a topic holds at most ${MAX_GRAPH_NODES}.`
  if (!Array.isArray(g.order)) return 'The prepared map has no "order".'
  return null
}

// ---------------------------------------------------------------------------
// What the app shows: the course, the lab evidence main read, and the
// learner's own records (attestations and "Start anyway").
// ---------------------------------------------------------------------------

export interface Attestation {
  note: string
  url: string | null
  at: string
}

export interface CourseRecords {
  attested: Record<string, Attestation>
  /** Topic id → when the learner started it before its prerequisites were consolidated. */
  startedAnyway: Record<string, { at: string; unmet: string[] }>
}

export interface CourseLabEvidence {
  title: string
  /** Milestone id → when its core tests first passed, or null. */
  passed: Record<string, string | null>
  milestoneTitles: Record<string, string>
}

export interface CourseView {
  packId: string
  packTitle: string
  course: CourseManifest
  labs: Record<string, CourseLabEvidence>
  records: CourseRecords
  /** Problems found loading the course, e.g. a part naming a lab the pack lacks. */
  warnings: string[]
}

export interface CourseLoadError {
  packId: string
  packTitle: string
  error: string
}

export interface CourseList {
  courses: CourseView[]
  errors: CourseLoadError[]
}

/** What Learn needs to start a course topic the engine does not have yet. */
export interface PreparedCourseTopic {
  packId: string
  courseTitle: string
  topicId: string
  title: string
  /** A staged copy of the prepared map, or null. */
  graphPath: string | null
  /** A staged copy of the outline, or null. */
  outlinePath: string | null
}

// ---------------------------------------------------------------------------
// Progress, from the engine's node states. Pure, so the renderer and tests agree.
// ---------------------------------------------------------------------------

export interface TopicStateCounts {
  states: { review: number; learning: number; new: number }
  nodes: number
  retired?: number
  liveStates?: { review: number; learning: number; new: number }
}

/** Consolidated fraction of a topic's live nodes, or null if the engine has no such topic. */
export function consolidation(t: TopicStateCounts | undefined): number | null {
  if (!t) return null
  const s = t.liveStates ?? t.states
  const total = s.review + s.learning + s.new
  if (total <= 0) return 0
  return s.review / total
}

export type Consolidations = (topicId: string) => number | null

export interface Gate {
  open: boolean
  /** Unconsolidated prerequisites, direct and indirect, in the order to take them. */
  path: string[]
}

/**
 * A topic is open when every prerequisite is consolidated past the course's
 * threshold. When it is not, `path` lists what to do first: each unmet
 * prerequisite and, through it, its own unmet prerequisites, prerequisites
 * first. A met prerequisite stops the walk.
 */
export function gateFor(course: CourseManifest, topic: string, cons: Consolidations): Gate {
  const unmet = new Set<string>()
  const walk = (id: string) => {
    for (const r of course.topics[id]?.requires ?? []) {
      if (unmet.has(r)) continue
      const c = cons(r)
      if (c !== null && c >= course.threshold) continue
      unmet.add(r)
      walk(r)
    }
  }
  walk(topic)
  const order = topicOrder(course.topics)
  return { open: unmet.size === 0, path: order.filter((t) => unmet.has(t)) }
}

export interface PartContext {
  cons: Consolidations
  labPassed: (lab: string, milestone: string) => boolean
  attested: (partId: string) => Attestation | undefined
}

export function partMet(p: PartManifest, ctx: PartContext): boolean {
  const e = p.evidence
  switch (e.kind) {
    case 'lab':
      return ctx.labPassed(e.lab, e.milestone)
    case 'topic': {
      const c = ctx.cons(e.topic)
      return c !== null && c >= e.consolidated
    }
    case 'attested':
      return !!ctx.attested(p.id)
    case 'link':
      return !!ctx.attested(p.id)?.url
  }
}

export function partContext(view: CourseView, cons: Consolidations): PartContext {
  return {
    cons,
    labPassed: (lab, m) => !!view.labs[lab]?.passed[m],
    attested: (id) => view.records.attested[id],
  }
}

/** A checkpoint passes only when every part has its record. */
export function checkpointMet(stage: StageManifest, ctx: PartContext): boolean {
  return !!stage.checkpoint && stage.checkpoint.parts.length > 0 && stage.checkpoint.parts.every((p) => partMet(p, ctx))
}

export const ATTEST_NOTE_MAX = 300
