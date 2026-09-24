/*
 * 页面交互层：录入、勾选建组、渲染、整块拖动、筛选、破损提醒、导出。
 * 分组规则见 grouping.js，存档读写见 storage.js。
 */
const fallbackThumbs = ["#d49b35", "#347d89", "#b54d48", "#4d7656", "#6d6378"];

let state = FilmStorage.loadState();
const selectedIds = new Set(); // 勾选待建组的素材（未入组才可勾选），仅存在于内存
let dragged = null; // { type: "segment" | "group", id }

const els = {
  reelTitle: document.querySelector("#reelTitle"),
  colorFilter: document.querySelector("#colorFilter"),
  searchInput: document.querySelector("#searchInput"),
  segmentForm: document.querySelector("#segmentForm"),
  codeInput: document.querySelector("#codeInput"),
  durationInput: document.querySelector("#durationInput"),
  shiftInput: document.querySelector("#shiftInput"),
  damageInput: document.querySelector("#damageInput"),
  thumbInput: document.querySelector("#thumbInput"),
  noteInput: document.querySelector("#noteInput"),
  segmentList: document.querySelector("#segmentList"),
  groupForm: document.querySelector("#groupForm"),
  groupNameInput: document.querySelector("#groupNameInput"),
  groupCreateBtn: document.querySelector("#groupCreateBtn"),
  groupSummary: document.querySelector("#groupSummary"),
  warningList: document.querySelector("#warningList"),
  totalDuration: document.querySelector("#totalDuration"),
  damageCount: document.querySelector("#damageCount"),
  segmentCount: document.querySelector("#segmentCount"),
  exportBtn: document.querySelector("#exportBtn")
};

function isFiltering() {
  return els.colorFilter.value !== "all" || els.searchInput.value.trim().length > 0;
}

// 筛选同时作用于素材与其所在镜头组（组名命中关键字时整组保留）
function currentPredicate() {
  const color = els.colorFilter.value;
  const keyword = els.searchInput.value.trim();
  return (segment, group) => {
    const matchesColor = color === "all" || segment.shift === color;
    const haystack = `${segment.code}${segment.note}${segment.damage}${group ? group.name : ""}`;
    const matchesKeyword = !keyword || haystack.includes(keyword);
    return matchesColor && matchesKeyword;
  };
}

function renderStats() {
  const total = state.segments.reduce((sum, item) => sum + Number(item.duration), 0);
  const damaged = state.segments.filter((item) => item.damage !== "完好").length;
  els.totalDuration.textContent = formatDuration(total);
  els.damageCount.textContent = damaged;
  els.segmentCount.textContent = state.segments.length;
}

function segmentCardHtml(item, realIndex, options) {
  const hasDamage = item.damage !== "完好";
  const checkbox = options.selectable
    ? `<label class="select-check" title="勾选后在右侧建成同一镜头组">
         <input type="checkbox" data-select="${item.id}" ${selectedIds.has(item.id) ? "checked" : ""} />
       </label>`
    : "";
  const titlePrefix = options.titlePrefix ? `${options.titlePrefix} ` : "";
  const badge = options.backup ? `<span class="tag backup">备用</span>` : "";
  const dragAttr = options.draggable ? `draggable="true"` : "";
  const cardClass = options.selectable ? "segment-card loose" : "segment-card member-card";

  let actions = "";
  if (options.selectable) {
    actions = `
      <div class="segment-actions">
        <button type="button" title="上移" data-move-up="${item.id}">↑</button>
        <button type="button" title="下移" data-move-down="${item.id}">↓</button>
        <button type="button" title="删除" data-delete="${item.id}">×</button>
      </div>`;
  } else {
    actions = `
      <div class="segment-actions member-actions">
        <button type="button" data-group="${options.groupId}" data-toggle-backup="${item.id}">
          ${options.backup ? "取消备用" : "标备用"}
        </button>
        <button type="button" title="拆出本组，按原位置回清单" data-group="${options.groupId}" data-leave="${item.id}">⇤</button>
        <button type="button" title="删除" data-delete="${item.id}">×</button>
      </div>`;
  }

  return `
    <article class="${cardClass}" ${dragAttr} data-id="${item.id}">
      ${checkbox}
      <div class="thumb">
        ${
          item.thumb
            ? `<img src="${item.thumb}" alt="${escapeHtml(item.code)}缩略图" />`
            : `<div class="film-placeholder" style="background:${fallbackThumbs[realIndex % fallbackThumbs.length]}">${escapeHtml(item.code)}</div>`
        }
      </div>
      <div class="segment-main">
        <div class="segment-title">
          <strong>${titlePrefix}${escapeHtml(item.code)}</strong>
          <span>${formatDuration(item.duration)}</span>
          ${badge}
        </div>
        <div class="tag-row">
          <span class="tag">${escapeHtml(item.shift)}</span>
          <span class="tag ${hasDamage ? "damage" : "ok"}">${escapeHtml(item.damage)}</span>
        </div>
        <p class="segment-note">${escapeHtml(item.note || "没有备注。")}</p>
      </div>
      ${actions}
    </article>
  `;
}

