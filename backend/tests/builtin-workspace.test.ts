import assert from 'node:assert/strict'
import { test } from 'node:test'
import { skillsManagerWorkspace, skillWorkspaces } from '../src/agents/skills.js'
import { agentCatalog } from '../src/agents/catalog.js'

test('all published built-in workspaces reject actual file mutations', async () => {
  const filesystems = [skillsManagerWorkspace, ...Object.values(skillWorkspaces)].map(workspace => workspace.filesystem!)
  for (const filesystem of filesystems) {
    assert.equal(filesystem.readOnly, true)
    await assert.rejects(filesystem.writeFile('write-must-fail.txt', 'forbidden'), /read.only/i)
    await assert.rejects(filesystem.appendFile('write-must-fail.txt', 'forbidden'), /read.only/i)
    await assert.rejects(filesystem.mkdir('directory-must-fail'), /read.only/i)
  }
})

test('each registered Agent has readable built-in Prompt and Skill files', async () => {
  const filesystem = skillsManagerWorkspace.filesystem!
  for (const [type, definition] of Object.entries(agentCatalog)) {
    const prompt = await filesystem.readFile(`prompts/${type}.md`, { encoding: 'utf-8' })
    assert.ok(String(prompt).trim().length > 0)
    for (const prefix of definition.skillPrefixes) {
      const content = await filesystem.readFile(`skills/${prefix}/SKILL.md`, { encoding: 'utf-8' })
      assert.ok(String(content).trim().length > 0)
    }
  }
})
