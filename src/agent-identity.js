// UI and discovery use the saved connection snapshot, not an edited workshop
// configuration: an existing Agent does not move when its workshop is edited.
export const agentPlace = a => a.location === 'mayor' ? 'mayor' : 'workshop';
export const agentPlaceName = a => agentPlace(a) === 'mayor' ? '村長の家（秘書）' : a.connection?.name || '工房';
export function agentIdentity(a) {
  return {
    agentId:a.id, name:a.name, location:agentPlace(a), placeName:agentPlaceName(a),
    role:agentPlace(a)==='mayor'?'secretary':'worker', workshopId:a.workshopId,
    workshopName:a.connection?.name || null, provider:a.provider || 'codex',
    connectionType:a.connection?.connectionType || 'ssh', sshHost:a.connection?.sshHost || null,
    purplemuxUrl:a.connection?.baseUrl || null, cwd:a.cwd,
    workspaceId:a.workspaceId || null, tabId:a.tabId || null,
    state:a.state, connectionState:a.connectionState || 'unknown', lastCheckedAt:a.lastCheckedAt || null,
  };
}