function groupBlockHtml(block, groupNumber, dragEnabled) {
  const { group } = block;
  const durations = FilmGroups.groupDuration(state, group);
  const members =
    block.members
      .map((record, index) => {
        const realIndex = state.segments.findIndex((segment) => segment.id === record.segmentId);
        return segmentCardHtml(record.segment, realIndex, {
          groupId: group.id,
          backup: record.backup,
          titlePrefix: `组内 ${index + 1}.`,
          draggable: false
        });
      })
      .join("") || `<p class="empty">组内已无素材，拆开即可移除本组。</p>`;

  const backupNote =
    durations.backup > 0
      ? `<span class="group-meta backup-meta">备用 ${formatDuration(durations.backup)} 不占时长</span>`
      : "";

  return `
    <div class="group-block" data-group-id="${group.id}">
      <div class="group-head" ${dragEnabled ? `draggable="true" data-group-drag="${group.id}"` : ""}>
        <span class="group-grip" aria-hidden="true">⠿</span>
        <div class="group-head-main">
          <strong>镜头组 ${groupNumber}｜${escapeHtml(group.name)}</strong>
          <span class="group-meta">${group.members.length} 条 · 选用合计 ${formatDuration(durations.chosen)}</span>
          ${backupNote}
        </div>
        <div class="segment-actions">
          <button type="button" title="整组上移" data-group-up="${group.id}">↑</button>
          <button type="button" title="整组下移" data-group-down="${group.id}">↓</button>
          <button type="button" title="拆开本组，素材按原位置回清单" data-disband="${group.id}">拆开</button>
        </div>
      </div>
      <div class="group-members">${members}</div>
    </div>
  `;
}

function renderList() {
  const filtering = isFiltering();
  const list = filtering ? FilmGroups.blocks(state, currentPredicate()) : FilmGroups.blocks(state);

  if (!list.length) {
    els.segmentList.innerHTML = `<p class="empty">没有符合筛选的片段。</p>`;
    return;
  }

  // 显示序号：散条按整体位置编号
  let loosePosition = 0;
  const looseNumber = new Map();
  list.forEach((block) => {
    if (block.type === "segment") {
      loosePosition += 1;
      looseNumber.set(block.segment.id, loosePosition);
    } else {
      loosePosition += block.members.length;
    }
  });

  els.segmentList.innerHTML = list
    .map((block) => {
      if (block.type === "segment") {
        const realIndex = state.segments.findIndex((segment) => segment.id === block.segment.id);
        return segmentCardHtml(block.segment, realIndex, {
          selectable: true,
          draggable: !filtering,
          titlePrefix: `${looseNumber.get(block.segment.id)}.`
        });
      }
      const groupNumber = state.groups.findIndex((group) => group.id === block.group.id) + 1;
      return groupBlockHtml(block, groupNumber, !filtering);
    })
    .join("");
}

function renderGroupsPanel() {
  els.groupCreateBtn.textContent = `建成一组（已选 ${selectedIds.size} 条）`;

  if (!state.groups.length) {
    els.groupSummary.innerHTML = `<p class="empty">还没有镜头组，先在清单里勾选同一镜头的素材。</p>`;
    return;
  }

  els.groupSummary.innerHTML = state.groups
    .map((group, index) => {
      const durations = FilmGroups.groupDuration(state, group);
      const backup =
        durations.backup > 0 ? `<span>备用 ${formatDuration(durations.backup)}</span>` : "";
      return `
        <div class="group-summary-item" data-group-id="${group.id}">
          <input class="group-name-input" value="${escapeHtml(group.name)}" aria-label="镜头组 ${index + 1} 名称" data-group-rename="${group.id}" />
          <span class="group-meta">${group.members.length} 条 · 选用 ${formatDuration(durations.chosen)}</span>
          ${backup}
          <button type="button" data-disband="${group.id}">拆开</button>
        </div>
      `;
    })
    .join("");
}

