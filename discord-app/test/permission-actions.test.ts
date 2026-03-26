import { describe, expect, it, vi } from 'vitest';

import {
  buildPermissionActionRow,
  buildPermissionResolvedText,
  createPermissionActionId,
  createPermissionActions,
  parsePermissionActionId,
} from '../src/discord/interactions/permission-actions.js';

describe('permission action helpers', () => {
  it('builds and parses action ids', () => {
    const customId = createPermissionActionId({
      threadRecordId: 'thread-1',
      requestId: 'req-1',
      decision: 'approved',
    });

    expect(customId).toBe('perm:approve:thread-1:req-1');
    expect(parsePermissionActionId(customId)).toEqual({
      threadRecordId: 'thread-1',
      requestId: 'req-1',
      decision: 'approved',
    });
  });

  it('returns null for malformed action ids', () => {
    expect(parsePermissionActionId('perm:approve')).toBeNull();
    expect(parsePermissionActionId('other:approve:thread:req')).toBeNull();
  });

  it('builds disabled rows and resolved messages', () => {
    const row = buildPermissionActionRow('thread-1', 'req-1', { disabled: true });
    expect(row.components).toHaveLength(2);
    expect(row.components[0].data.disabled).toBe(true);
    expect(row.components[1].data.disabled).toBe(true);
    expect(buildPermissionResolvedText('Bash', 'approved')).toBe('权限已批准：Bash');
    expect(buildPermissionResolvedText('Bash', 'denied')).toBe('权限已拒绝：Bash');
  });

  it('routes parsed actions into orchestrator', async () => {
    const orchestrator = {
      respondPermission: vi.fn(async () => {}),
      cancelThread: vi.fn(async () => {}),
    };
    const actions = createPermissionActions(orchestrator);

    const handled = await actions.handlePermission('perm:deny:thread-2:req-2');
    expect(handled).toEqual({
      threadRecordId: 'thread-2',
      requestId: 'req-2',
      decision: 'denied',
    });
    expect(orchestrator.respondPermission).toHaveBeenCalledWith('thread-2', {
      requestId: 'req-2',
      decision: 'denied',
    });
  });
});
