"use strict";

/*
 * 页面交互层：渲染、筛选、拖拽与事件都在这里。
 * 分组规则见 grouping.js，保存方式见 storage.js，三者分开维护。
 */

let state = FilmStorage.load();
const selectedIds = new Set(); // 勾选区是临时操作，不写盘；组关系才持久化
let dragged = null; // { kind: "group" | "segment", id }

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
  warningList: document.querySelector("#warningList"),
  totalDuration: document.querySelector("#totalDuration"),
  backupDuration: document.querySelector("#backupDuration"),
  damageCount: document.querySelector("#damageCount"),
  segmentCount: document.querySelector("#segmentCount"),
  exportBtn: document.querySelector("#exportBtn"),
  buildGroupBtn: document.querySelector("#buildGroupBtn"),
  clearSelectionBtn: document.querySelector("#clearSelectionBtn"),
  selectedCount: document.querySelector("#selectedCount")
};

function matchesFilter(item) {
  const color = els.colorFilter.value;
  const keyword = els.searchInput.value.trim();
  const matchesColor = color === "all" || item.shift === color;
  const matchesKeyword = !keyword || `${item.code}${item.note}${item.damage}`.includes(keyword);
  return matchesColor && matchesKeyword;
}

function renderStats() {
  const totals = Grouping.reelTotals(state);
  els.totalDuration.textContent = formatDuration(totals.usable);
  els.backupDuration.textContent = formatDuration(totals.backup);
  els.damageCount.textContent = state.segments.filter((item) => item.damage !== "完好").length;
  els.segmentCount.textContent = totals.count;
}

let positionMap = new Map();

function renderList() {
  const orderedIds = Grouping.displayOrder(state);
  positionMap = new Map(orderedIds.map((id, index) => [id, index + 1]));

  const blocks = Grouping.visibleBlocks(state, matchesFilter);
  els.segmentList.innerHTML =
    blocks.map((block) => (block.type === "segment" ? looseCardHtml(block.segment) : groupBlockHtml(block))).join("") ||
    `<p class="empty">没有符合筛选的片段。</p>`;

  updateSelectionBar();
}

function looseCardHtml(item) {
  return cardShell(item, { loose: true });
}

function groupBlockHtml(block) {
  const { group, members, hiddenCount = 0 } = block;
  const totals = Grouping.groupTotals(state, group);
  return `
    <article class="group-block" data-group-block="${group.id}">
      <header class="group-head" data-group-head="${group.id}">
        <span class="group-grip" draggable="true" data-drag-group="${group.id}" title="按住拖动，整组一起移动">⠿</span>
        <input
          class="group-name"
          type="text"
          maxlength="20"
          value="${escapeHtml(group.name)}"
          data-rename-group="${group.id}"
          aria-label="镜头组名称"
        />
        <div class="group-meta">
          <strong class="group-duration" title="选用素材合计可放时长（不含备用）">${formatDuration(totals.usable)}</strong>
          <span>${totals.count} 条</span>
          ${totals.backupCount ? `<span class="group-backup-meta">备用 ${totals.backupCount} 条 · ${formatDuration(totals.backup)}</span>` : ""}
        </div>
        <div class="group-head-actions">
          <button type="button" class="add-to-group" data-add-to-group="${group.id}" disabled title="把勾选的散条加进本组">加入勾选</button>
          <button type="button" data-dissolve-group="${group.id}" title="拆开本组，素材按原位置回到清单">拆开</button>
        </div>
      </header>
      <div class="group-body">
        ${members.map((seg) => cardShell(seg, { groupId: group.id })).join("")}
        ${hiddenCount ? `<p class="member-hidden-hint">另有 ${hiddenCount} 条不匹配当前筛选，仍留在组内。</p>` : ""}
      </div>
    </article>
  `;
}

