/* 整页集成测试：jsdom 加载 index.html + 三个脚本，模拟真实交互 */
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("/tmp/node_modules/jsdom");

let pass = 0;
let fail = 0;
function assert(cond, msg) {
  if (cond) pass += 1;
  else { fail += 1; console.error("FAIL:", msg); }
}

function buildHtml(seedJson = null) {
  let html = fs.readFileSync(path.join(__dirname, "index.html"), "utf8");
  const seed = seedJson
    ? `<script>localStorage.setItem("zfl17-film-strip-desk", ${JSON.stringify(seedJson)});</script>`
    : "";
  const inline = ["grouping.js", "storage.js", "app.js"]
    .map((file) => `<script>${fs.readFileSync(path.join(__dirname, file), "utf8")}</script>`)
    .join("");
  return html
    .replace("<body>", "<body>" + seed)
    .replace(
      '<script src="grouping.js"></script>\n    <script src="storage.js"></script>\n    <script src="app.js"></script>',
      inline
    );
}

function newDom(savedJson = null) {
  const dom = new JSDOM(buildHtml(savedJson), {
    runScripts: "dangerously",
    url: "http://localhost/",
    pretendToBeVisual: true
  });
  const { window } = dom;
  // 导出时不触发真实导航
  window.HTMLAnchorElement.prototype.click = function () {};
  window.URL.createObjectURL = () => "blob:fake";
  window.URL.revokeObjectURL = () => {};
  return dom;
}

const fire = (el, type = "click") => el.dispatchEvent(new el.ownerDocument.defaultView.Event(type, { bubbles: true }));

/* ---------- 首次打开 ---------- */
let dom = newDom();
let doc = dom.window.document;
assert(doc.querySelectorAll(".loose-card").length === 3, "初始三条都是清单散条");
assert(doc.querySelector("#totalDuration").textContent === "0:41", "可放时长 18+9+14=0:41，got " + doc.querySelector("#totalDuration").textContent);
assert(doc.querySelector("#backupDuration").textContent === "0:00", "初始备用时长 0:00");
assert(doc.querySelector("#buildGroupBtn").disabled, "未勾选时建组按钮禁用");

/* ---------- 勾选前两条建组 ---------- */
const checks = [...doc.querySelectorAll("[data-select]")];
checks.slice(0, 2).forEach((box) => {
  box.checked = true;
  fire(box, "change");
});
assert(doc.querySelector("#selectedCount").textContent === "2", "勾选计数 2");
fire(doc.querySelector("#buildGroupBtn"));
doc = dom.window.document;

const groupBlock = doc.querySelector(".group-block");
assert(groupBlock, "出现镜头组块");
const members = groupBlock.querySelectorAll(".group-member");
assert(members.length === 2, "组内两条素材");
assert(groupBlock.querySelector(".group-duration").textContent === "0:27", "组头合计可放时长 18+9=0:27，got " + groupBlock.querySelector(".group-duration").textContent);
assert(groupBlock.textContent.includes("A-001") && groupBlock.textContent.includes("A-006"), "组内保留各自编号");
assert(groupBlock.textContent.includes("开场街景"), "组内保留备注");
assert(!doc.querySelector(".group-member [data-select]"), "组成员不再有勾选框（不能进第二组）");
assert(doc.querySelectorAll(".loose-card").length === 1, "清单剩一条散条");
assert([...doc.querySelectorAll(".group-member strong, .loose-card strong")].map((n) => n.textContent).join("|").includes("1. A-001"), "组内沿用新顺序编号");

/* ---------- 第二条（A-006）标为备用 ---------- */
const backupBtn = members[1].querySelector("[data-backup-toggle]");
fire(backupBtn);
doc = dom.window.document;
assert(doc.querySelector(".group-block .group-duration").textContent === "0:18", "备用后组头可放只剩 18s，got " + doc.querySelector(".group-block .group-duration").textContent);
assert(doc.querySelector(".group-block .group-backup-meta").textContent.includes("0:09"), "组头显示备用 0:09");
assert(doc.querySelector("#totalDuration").textContent === "0:32", "整卷可放 18+14=0:32，got " + doc.querySelector("#totalDuration").textContent);
assert(doc.querySelector("#backupDuration").textContent === "0:09", "整卷备用 0:09");
assert(doc.querySelector(".group-member.is-backup .tag.backup"), "备用卡片有标记但仍在组里");