function renderWarnings() {
  // 沿用分组后的新顺序
  const warnings = FilmGroups.flatten(state).filter(
    ({ segment }) => segment.damage !== "完好" || segment.shift !== "正常"
  );
  els.warningList.innerHTML =
    warnings
      .map(({ segment, group, member }, index) => {
        const reasons = [
          segment.shift !== "正常" ? segment.shift : "",
          segment.damage !== "完好" ? segment.damage : ""
        ]
          .filter(Boolean)
          .join(" · ");
        const belonging = group
          ? `（${escapeHtml(group.name)}${member.backup ? "·备用" : ""}）`
          : "";
        return `
          <div class="warning-item">
            <strong>${index + 1}. ${escapeHtml(segment.code)} ${belonging}</strong>
            <span>${escapeHtml(reasons)}${segment.note ? `：${escapeHtml(segment.note)}` : ""}</span>
          </div>
        `;
      })
      .join("") || `<p class="empty">当前清单没有颜色偏移或破损提醒。</p>`;
}

function renderAll() {
  FilmStorage.saveState(state);
  els.reelTitle.value = state.reelTitle;
  renderStats();
  renderList();
  renderGroupsPanel();
  renderWarnings();
}

function formatDuration(seconds) {
  const value = Number(seconds) || 0;
  const minutes = Math.floor(value / 60);
  const rest = String(value % 60).padStart(2, "0");
  return `${minutes}:${rest}`;
}

