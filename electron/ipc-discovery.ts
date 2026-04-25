// IPC handlers for discovering and opening files under
// ~/.claude/agents/ and ~/.claude/skills/. The list-* handlers are
// thin pass-throughs; the open-* handlers add a path-traversal guard
// before delegating to shell.openPath so the renderer can't trick us
// into opening arbitrary files via the IPC surface.

import { ipcMain, shell } from 'electron'
import * as path from 'node:path'
import {
  getAgentsDir,
  getSkillsDir,
  listAgents,
  listSkills,
} from './agents-skills'

export function registerDiscoveryHandlers(): void {
  ipcMain.handle('agents:list', () => listAgents())

  ipcMain.handle('agents:open', async (_event, filePath: string) => {
    // Only open files inside our agents dir, no traversal.
    const resolved = path.resolve(filePath)
    const agentsDir = path.resolve(getAgentsDir())
    if (!resolved.startsWith(agentsDir + path.sep) && resolved !== agentsDir) {
      throw new Error('Refusing to open path outside agents dir')
    }
    const err = await shell.openPath(resolved)
    if (err) throw new Error(err)
  })

  ipcMain.handle('skills:list', () => listSkills())

  ipcMain.handle('skills:open', async (_event, filePath: string) => {
    const resolved = path.resolve(filePath)
    const skillsDir = path.resolve(getSkillsDir())
    if (!resolved.startsWith(skillsDir + path.sep) && resolved !== skillsDir) {
      throw new Error('Refusing to open path outside skills dir')
    }
    const err = await shell.openPath(resolved)
    if (err) throw new Error(err)
  })
}
