"use strict";

/*
 * 分组规则层：只操作数据，不接触 DOM。
 *
 * 数据约定：
 * - state.segments 是“清单”的规范顺序，素材入组后仍占着原槽位（原位置），
 *   所以拆组时素材自然回到清单原位，无需额外记录位置。
 * - state.groups 是叠加在清单上的镜头组：memberIds 为组成员，beforeId 是组后
 *   紧邻的那条未入组素材 id，null 表示组在整卷末尾。拖动整组只改锚点。
 * - 一个素材至多属于一个组；组内成员用 backup: true 标为备用，备用条目不占可放时长。
 */

const Grouping = (() => {
  const uid = () => crypto.randomUUID();

  function byId(state, id) {
    return state.segments.find((seg) => seg.id === id) || null;
  }

  function groupOf(state, id) {
    return state.groups.find((group) => group.memberIds.includes(id)) || null;
  }

  function isGrouped(state, id) {
    return Boolean(groupOf(state, id));
  }

  function isBackup(seg) {
    return Boolean(seg && seg.backup === true);
  }

  /* 按清单顺序返回 id（组内顺序同样沿用清单顺序） */
  function idsByListOrder(state, ids) {
    const order = new Map();
    state.segments.forEach((seg, index) => order.set(seg.id, index));
    return ids.filter((id) => order.has(id)).sort((a, b) => order.get(a) - order.get(b));
  }

  function defaultGroupName(state) {
    let n = state.groups.length + 1;
    const used = new Set(state.groups.map((group) => group.name));
    while (used.has(`镜头组 ${n}`)) n += 1;
    return `镜头组 ${n}`;
  }

  /*
   * 展平后的展示块：未入组素材为 {type:"segment"}，镜头组为 {type:"group"}，
   * 顺序就是列表、提醒与导出共同使用的“新顺序”。
   */
  function blocks(state) {
    const anchored = new Map(); // 未入组素材 id -> 排在它前面的组
    const tail = [];
    state.groups.forEach((group) => {
      const anchor = group.beforeId;
      if (anchor && byId(state, anchor) && !groupOf(state, anchor)) {
        if (!anchored.has(anchor)) anchored.set(anchor, []);
        anchored.get(anchor).push(group);
      } else {
        tail.push(group);
      }
    });

    const result = [];
    state.segments.forEach((seg) => {
      if (groupOf(state, seg.id)) return; // 组成员只在组块里出现
      (anchored.get(seg.id) || []).forEach((group) => result.push(groupBlock(state, group)));
      result.push({ type: "segment", segment: seg });
    });
    tail.forEach((group) => result.push(groupBlock(state, group)));
    return result;
  }

  function groupBlock(state, group, memberIds = group.memberIds) {
    return {
      type: "group",
      group,
      members: memberIds.map((id) => byId(state, id)).filter(Boolean)
    };
  }

  /* 应用筛选：未命中的散条被隐藏；组只要有命中成员就保留，未命中成员折叠计数 */
  function visibleBlocks(state, predicate) {
    return blocks(state)
      .map((block) => {
        if (block.type === "segment") {
          return predicate(block.segment) ? block : null;
        }
        const members = block.members.filter(predicate);
        if (members.length === 0) return null;
        return { ...block, members, hiddenCount: block.members.length - members.length };
      })
      .filter(Boolean);
  }

  /* 展平后的素材 id 顺序（编号、提醒、导出按此顺序） */
  function displayOrder(state) {
    return blocks(state).flatMap((block) =>
      block.type === "segment" ? [block.segment.id] : block.members.map((seg) => seg.id)
    );
  }

  /* 勾选未入组素材建成一组，组放在最早一条入选素材的位置；已有组位置不动 */
  function createGroup(state, ids, name) {
    const memberIds = idsByListOrder(
      state,
      ids.filter((id) => byId(state, id) && !groupOf(state, id))
    );
    if (memberIds.length === 0) return null;

    const oldBlocks = blocks(state);
    const group = { id: uid(), name: name || defaultGroupName(state), memberIds, beforeId: null };
    const memberSet = new Set(memberIds);

    const next = oldBlocks.filter((block) => !(block.type === "segment" && memberSet.has(block.segment.id)));
    const firstSlot = oldBlocks.findIndex((block) => block.type === "segment" && memberSet.has(block.segment.id));
    next.splice(firstSlot < 0 ? next.length : firstSlot, 0, groupBlock(state, group, memberIds));

    state.groups.push(group);
    commit(state, next);
    return group;
  }

  /* 把勾选的散条追加进已有组；其他组（含锚点被占用的）位置一律不动 */
  function addMembers(state, groupId, ids) {
    const group = state.groups.find((item) => item.id === groupId);
    if (!group) return [];
    const memberIds = idsByListOrder(
      state,
      ids.filter((id) => byId(state, id) && !groupOf(state, id))
    );
    if (memberIds.length === 0) return [];

    // 先按改动前的布局重建：入选散条块删掉，目标组块用展开后的成员替换，别的组不动
    const addSet = new Set(memberIds);
    const mergedIds = idsByListOrder(state, [...group.memberIds, ...memberIds]);
    const next = blocks(state).flatMap((block) => {
      if (block.type === "segment") return addSet.has(block.segment.id) ? [] : [block];
      if (block.group.id === groupId) return [groupBlock(state, group, mergedIds)];
      return [block];
    });

    group.memberIds = mergedIds;
    commit(state, next);
    return memberIds;
  }

  /* 单条移出组：清单槽位从未动过，立刻回到原位置 */
  function removeMember(state, groupId, id) {
    const group = state.groups.find((item) => item.id === groupId);
    if (!group || !group.memberIds.includes(id)) return;
    group.memberIds = group.memberIds.filter((memberId) => memberId !== id);
    if (group.memberIds.length === 0) {
      state.groups = state.groups.filter((item) => item.id !== groupId);
    }
  }

  /* 整组拆开：所有成员按清单原位置回到散条区 */
  function dissolveGroup(state, groupId) {
    state.groups = state.groups.filter((group) => group.id !== groupId);
  }

  /* 列表拖动：组块与散条都作为最小整块移动 */
  function moveBlock(state, drag, target) {
    const next = blocks(state);
    const from = next.findIndex((block) => matchesBlock(block, drag.kind, drag.id));
    const to = next.findIndex((block) => matchesBlock(block, target.kind, target.id));
    if (from < 0 || to < 0 || from === to) return;

    const [block] = next.splice(from, 1);
    const targetNow = next.findIndex((item) => matchesBlock(item, target.kind, target.id));
    const insertAt = targetNow + (target.edge === "after" ? 1 : 0);
    next.splice(insertAt, 0, block);
    commit(state, next);
  }

  function matchesBlock(block, kind, id) {
    return block.type === kind && (kind === "group" ? block.group.id === id : block.segment.id === id);
  }

  /*
   * 把展平块写回状态：
   * - 组的锚点由“它后面紧邻的散条”倒推，连续多组共用同一锚点；
   * - 散条按展示顺序写回清单中的非组员槽位，组员的清单槽位保持不动。
   */
  function commit(state, nextBlocks) {
    const groupedIds = new Set(state.groups.flatMap((group) => group.memberIds));
    const loose = nextBlocks.filter((block) => block.type === "segment").map((block) => block.segment.id);

    let cursor = 0;
    state.segments = state.segments.map((seg) =>
      groupedIds.has(seg.id) ? seg : byId(state, loose[cursor++])
    );

    const orderedGroups = [];
    let pendingAnchor = null;
    for (let i = nextBlocks.length - 1; i >= 0; i -= 1) {
      const block = nextBlocks[i];
      if (block.type === "segment") {
        pendingAnchor = block.segment.id;
      } else {
        block.group.beforeId = pendingAnchor;
        orderedGroups.unshift(block.group);
      }
    }
    state.groups = orderedGroups;
  }

  function toggleBackup(state, id) {
    const seg = byId(state, id);
    if (!seg) return;
    seg.backup = !seg.backup;
  }

  function renameGroup(state, groupId, name) {
    const group = state.groups.find((item) => item.id === groupId);
    if (group) group.name = name;
  }

  function groupTotals(state, group) {
    let usable = 0;
    let backup = 0;
    group.memberIds.forEach((id) => {
      const seg = byId(state, id);
      if (!seg) return;
      if (isBackup(seg)) backup += Number(seg.duration) || 0;
      else usable += Number(seg.duration) || 0;
    });
    const backupCount = group.memberIds.filter((id) => isBackup(byId(state, id))).length;
    return { usable, backup, count: group.memberIds.length, backupCount };
  }

  function reelTotals(state) {
    let usable = 0;
    let backup = 0;
    state.segments.forEach((seg) => {
      if (isBackup(seg)) backup += Number(seg.duration) || 0;
      else usable += Number(seg.duration) || 0;
    });
    const backupCount = state.segments.filter(isBackup).length;
    return { usable, backup, count: state.segments.length, backupCount };
  }

  /* 删除素材：同步退出所在组；空组清除；被删素材若正是某组锚点，锚点顺延 */
  function deleteSegment(state, id) {
    const next = blocks(state)
      .filter((block) => {
        if (block.type === "segment") return block.segment.id !== id;
        return block.group.id !== groupOf(state, id)?.id || block.members.length > 1;
      })
      .map((block) =>
        block.type === "group"
          ? groupBlock(
              state,
              block.group,
              block.group.memberIds.filter((memberId) => memberId !== id)
            )
          : block
      );

    state.segments = state.segments.filter((seg) => seg.id !== id);
    state.groups = state.groups
      .map((group) => ({ ...group, memberIds: group.memberIds.filter((memberId) => memberId !== id) }))
      .filter((group) => group.memberIds.length > 0);
    commit(state, next);
  }

  return {
    byId,
    groupOf,
    isGrouped,
    isBackup,
    blocks,
    visibleBlocks,
    displayOrder,
    createGroup,
    addMembers,
    removeMember,
    dissolveGroup,
    moveBlock,
    toggleBackup,
    renameGroup,
    groupTotals,
    reelTotals,
    deleteSegment
  };
})();
