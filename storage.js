"use strict";

/*
 * 保存方式层：只管默认数据、读取迁移和写盘，不关心分组规则与页面交互。
 * 关闭后重新打开仍能恢复，是因为整卷状态（含 groups 与每条 backup 标记）都写在这里。
 */

const FilmStorage = (() => {
  const storageKey = "zfl17-film-strip-desk";

  const fallbackThumbs = ["#d49b35", "#347d89", "#b54d48", "#4d7656", "#6d6378"];

  function defaultState() {
    return {
      reelTitle: "春日试映A卷",
      segments: [
        {
          id: crypto.randomUUID(),
          code: "A-001",
          duration: 18,
          shift: "正常",
          damage: "完好",
          note: "开场街景，节奏平稳，适合保留原顺序。",
          thumb: "",
          backup: false
        },
        {
          id: crypto.randomUUID(),
          code: "A-006",
          duration: 9,
          shift: "偏红",
          damage: "轻微划痕",
          note: "人物近景左侧有划痕，试映时留意是否明显。",
          thumb: "",
          backup: false
        },
        {
          id: crypto.randomUUID(),
          code: "A-012",
          duration: 14,
          shift: "褪色",
          damage: "接片松动",
          note: "接片位置靠近段尾，放映前建议重新压平。",
          thumb: "",
          backup: false
        }
      ],
      groups: []
    };
  }

  function normalize(data) {
    const state = { ...defaultState(), ...data };
    if (!Array.isArray(state.segments)) state.segments = [];
    if (!Array.isArray(state.groups)) state.groups = [];
    state.segments.forEach((seg) => {
      if (typeof seg.backup !== "boolean") seg.backup = false;
    });
    // 清掉引用了不存在素材、或已重复入组的脏数据，保证一个素材至多在一组
    const seen = new Set();
    state.groups = state.groups
      .map((group) => ({
        id: group.id || crypto.randomUUID(),
        name: group.name || "镜头组",
        beforeId: group.beforeId || null,
        memberIds: Array.isArray(group.memberIds) ? group.memberIds : []
      }))
      .filter((group) => {
        group.memberIds = group.memberIds.filter((id) => {
          if (!state.segments.some((seg) => seg.id === id) || seen.has(id)) return false;
          seen.add(id);
          return true;
        });
        return group.memberIds.length > 0;
      });
    return state;
  }

  function load() {
    try {
      const saved = localStorage.getItem(storageKey);
      if (!saved) return defaultState();
      return normalize(JSON.parse(saved));
    } catch {
      return defaultState();
    }
  }

  function save(state) {
    try {
      localStorage.setItem(storageKey, JSON.stringify(state));
    } catch {
      // 缩略图过大等写盘失败时不打断页面操作
    }
  }

  return { storageKey, fallbackThumbs, defaultState, load, save };
})();
