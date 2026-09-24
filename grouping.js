/*
 * 镜头组分组规则（纯逻辑，不接触 DOM / localStorage）
 *
 * 数据结构：
 * state.segments  始终保存全部素材，顺序即“清单原序”
 * state.groups    [{ id, name, members: [{ segmentId, backup, originIndex }] }]
 *   - backup       是否标为备用（备用不占可放时长，但仍留在组里）
 *   - originIndex  入组时在清单中的位置，拆开时按它回清单
 */
(function () {
  function findSegment(state, segmentId) {
    return state.segments.find((segment) => segment.id === segmentId) || null;
  }

  // segmentId -> { groupId, member }
  function membershipIndex(state) {
    const map = new Map();
    state.groups.forEach((group) => {
      group.members.forEach((member) => map.set(member.segmentId, { groupId: group.id, member }));
    });
    return map;
  }

  function memberRecords(state, group, predicate) {
    return group.members
      .map((member) => ({ ...member, segment: findSegment(state, member.segmentId) }))
      .filter((record) => record.segment && (!predicate || predicate(record.segment, group)));
  }

  function blockKey(block) {
    return block.type === "segment" ? `segment:${block.segment.id}` : `group:${block.group.id}`;
  }

  /*
   * 按当前清单顺序展开成“块”序列：未入组素材是单块，镜头组是整块，
   * 组块锚定在组内最早出现的成员位置（建组/拖动后成员始终相邻，
   * 即使被筛选或拆开恢复打乱，渲染也能自愈为整块）。
   * predicate(segment, group) 存在时只保留命中的素材，整组无命中则隐藏。
   */
  function blocks(state, predicate) {
    const owner = membershipIndex(state);
    const result = [];
    const rendered = new Set();

    state.segments.forEach((segment) => {
      const owned = owner.get(segment.id);
      if (!owned) {
        if (!predicate || predicate(segment, null)) {
          result.push({ type: "segment", segment });
        }
        return;
      }
      if (rendered.has(owned.groupId)) return;
      rendered.add(owned.groupId);
      const group = state.groups.find((item) => item.id === owned.groupId);
      const members = memberRecords(state, group, predicate);
      if (members.length) result.push({ type: "group", group, members });
    });

    // 没有任何成员的空组（例如成员被删除）仍显示在末尾，便于改名或拆开
    if (!predicate) {
      state.groups.forEach((group) => {
        if (!rendered.has(group.id)) result.push({ type: "group", group, members: [] });
      });
    }
    return result;
  }

  // 展开为带组信息的素材序列（破损提醒 / 编号 / 导出统一用它）
  function flatten(state) {
    const result = [];
    blocks(state).forEach((block) => {
      if (block.type === "segment") {
        result.push({ segment: block.segment, group: null, member: null });
      } else {
        block.group.members.forEach((member) => {
          const segment = findSegment(state, member.segmentId);
          if (segment) result.push({ segment, group: block.group, member });
        });
      }
    });
    return result;
  }

  // 把选中的素材收拢到首条所在位置，保持清单原序，记下入组前位置
  function createGroup(state, { name, segmentIds }) {
    const owner = membershipIndex(state);
    const ids = [...new Set(segmentIds)].filter(
      (id) => findSegment(state, id) && !owner.has(id)
    );
    if (!ids.length) return null;
    ids.sort(
      (a, b) =>
        state.segments.findIndex((segment) => segment.id === a) -
        state.segments.findIndex((segment) => segment.id === b)
    );

    const anchor = state.segments.findIndex((segment) => segment.id === ids[0]);
    const members = ids.map((id) => ({
      segmentId: id,
      backup: false,
      originIndex: state.segments.findIndex((segment) => segment.id === id)
    }));

    const picked = new Set(ids);
    const segmentById = new Map(state.segments.map((segment) => [segment.id, segment]));
    const remaining = state.segments.filter((segment) => !picked.has(segment.id));
    remaining.splice(anchor, 0, ...ids.map((id) => segmentById.get(id)));
    state.segments = remaining;

    const group = {
      id: crypto.randomUUID(),
      name: name || `镜头组 ${state.groups.length + 1}`,
      members
    };
    state.groups.push(group);
    return group;
  }

  // 按入组前位置依次插回；originIndex 升序回填可还原整张清单的原始排列
  function restorePositions(state, records) {
    [...records]
      .sort((a, b) => a.originIndex - b.originIndex)
      .forEach(({ segmentId, originIndex }) => {
        const from = state.segments.findIndex((segment) => segment.id === segmentId);
        if (from < 0) return;
        const [segment] = state.segments.splice(from, 1);
        const to = Math.min(Math.max(originIndex, 0), state.segments.length);
        state.segments.splice(to, 0, segment);
      });
  }

  // 整组拆开：成员各按原位置回清单
  function disbandGroup(state, groupId) {
    const index = state.groups.findIndex((group) => group.id === groupId);
    if (index < 0) return;
    const [group] = state.groups.splice(index, 1);
    restorePositions(state, group.members);
  }

  // 单条移出本组，按原位置回清单
  function removeMember(state, groupId, segmentId) {
    const group = state.groups.find((item) => item.id === groupId);
    if (!group) return;
    const index = group.members.findIndex((member) => member.segmentId === segmentId);
    if (index < 0) return;
    const [member] = group.members.splice(index, 1);
    restorePositions(state, [member]);
  }

  function toggleBackup(state, groupId, segmentId) {
    const member = state.groups
      .find((group) => group.id === groupId)
      ?.members.find((item) => item.segmentId === segmentId);
    if (!member) return;
    member.backup = !member.backup;
    return member.backup;
  }

  function renameGroup(state, groupId, name) {
    const group = state.groups.find((item) => item.id === groupId);
    if (group && name.trim()) group.name = name.trim();
  }

  // 删除素材时清掉组成员关系
  function pruneSegment(state, segmentId) {
    state.groups.forEach((group) => {
      group.members = group.members.filter((member) => member.segmentId !== segmentId);
    });
  }

  function groupDuration(state, group) {
    let chosen = 0;
    let backup = 0;
    group.members.forEach((member) => {
      const segment = findSegment(state, member.segmentId);
      if (!segment) return;
      if (member.backup) backup += Number(segment.duration) || 0;
      else chosen += Number(segment.duration) || 0;
    });
    return { chosen, backup, total: chosen + backup };
  }

  // 全片可放时长（备用不计）与备用时长
  function screeningTotals(state) {
    let chosen = 0;
    let backup = 0;
    flatten(state).forEach(({ segment, member }) => {
      if (member?.backup) backup += Number(segment.duration) || 0;
      else chosen += Number(segment.duration) || 0;
    });
    return { chosen, backup, total: chosen + backup };
  }

  // 块级移动：拖动时整组作为一个块移动
  function moveBlock(state, fromIndex, toIndex) {
    const all = blocks(state);
    if (
      fromIndex === toIndex ||
      fromIndex < 0 ||
      toIndex < 0 ||
      fromIndex >= all.length ||
      toIndex >= all.length
    ) {
      return;
    }
    const [block] = all.splice(fromIndex, 1);
    all.splice(toIndex, 0, block);
    const segmentById = new Map(state.segments.map((segment) => [segment.id, segment]));
    state.segments = all
      .flatMap((item) =>
        item.type === "segment"
          ? [item.segment.id]
          : item.group.members.map((member) => member.segmentId)
      )
      .map((id) => segmentById.get(id))
      .filter(Boolean);
  }

  function blockIndexOf(state, type, id) {
    return blocks(state).findIndex((block) =>
      type === "segment"
        ? block.type === "segment" && block.segment.id === id
        : block.type === "group" && block.group.id === id
    );
  }

  window.FilmGroups = {
    blocks,
    flatten,
    createGroup,
    disbandGroup,
    removeMember,
    toggleBackup,
    renameGroup,
    pruneSegment,
    groupDuration,
    screeningTotals,
    moveBlock,
    blockIndexOf,
    blockKey
  };
})();
