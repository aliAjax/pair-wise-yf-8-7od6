// 分组规则层冒烟测试：node test-grouping.js
const fs = require("fs");
const vm = require("vm");

const sandbox = {
  crypto: { randomUUID: (() => { let n = 0; return () => `g-${++n}`; })() }
};
vm.createContext(sandbox);
const code = fs.readFileSync("./grouping.js", "utf8");
sandbox.Grouping = vm.runInContext(`${code}\nGrouping;`, sandbox);
const G = sandbox.Grouping;

let pass = 0;
let fail = 0;
function assert(cond, msg) {
  if (cond) { pass += 1; }
  else { fail += 1; console.error("FAIL:", msg); }
}

function seg(id, duration = 10, backup = false) {
  return { id, code: id, duration, shift: "正常", damage: "完好", note: "", thumb: "", backup };
}

function makeState() {
  return {
    reelTitle: "测试卷",
    segments: [seg("s1", 18), seg("s2", 9), seg("s3", 14), seg("s4", 6), seg("s5", 12)],
    groups: []
  };
}

const codes = (state) =>
  G.displayOrder(state).map((id) => {
    const s = G.byId(state, id);
    return s.backup ? `${id}(备)` : id;
  });
const blockKinds = (state) =>
  G.blocks(state).map((b) => (b.type === "group" ? `[${b.members.map((m) => m.id).join("+")}]` : b.segment.id));

// 1. 勾选散条建组：组放在最早入选位置，成员保留各自编号
let st = makeState();
const g1 = G.createGroup(st, ["s2", "s4"]);
assert(g1, "createGroup 返回组对象");
assert(blockKinds(st).join(",") === "s1,[s2+s4],s3,s5", "组按最早入选素材位置展开: " + blockKinds(st).join(","));
assert(G.byId(st, "s2").code === "s2" && G.byId(st, "s4").duration === 6, "组内保留各自编号与时长");

// 2. 一个素材不能同时进两组
const g2 = G.createGroup(st, ["s3", "s4", "s5"]);
assert(G.groupOf(st, "s4").id === g1.id, "s4 已在 g1，不能进 g2");
assert(blockKinds(st).join(",") === "s1,[s2+s4],[s3+s5]", "新组只接收未入组素材: " + blockKinds(st).join(","));

// 3. 组头合计时长（不含备用）；备用仍留组里
G.toggleBackup(st, "s4");
const t1 = G.groupTotals(st, g1);
assert(t1.usable === 9 && t1.backup === 6 && t1.count === 2 && t1.backupCount === 1, "g1 可放9 / 备用6 / 计数2");
const reel = G.reelTotals(st);
assert(reel.usable === 18 + 9 + 14 + 12 && reel.backup === 6, "整卷可放时长不含备用");
assert(G.displayOrder(st).includes("s4"), "备用条目仍留在组里、仍在顺序中");

// 4. 整组拖动：组作为一个块移动（UI 里落到组成员身上会解析为其父组）
G.moveBlock(st, { kind: "group", id: g1.id }, { kind: "group", id: g2.id, edge: "after" });
assert(blockKinds(st).join(",") === "s1,[s3+s5],[s2+s4]", "g1 整组移到末尾: " + blockKinds(st).join(","));
G.moveBlock(st, { kind: "group", id: g1.id }, { kind: "segment", id: "s1", edge: "before" });
assert(blockKinds(st)[0] === "[s2+s4]", "g1 整组移到开头");

// 5. 散条不能被拖进组里（成员不是落点；拖到组上是绕着组走）
G.moveBlock(st, { kind: "segment", id: "s1" }, { kind: "group", id: g2.id, edge: "after" });
assert(!G.groupOf(st, "s1"), "散条绕组移动后仍是散条");
assert(blockKinds(st).join(",") === "[s2+s4],[s3+s5],s1", "散条移到 g2 之后、卷尾之前: " + blockKinds(st).join(","));

// 6. 拆开后按原位置回清单
G.dissolveGroup(st, g1.id);
G.dissolveGroup(st, g2.id);
assert(codes(st).join(",") === "s1,s2,s3,s4(备),s5", "拆组后完全回到原清单顺序: " + codes(st).join(","));
assert(st.groups.length === 0, "拆组后无残留组");