function cardShell(item, { loose = false, groupId = null } = {}) {
  const canonicalIndex = state.segments.findIndex((seg) => seg.id === item.id);
  const hasDamage = item.damage !== "完好";
  const backup = Grouping.isBackup(item);
  const position = positionMap.get(item.id) ?? canonicalIndex + 1;
  const selected = selectedIds.has(item.id);

  const actions = loose
    ? `
        <button type="button" title="上移" data-move-up="${item.id}">↑</button>
        <button type="button" title="下移" data-move-down="${item.id}">↓</button>
        <button type="button" title="删除" data-delete="${item.id}">×</button>
      `
    : `
        <button type="button" class="${backup ? "is-backup-on" : ""}" title="${backup ? "取消备用标记" : "标为备用：留在组里但不占可放时长"}" data-backup-toggle="${item.id}">备用</button>
        <button type="button" title="移出本组，按原位置回清单" data-remove-member="${item.id}">移出</button>
        <button type="button" title="删除" data-delete="${item.id}">×</button>
      `;

  return `
    <article
      class="segment-card ${loose ? "selectable loose-card" : "group-member"} ${backup ? "is-backup" : ""}"
      ${loose ? `draggable="true" data-drag-segment="${item.id}"` : ""}
      data-id="${item.id}"
    >
      ${
        loose
          ? `<label class="pick" title="勾选后可建成镜头组"><input type="checkbox" data-select="${item.id}" ${selected ? "checked" : ""} /></label>`
          : ""
      }
      <div class="thumb">
        ${
          item.thumb
            ? `<img src="${item.thumb}" alt="${escapeHtml(item.code)}缩略图" />`
            : `<div class="film-placeholder" style="background:${FilmStorage.fallbackThumbs[canonicalIndex % FilmStorage.fallbackThumbs.length]}">${escapeHtml(item.code)}</div>`
        }
      </div>
      <div class="segment-main">
        <div class="segment-title">
          <strong>${position}. ${escapeHtml(item.code)}</strong>
          <span class="${backup ? "duration-backup" : ""}">${formatDuration(item.duration)}</span>
          ${backup ? `<span class="tag backup">备用 · 不占时长</span>` : ""}
        </div>
        <div class="tag-row">
          <span class="tag">${escapeHtml(item.shift)}</span>
          <span class="tag ${hasDamage ? "damage" : "ok"}">${escapeHtml(item.damage)}</span>
        </div>
        <p class="segment-note">${escapeHtml(item.note || "没有备注。")}</p>
      </div>
      <div class="segment-actions">${actions}</div>
    </article>
  `;
}

function updateSelectionBar() {
  const size = selectedIds.size;
  els.selectedCount.textContent = size;
  els.buildGroupBtn.disabled = size === 0;
  els.clearSelectionBtn.disabled = size === 0;
  els.segmentList.querySelectorAll("[data-add-to-group]").forEach((button) => {
    button.disabled = size === 0;
  });
}

function renderWarnings() {
  const orderedIds = Grouping.displayOrder(state);
  const warnings = state.segments.filter((item) => item.damage !== "完好" || item.shift !== "正常");
  els.warningList.innerHTML =
    warnings
      .map((item) => {
        const position = orderedIds.indexOf(item.id) + 1;
        const group = Grouping.groupOf(state, item.id);
        const reasons = [item.shift !== "正常" ? item.shift : "", item.damage !== "完好" ? item.damage : ""].filter(Boolean).join(" · ");
        return `
          <div class="warning-item">
            <strong>${position}. ${escapeHtml(item.code)}${group ? `｜${escapeHtml(group.name)}` : ""}${Grouping.isBackup(item) ? "（备用）" : ""}</strong>
            <span>${escapeHtml(reasons)}${item.note ? `：${escapeHtml(item.note)}` : ""}</span>
          </div>
        `;
      })
      .join("") || `<p class="empty">当前清单没有颜色偏移或破损提醒。</p>`;
}

function renderAll() {
  FilmStorage.save(state);
  els.reelTitle.value = state.reelTitle;
  renderStats();
  renderList();
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
    thumb,
    backup: false
  });
  els.segmentForm.reset();
  els.durationInput.value = 12;
  renderAll();
}

/* 散条上下移动：相邻是组时，绕着整组移动，不会插进组里 */
function moveSegment(id, direction) {
  const ordered = Grouping.blocks(state);
  const index = ordered.findIndex((block) => block.type === "segment" && block.segment.id === id);
  if (index < 0) return;
  const neighbor = ordered[index + direction];
  if (!neighbor) return;
  const drag = { kind: "segment", id };
  if (neighbor.type === "group") {
    Grouping.moveBlock(state, drag, { kind: "group", id: neighbor.group.id, edge: direction > 0 ? "after" : "before" });
  } else {
    Grouping.moveBlock(state, drag, { kind: "segment", id: neighbor.segment.id, edge: direction > 0 ? "after" : "before" });
  }
  renderAll();
}