function readFileAsDataUrl(file) {
  return new Promise((resolve) => {
    if (!file) {
      resolve("");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => resolve("");
    reader.readAsDataURL(file);
  });
}

async function addSegment(event) {
  event.preventDefault();
  const thumb = await readFileAsDataUrl(els.thumbInput.files[0]);
  state.segments.push({
    id: crypto.randomUUID(),
    code: els.codeInput.value.trim(),
    duration: Number(els.durationInput.value),
    shift: els.shiftInput.value,
    damage: els.damageInput.value,
    note: els.noteInput.value.trim(),
    thumb
  });
  els.segmentForm.reset();
  els.durationInput.value = 12;
  renderAll();
}

function deleteSegment(id) {
  state.segments = state.segments.filter((item) => item.id !== id);
  FilmGroups.pruneSegment(state, id);
  selectedIds.delete(id);
}

function exportList() {
  const totals = FilmGroups.screeningTotals(state);
  const lines = [
    `胶片卷：${state.reelTitle || "未命名胶片卷"}`,
    `可放时长：${formatDuration(totals.chosen)}（备用 ${formatDuration(totals.backup)} 不占时长）`,
    `总时长：${formatDuration(totals.total)}`,
    ""
  ];

  let position = 0;
  FilmGroups.blocks(state).forEach((block) => {
    if (block.type === "segment") {
      position += 1;
      lines.push(segmentExportLine(position, block.segment, null, null));
      return;
    }
    const durations = FilmGroups.groupDuration(state, block.group);
    lines.push(
      `【镜头组：${block.group.name}】选用合计 ${formatDuration(durations.chosen)}` +
        (durations.backup ? `，备用 ${formatDuration(durations.backup)} 不占时长` : "")
    );
    block.group.members.forEach((member) => {
      const segment = state.segments.find((item) => item.id === member.segmentId);
      if (!segment) return;
      position += 1;
      lines.push(
        "  " + segmentExportLine(position, segment, block.group, member.backup)
      );
    });
  });

  const blob = new Blob([lines.join("\n")], { type: "text/plain;charset=utf-8" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `${state.reelTitle || "film-reel"}-checklist.txt`;
  link.click();
  URL.revokeObjectURL(link.href);
}

function segmentExportLine(position, item, group, backup) {
  const belonging = group ? `｜镜头组：${group.name}${backup ? "｜备用" : ""}` : "";
  return `${position}. ${item.code}｜${formatDuration(item.duration)}｜${item.shift}｜${item.damage}${belonging}｜${item.note || "无备注"}`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

// ---------- 事件 ----------

els.reelTitle.addEventListener("input", () => {
  state.reelTitle = els.reelTitle.value;
  FilmStorage.saveState(state);
});
els.colorFilter.addEventListener("change", renderList);
els.searchInput.addEventListener("input", renderList);
els.segmentForm.addEventListener("submit", addSegment);
els.exportBtn.addEventListener("click", exportList);

els.groupForm.addEventListener("submit", (event) => {
  event.preventDefault();
  if (!selectedIds.size) return;
  FilmGroups.createGroup(state, {
    name: els.groupNameInput.value.trim(),
    segmentIds: [...selectedIds]
  });
  selectedIds.clear();
  els.groupForm.reset();
  renderAll();
});

function handleListClick(event) {
  const target = event.target.closest("button, input");
  if (!target) return;

  const disband = target.closest("[data-disband]");
  if (disband) {
    FilmGroups.disbandGroup(state, disband.dataset.disband);
    renderAll();
    return;
  }

  if (target.matches("[data-select]")) {
    if (target.checked) selectedIds.add(target.dataset.select);
    else selectedIds.delete(target.dataset.select);
    renderGroupsPanel();
    return;
  }

  const groupUp = target.closest("[data-group-up]");
  const groupDown = target.closest("[data-group-down]");
  if (groupUp || groupDown) {
    const groupId = (groupUp || groupDown).dataset.groupUp || (groupUp || groupDown).dataset.groupDown;
    const index = FilmGroups.blockIndexOf(state, "group", groupId);
    FilmGroups.moveBlock(state, index, index + (groupUp ? -1 : 1));
    renderAll();
    return;
  }

  const up = target.closest("[data-move-up]");
  const down = target.closest("[data-move-down]");
  if (up || down) {
    const id = (up || down).dataset.moveUp || (up || down).dataset.moveDown;
    const index = FilmGroups.blockIndexOf(state, "segment", id);
    FilmGroups.moveBlock(state, index, index + (up ? -1 : 1));
    renderAll();
    return;
  }

  const leave = target.closest("[data-leave]");
  if (leave) {
    FilmGroups.removeMember(state, leave.dataset.group, leave.dataset.leave);
    renderAll();
    return;
  }

  const toggleBackup = target.closest("[data-toggle-backup]");
  if (toggleBackup) {
    FilmGroups.toggleBackup(state, toggleBackup.dataset.group, toggleBackup.dataset.toggleBackup);
    renderAll();
    return;
  }

  const remove = target.closest("[data-delete]");
  if (remove) {
    deleteSegment(remove.dataset.delete);
    renderAll();
  }
}

els.segmentList.addEventListener("click", handleListClick);
els.groupSummary.addEventListener("click", handleListClick);

els.groupSummary.addEventListener("change", (event) => {
  const input = event.target.closest("[data-group-rename]");
  if (!input) return;
  FilmGroups.renameGroup(state, input.dataset.groupRename, input.value);
  renderAll();
});

els.segmentList.addEventListener("dragstart", (event) => {
  if (isFiltering()) return;
  const groupHead = event.target.closest("[data-group-drag]");
  if (groupHead) {
    dragged = { type: "group", id: groupHead.dataset.groupDrag };
    groupHead.classList.add("dragging");
  } else {
    const card = event.target.closest(".segment-card.loose[data-id]");
    if (!card) return;
    dragged = { type: "segment", id: card.dataset.id };
    card.classList.add("dragging");
  }
  event.dataTransfer.effectAllowed = "move";
});

els.segmentList.addEventListener("dragend", () => {
  document.querySelectorAll(".dragging").forEach((node) => node.classList.remove("dragging"));
  dragged = null;
});

els.segmentList.addEventListener("dragover", (event) => {
  if (!dragged || isFiltering()) return;
  const groupBlock = event.target.closest(".group-block");
  const looseCard = event.target.closest(".segment-card.loose");
  const targetNode = groupBlock || looseCard;
  if (!targetNode) return;

  const targetType = groupBlock ? "group" : "segment";
  const targetId = groupBlock ? groupBlock.dataset.groupId : looseCard.dataset.id;
  if (dragged.type === targetType && dragged.id === targetId) return;

  event.preventDefault();
  const fromIndex = FilmGroups.blockIndexOf(state, dragged.type, dragged.id);
  const toIndex = FilmGroups.blockIndexOf(state, targetType, targetId);
  if (fromIndex < 0 || toIndex < 0) return;
  FilmGroups.moveBlock(state, fromIndex, toIndex);
  renderAll();
});

renderAll();