// 7. 单条移出也回原位（不管组当前被拖到哪里）
st = makeState();
const ga = G.createGroup(st, ["s1", "s5"]);
const gb = G.createGroup(st, ["s2"]); // gb 初始在 s2 位置，即 ga 之后
G.moveBlock(st, { kind: "group", id: ga.id }, { kind: "segment", id: "s3", edge: "after" });
assert(blockKinds(st).join(",") === "[s2],s3,[s1+s5],s4", "组位置已变动: " + blockKinds(st).join(","));
G.removeMember(st, ga.id, "s5");
assert(blockKinds(st).join(",") === "[s2],s3,[s1],s4,s5", "s5 回到自己的原槽位（末尾）: " + blockKinds(st).join(","));
G.removeMember(st, ga.id, "s1");
assert(codes(st).join(",") === "s1,s2,s3,s4,s5", "最后一条移出后组消失，顺序复原");

// 8. addMembers：追加勾选素材进已有组
st = makeState();
const gc = G.createGroup(st, ["s2"]);
const added = G.addMembers(st, gc.id, ["s4", "s1", "s3"]);
assert(added.join(",") === "s1,s3,s4", "addMembers 返回按清单顺序的新成员");
assert(G.groupOf(st, "s1")?.id === gc.id && G.groupTotals(st, gc).count === 4, "素材进入同一组");
assert(G.addMembers(st, gc.id, ["s1", "nope"]).length === 0, "已入组或不存在的素材被拒绝");

// 9. 筛选沿用新顺序：组内只显示命中成员，并折叠未命中计数
st = makeState();
const gd = G.createGroup(st, ["s2", "s3"]);
G.moveBlock(st, { kind: "group", id: gd.id }, { kind: "segment", id: "s5", edge: "after" });
const vis = G.visibleBlocks(st, (s) => s.id === "s3" || s.id === "s5");
assert(vis.length === 2 && vis[0].type === "segment" && vis[0].segment.id === "s5", "筛选只保留命中素材，顺序沿用组顺序");
assert(vis[1].type === "group" && vis[1].members.length === 1 && vis[1].hiddenCount === 1, "组保留并折叠未命中成员");

// 10. 删除素材：同步退组，空组清除
st = makeState();
const ge = G.createGroup(st, ["s2", "s4"]);
G.deleteSegment(st, "s2");
G.deleteSegment(st, "s4");
assert(st.groups.length === 0 && st.segments.length === 3, "成员全删后组清除");

// 11. 连续多组共用同一锚点
st = makeState();
const gh1 = G.createGroup(st, ["s1"]);
const gh2 = G.createGroup(st, ["s2"]);
G.moveBlock(st, { kind: "group", id: gh2.id }, { kind: "group", id: gh1.id, edge: "before" });
assert(blockKinds(st)[0] === "[s2]" && blockKinds(st)[1] === "[s1]", "两组可以连续相邻: " + blockKinds(st).join(","));
G.moveBlock(st, { kind: "group", id: gh2.id }, { kind: "segment", id: "s4", edge: "after" });
assert(blockKinds(st).join(",") === "[s1],s3,s4,[s2],s5", "拆开连续组后剩余组锚点正确: " + blockKinds(st).join(","));

// 12. 重命名
G.renameGroup(st, gh1.id, "开场镜头");
assert(G.groupOf(st, "s1").name === "开场镜头", "组名可改");

// 13. 把别的组所锚定的散条加入另一组：锚点组不能跳位
st = makeState();
const gx = G.createGroup(st, ["s1"]); // [gx],s2,s3,s4,s5
const gy = G.createGroup(st, ["s3"]); // [gx],s2,[gy],s4,s5，gy 锚 s4
G.addMembers(st, gx.id, ["s4"]); // s4 正是 gy 的锚点
assert(blockKinds(st).join(",") === "[s1+s4],s2,[s3],s5", "gy 不被锚点悬空甩到卷尾: " + blockKinds(st).join(","));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
