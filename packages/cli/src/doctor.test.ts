import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { doctor, renderReport } from './doctor.js'

const dirs: string[] = []

function repo(): string {
  const root = mkdtempSync(join(tmpdir(), 'doctor-'))
  dirs.push(root)
  mkdirSync(join(root, 'skills', 'alpha'), { recursive: true })
  writeFileSync(
    join(root, 'skills', 'alpha', 'SKILL.md'),
    '---\nname: alpha\ndescription: A valid skill for the doctor test suite.\nmetadata:\n  version: 1.0.0\n---\nBody.\n',
    'utf8',
  )
  return root
}

afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

describe('doctor', () => {
  it('passes on a well-formed tree', async () => {
    const report = await doctor(repo())
    expect(report.ok).toBe(true)
    expect(report.checks.find((c) => c.name === 'skills')?.status).toBe('ok')
  })

  it('fails and names a fix when a skill is invalid', async () => {
    const root = repo()
    mkdirSync(join(root, 'skills', 'broken'), { recursive: true })
    writeFileSync(join(root, 'skills', 'broken', 'SKILL.md'), 'no frontmatter', 'utf8')
    const report = await doctor(root)
    expect(report.ok).toBe(false)
    const skills = report.checks.find((c) => c.name === 'skills')
    expect(skills?.status).toBe('fail')
    expect(skills?.fix).toBeTruthy()
  })

  it('warns rather than fails when config is absent', async () => {
    const report = await doctor(repo())
    expect(report.checks.find((c) => c.name === 'config')?.status).toBe('warn')
    expect(report.ok).toBe(true)
  })

  it('renders every check with a status token', async () => {
    const rendered = renderReport(await doctor(repo()))
    expect(rendered).toMatch(/doctor/)
    expect(rendered).toMatch(/[PASS]/)
    expect(rendered).toMatch(/[WARN]/)
  })
})
