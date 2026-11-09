import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

const root = mkdtempSync(join(tmpdir(), 'engram-course-'))
const userData = join(root, 'userData')
const packDir = join(root, 'example-pack')
const EXAMPLE = resolve(__dirname, '../../../../examples/example-pack')

vi.mock('electron', () => ({ app: { getPath: () => userData, isPackaged: false } }))

const { addPackFolder, reloadPacks } = await import('./packStore')
const courses = await import('./courseStore')

beforeAll(async () => {
  cpSync(EXAMPLE, packDir, { recursive: true })
  await addPackFolder(packDir)
})
afterAll(() => rmSync(root, { recursive: true, force: true }))

describe('courses', () => {
  it("lists the example pack's course with its lab evidence and empty records", async () => {
    const { courses: list, errors } = await courses.listCourses()
    expect(errors).toEqual([])
    expect(list).toHaveLength(1)
    const [v] = list
    expect(v).toMatchObject({ packId: 'example-pack', warnings: [], records: { attested: {}, startedAnyway: {} } })
    expect(v.course.title).toBe('Linear models')
    expect(v.labs['fit-a-line']).toMatchObject({ title: 'Fitting a line by least squares', passed: { m1: null } })
  })

  it('stages a checked copy of a prepared map, byte for byte', async () => {
    const p = await courses.prepareCourseTopic('example-pack', 'least-squares')
    expect(p).toMatchObject({ topicId: 'least-squares', courseTitle: 'Linear models', outlinePath: null })
    expect(p.graphPath).toBe(join(userData, 'courses', 'example-pack', 'topics', 'least-squares.graph.json'))
    expect(readFileSync(p.graphPath!, 'utf-8')).toBe(
      readFileSync(join(packDir, 'course', 'least-squares.graph.json'), 'utf-8'),
    )
  })

  it('stages an outline when the topic has no map', async () => {
    const p = await courses.prepareCourseTopic('example-pack', 'residuals')
    expect(p.graphPath).toBeNull()
    expect(readFileSync(p.outlinePath!, 'utf-8')).toContain('Reading residuals')
  })

  it('refuses a map whose topic id does not match, and stages nothing for it', async () => {
    const file = join(packDir, 'course', 'least-squares.graph.json')
    const good = readFileSync(file, 'utf-8')
    writeFileSync(file, good.replace('"topic": "least-squares"', '"topic": "something-else"'))
    const staged = join(userData, 'courses', 'example-pack', 'topics', 'least-squares.graph.json')
    rmSync(staged)
    await expect(courses.prepareCourseTopic('example-pack', 'least-squares')).rejects.toThrow(/not least-squares/)
    expect(existsSync(staged)).toBe(false)
    writeFileSync(file, good)
    await expect(courses.prepareCourseTopic('example-pack', '../x')).rejects.toThrow(/not a topic id/)
    await expect(courses.prepareCourseTopic('example-pack', 'nope')).rejects.toThrow(/no topic nope/)
  })

  it('attests a part with a note, a link part only with a link, and never a part with evidence', async () => {
    await expect(courses.attestPart('example-pack', 'fit-passes', 'did it', null)).rejects.toThrow(/cannot be attested/)
    await expect(courses.attestPart('example-pack', 'real-data', '  ', null)).rejects.toThrow(/note/)
    await expect(courses.attestPart('example-pack', 'real-data', 'x'.repeat(301), null)).rejects.toThrow(/under 300/)
    await expect(courses.attestPart('example-pack', 'share-notebook', 'shared', 'ftp://x')).rejects.toThrow(/http/)
    await courses.attestPart('example-pack', 'real-data', 'Fit rainfall against yield', null)
    const r = await courses.attestPart('example-pack', 'share-notebook', 'Sent it', 'https://example.org/nb')
    expect(r.attested['real-data']).toMatchObject({ note: 'Fit rainfall against yield', url: null })
    expect(r.attested['share-notebook']).toMatchObject({ url: 'https://example.org/nb' })
    const after = await courses.clearAttestation('example-pack', 'real-data')
    expect(Object.keys(after.attested)).toEqual(['share-notebook'])
  })

  it('records a start before the prerequisites, keeping only course topics', async () => {
    const r = await courses.recordStartAnyway('example-pack', 'residuals', ['least-squares', 'made-up'])
    expect(r.startedAnyway.residuals.unmet).toEqual(['least-squares'])
    const { courses: list } = await courses.listCourses()
    expect(list[0].records.startedAnyway.residuals.unmet).toEqual(['least-squares'])
  })

  it('serialises concurrent writes so none is lost', async () => {
    await Promise.all([
      courses.attestPart('example-pack', 'real-data', 'one', null),
      courses.recordStartAnyway('example-pack', 'least-squares', []),
      courses.clearAttestation('example-pack', 'share-notebook'),
    ])
    const { courses: list } = await courses.listCourses()
    expect(Object.keys(list[0].records.attested)).toEqual(['real-data'])
    expect(Object.keys(list[0].records.startedAnyway).sort()).toEqual(['least-squares', 'residuals'])
  })

  it('reports a broken course.json as an error on its pack, not a crash', async () => {
    writeFileSync(join(packDir, 'course.json'), '{"id": "x"')
    await reloadPacks()
    const { courses: list, errors } = await courses.listCourses()
    expect(list).toEqual([])
    expect(errors[0]).toMatchObject({ packId: 'example-pack', error: expect.stringMatching(/could not be read/) })
  })
})