function exportList() {
  const totals = Grouping.reelTotals(state);
  const lines = [
    `胶片卷：${state.reelTitle || "未命名胶片卷"}`,
    `可放时长：${formatDuration(totals.usable)}（不含备用）`,
    totals.backupCount ? `备用时长：${formatDuration(totals.backup)}（${totals.backupCount} 条，不占可放时长）` : "",
    ""
  ].filter(Boolean);

  let position = 0;
  Grouping.blocks(state).forEach((block) => {
    if (block.type === "segment") {
      position += 1;
      lines.push(segmentLine(block.segment, position));
      return;
    }
    const groupTotals = Grouping.groupTotals(state, block.group);
    lines.push(
      `【${block.group.name}】${groupTotals.count} 条｜可放 ${formatDuration(groupTotals.usable)}${
        groupTotals.backupCount ? `｜备用 ${groupTotals.backupCount} 条 ${formatDuration(groupTotals.backup)}` : ""
      }`
    );
    block.members.forEach((seg) => {
      position += 1;
      lines.push(`  ${segmentLine(seg, position)}`);
    });
  });

  const blob = new Blob([lines.join("\n")], { type: "text/plain;charset=utf-8" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `${state.reelTitle || "film-reel"}-checklist.txt`;
  link.click();
  URL.revokeObjectURL(link.href);
}

function segmentLine(item, position) {
  return `${position}. ${item.code}｜${formatDuration(item.duration)}｜${item.shift}｜${item.damage}${
    Grouping.isBackup(item) ? "｜备用（不计入可放时长）" : ""
  }｜${item.note || "无备注"}`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

/* ---------------- 事件 ---------------- */

els.reelTitle.addEventListener("input", () => {
  state.reelTitle = els.reelTitle.value;
  FilmStorage.save(state);
});
els.colorFilter.addEventListener("change", renderList);
els.searchInput.addEventListener("input", renderList);
els.segmentForm.addEventListener("submit", addSegment);
els.exportBtn.addEventListener("click", exportList);

els.buildGroupBtn.addEventListener("click", () => {
  const ids = [...selectedIds];
  const group = Grouping.createGroup(state, ids);
  if (group) selectedIds.clear();
  renderAll();
});

els.clearSelectionBtn.addEventListener("click", () => {
  selectedIds.clear();
  renderList();
});

els.segmentList.addEventListener("change", (event) => {
  const checkbox = event.target.closest("[data-select]");
  if (!checkbox) return;
  const id = checkbox.dataset.select;
  if (checkbox.checked) selectedIds.add(id);
  else selectedIds.delete(id);
  updateSelectionBar();
});

els.segmentList.addEventListener("click", (event) => {
  const target = event.target;
  const up = target.closest("[data-move-up]");
  const down = target.closest("[data-move-down]");
  const remove = target.closest("[data-delete]");
  const backupToggle = target.closest("[data-backup-toggle]");
  const removeMember = target.closest("[data-remove-member]");
  const dissolve = target.closest("[data-dissolve-group]");
  const addToGroup = target.closest("[data-add-to-group]");

  if (up) return moveSegment(up.dataset.moveUp, -1);
  if (down) return moveSegment(down.dataset.moveDown, 1);
  if (backupToggle) {
    Grouping.toggleBackup(state, backupToggle.dataset.backupToggle);
    return renderAll();
  }
  if (removeMember) {
    Grouping.removeMember(state, removeMember.closest("[data-group-block]").dataset.groupBlock, removeMember.dataset.removeMember);
    return renderAll();
  }
  if (dissolve) {
    Grouping.dissolveGroup(state, dissolve.dataset.dissolveGroup);
    return renderAll();
  }
  if (addToGroup) {
    const added = Grouping.addMembers(state, addToGroup.dataset.addToGroup, [...selectedIds]);
    added.forEach((id) => selectedIds.delete(id));
    return renderAll();
  }
  if (remove) {
    const id = remove.dataset.delete;
    Grouping.deleteSegment(state, id);
    selectedIds.delete(id);
    return renderAll();
  }
});

els.segmentList.addEventListener("input", (event) => {
  const nameInput = event.target.closest("[data-rename-group]");
  if (!nameInput) return;
  Grouping.renameGroup(state, nameInput.dataset.renameGroup, nameInput.value);
  FilmStorage.save(state);
});

els.segmentList.addEventListener("dragstart", (event) => {
  const grip = event.target.closest("[data-drag-group]");
  const card = event.target.closest("[data-drag-segment]");
  if (grip) {
    dragged = { kind: "group", id: grip.dataset.dragGroup };
    grip.closest(".group-head")?.classList.add("dragging");
  } else if (card) {
    dragged = { kind: "segment", id: card.dataset.dragSegment };
    card.classList.add("dragging");
  } else {
    return;
  }
  event.dataTransfer.effectAllowed = "move";
  event.dataTransfer.setData("text/plain", dragged.id);
});

els.segmentList.addEventListener("dragend", () => {
  els.segmentList.querySelectorAll(".dragging").forEach((node) => node.classList.remove("dragging"));
  dragged = null;
});

els.segmentList.addEventListener("dragover", (event) => {
  if (!dragged) return;
  const target = dropTargetFromEvent(event);
  if (!target) return;
  if (target.kind === dragged.kind && target.id === dragged.id) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = "move";
  Grouping.moveBlock(state, dragged, target);
  FilmStorage.save(state);
  renderList();
});

/* 落点只认整块：组块或散条；落在组成员身上按整组处理 */
function dropTargetFromEvent(event) {
  const groupEl = event.target.closest("[data-group-block]");
  if (groupEl) {
    const rect = groupEl.getBoundingClientRect();
    return {
      kind: "group",
      id: groupEl.dataset.groupBlock,
      edge: event.clientY < rect.top + rect.height / 2 ? "before" : "after"
    };
  }
  const looseEl = event.target.closest("[data-drag-segment]");
  if (looseEl) {
    const rect = looseEl.getBoundingClientRect();
    return {
      kind: "segment",
      id: looseEl.dataset.dragSegment,
      edge: event.clientY < rect.top + rect.height / 2 ? "before" : "after"
    };
  }
  return null;
}

renderAll();
