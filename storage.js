/*
 * 保存方式：localStorage 读写与迁移，独立于分组规则和页面交互。
 * 旧版存档没有 groups 字段时自动补齐；已删除素材的组成员引用也会清掉。
 */
(function () {
  const storageKey = "zfl17-film-strip-desk";

  function makeDefaultState() {
    const segments = [
      {
        id: crypto.randomUUID(),
        code: "A-001",
        duration: 18,
        shift: "正常",
        damage: "完好",
        note: "开场街景，节奏平稳，适合保留原顺序。",
        thumb: ""
      },
      {
        id: crypto.randomUUID(),
        code: "A-006",
        duration: 9,
        shift: "偏红",
        damage: "轻微划痕",
        note: "人物近景左侧有划痕，试映时留意是否明显。",
        thumb: ""
      },
      {
        id: crypto.randomUUID(),
        code: "A-012",
        duration: 14,
        shift: "褪色",
        damage: "接片松动",
        note: "接片位置靠近段尾，放映前建议重新压平。",
        thumb: ""
      }
    ];

    return {
      reelTitle: "春日试映A卷",
      segments,
      groups: [
        {
          id: crypto.randomUUID(),
          name: "开场全景镜头",
          members: [
            { segmentId: segments[0].id, backup: false, originIndex: 0 },
            { segmentId: segments[1].id, backup: false, originIndex: 1 },
            { segmentId: segments[2].id, backup: true, originIndex: 2 }
          ]
        }
      ]
    };
  }

  function migrate(state) {
    if (!Array.isArray(state.segments)) state.segments = [];
    if (!Array.isArray(state.groups)) state.groups = [];
    const validIds = new Set(state.segments.map((segment) => segment.id));
    state.groups.forEach((group) => {
      if (!group.id) group.id = crypto.randomUUID();
      if (typeof group.name !== "string") group.name = "";
      group.members = (Array.isArray(group.members) ? group.members : [])
        .filter((member) => member && validIds.has(member.segmentId))
        .map((member) => ({
          segmentId: member.segmentId,
          backup: Boolean(member.backup),
          originIndex: Number.isInteger(member.originIndex) ? member.originIndex : 0
        }));
    });
    // 同一素材不能同时属于两组：保留第一次出现的归属
    const seen = new Set();
    state.groups.forEach((group) => {
      group.members = group.members.filter((member) => {
        if (seen.has(member.segmentId)) return false;
        seen.add(member.segmentId);
        return true;
      });
    });
    return state;
  }

  function loadState() {
    const saved = localStorage.getItem(storageKey);
    if (!saved) return makeDefaultState();
    try {
      const parsed = JSON.parse(saved);
      // 旧版存档没有 groups：不继承默认演示组，从空组开始
      if (!Object.prototype.hasOwnProperty.call(parsed, "groups")) parsed.groups = [];
      return migrate({ ...makeDefaultState(), ...parsed });
    } catch {
      return makeDefaultState();
    }
  }

  function saveState(state) {
    localStorage.setItem(storageKey, JSON.stringify(state));
  }

  window.FilmStorage = { storageKey, loadState, saveState };
})();