/* ---------- 关闭后重新打开：组关系还在 ---------- */
const saved = dom.window.localStorage.getItem("zfl17-film-strip-desk");
const savedParsed = JSON.parse(saved);
assert(savedParsed.groups.length === 1 && savedParsed.groups[0].memberIds.length === 2, "存档里保存了组关系");
assert(savedParsed.segments[1].backup === true, "备用标记已保存");

const dom2 = newDom(saved);
const doc2 = dom2.window.document;
assert(doc2.querySelectorAll(".group-block").length === 1, "重开后镜头组还在");
assert(doc2.querySelectorAll(".group-block .group-member").length === 2, "重开后两条成员还在组里");
assert(doc2.querySelector(".group-block .group-duration").textContent === "0:18", "重开后组头可放时长仍排除备用");
assert(doc2.querySelector("#backupDuration").textContent === "0:09", "重开后备用时长保留");
assert(doc2.querySelector(".group-block input.group-name").value === "镜头组 1", "重开后组名保留");

/* ---------- 破损提醒沿用新顺序并带组名 ---------- */
const warn = doc2.querySelector("#warningList").textContent;
assert(warn.includes("A-006") && warn.includes("镜头组 1"), "提醒里带镜头组名与新顺序编号");
assert(warn.includes("（备用）"), "提醒标注备用");

/* ---------- 筛选沿用新顺序 ---------- */
const colorFilter = doc2.querySelector("#colorFilter");
colorFilter.value = "偏红";
colorFilter.dispatchEvent(new dom2.window.Event("change", { bubbles: true }));
assert(doc2.querySelectorAll(".group-block").length === 1, "筛选后命中的组成员保留组块");
assert(doc2.querySelectorAll(".group-block .group-member").length === 1, "组内只显示命中的 A-006");
assert(doc2.querySelector(".member-hidden-hint"), "未命中成员给出折叠提示，仍留在组内");
assert(doc2.querySelectorAll(".loose-card").length === 0, "散条无命中则隐藏");

/* ---------- 拆开：按原位置回清单 ---------- */
colorFilter.value = "all";
colorFilter.dispatchEvent(new dom2.window.Event("change", { bubbles: true }));
fire(doc2.querySelector("[data-dissolve-group]"));
const looseCodes = [...doc2.querySelectorAll(".loose-card strong")].map((n) => n.textContent);
assert(looseCodes.length === 3, "拆开后三条全部回清单");
assert(looseCodes[0].includes("A-001") && looseCodes[1].includes("A-006") && looseCodes[2].includes("A-012"), "拆开后按原位置排列: " + looseCodes.join(","));
assert(doc2.querySelectorAll(".group-block").length === 0, "组块消失");

/* ---------- 导出不报错且沿用组顺序 ---------- */
const checks2 = [...doc2.querySelectorAll("[data-select]")];
checks2[0].checked = true; fire(checks2[0], "change");
checks2[2].checked = true; fire(checks2[2], "change");
fire(doc2.querySelector("#buildGroupBtn"));
let exportText = null;
const origText = dom2.window.Blob;
dom2.window.Blob = class extends origText {
  constructor(parts, opts) { super(parts, opts); exportText = parts.join(""); }
};
fire(doc2.querySelector("#exportBtn"));
assert(exportText && exportText.includes("可放时长：0:32（不含备用）"), "导出头部可放时长排除备用");
assert(exportText.includes("【镜头组 1】2 条"), "导出包含镜头组段落");
assert(exportText.includes("备用（不计入可放时长）"), "导出标注备用条目");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
