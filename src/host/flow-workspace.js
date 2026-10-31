import path from 'node:path'
import { lstat, mkdir, realpath } from 'node:fs/promises'

export const FLOW_WORKSPACE_NAME = '流程工作区'
const canonical = value => process.platform === 'win32' ? path.resolve(value).toLowerCase() : path.resolve(value)
const inside = (parent, child) => {
  const relative = path.relative(canonical(parent), canonical(child))
  return relative === '' || (relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative))
}

export function createFlowWorkspaceManager({ getRegistry }) {
  // Serialize registrations across different browser windows and flow buttons.
  let tail = Promise.resolve()
  async function ensure(kbPath) {
    const registry = getRegistry()
    if (!registry || typeof registry.resolveByPath !== 'function' || typeof registry.create !== 'function' || typeof registry.list !== 'function') {
      throw new Error('宿主工作区服务尚未就绪，未创建流程会话')
    }
    const library = await realpath(kbPath)
    const directory = path.join(path.dirname(library), FLOW_WORKSPACE_NAME)
    if (inside(library, directory)) throw new Error('无法在知识库外建立同级流程工作区：请将知识库放在独立子文件夹中')
    // Check the global display name before touching the filesystem or registering.
    const named = registry.list().find(item => item.title === FLOW_WORKSPACE_NAME)
    if (named && canonical(named.path) !== canonical(directory)) {
      throw new Error('已有同名「流程工作区」指向其他位置：' + named.path + '。请先重命名该工作区，避免流程写错位置')
    }
    try { await mkdir(directory) } catch (error) { if (error.code !== 'EEXIST') throw new Error('无法创建流程工作区目录：' + error.message) }
    const info = await lstat(directory)
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('流程工作区路径已被文件或目录链接占用：' + directory)
    const resolved = await realpath(directory)
    if (inside(library, resolved) || canonical(resolved) !== canonical(directory)) throw new Error('流程工作区实际路径不符合知识库同级目录要求')
    let workspace = await registry.resolveByPath(directory)
    if (!workspace) workspace = await registry.create(directory)
    if (!workspace || !workspace.id || canonical(workspace.path) !== canonical(directory)) throw new Error('宿主未返回正确的流程工作区，未创建会话')
    if (workspace.title !== FLOW_WORKSPACE_NAME) {
      if (typeof workspace.setTitle !== 'function') throw new Error('宿主无法设置流程工作区名称，未创建会话')
      await workspace.setTitle(FLOW_WORKSPACE_NAME)
    }
    return { workspaceId: workspace.id, workspaceName: FLOW_WORKSPACE_NAME, workspacePath: resolved }
  }
  return {
    ensure(kbPath) {
      const current = tail.catch(() => {}).then(() => ensure(kbPath))
      tail = current
      return current
    },
  }
}

export async function prepareFlowConversation(engine, workspaceManager, input) {
  const prepared = await engine.prepareConversation(input)
  if (!prepared.ok) return prepared
  const kbPath = prepared.kbPath || prepared.cwd
  const workspace = await workspaceManager.ensure(kbPath)
  const prompt = prepared.flowId === 'builtin-inbox-organize' ? prepared.prompt : [prepared.prompt, '', '【执行目录】',
    '本会话工作区：' + workspace.workspacePath,
    '知识库绝对路径：' + kbPath,
    '草稿、下载和临时文件保存在流程工作区。知识库操作使用知识库工具或上述绝对路径，不要将当前工作区误当成知识库。',
    '最终成果仍按流程输出规则落库。',
  ].join('\n')
  return { ...prepared, ...workspace, cwd: workspace.workspacePath, prompt }
}
