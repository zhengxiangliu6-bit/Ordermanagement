import { describe, expect, it } from "vitest";
import { parseNoteBody } from "./note-display";

describe("parseNoteBody", () => {
  it("strips the review marker", () => {
    expect(parseNoteBody("[Review] 客户要求换色")).toEqual({
      kind: "review",
      body: "客户要求换色",
    });
  });

  it("parses the copy marker into a localizable message", () => {
    expect(parseNoteBody("[Copy] Duplicated from #1013 (re-ship flow)")).toEqual({
      kind: "copy",
      body: "#1013",
      sourceNumber: "#1013",
    });
  });

  it("leaves ordinary notes untouched", () => {
    expect(parseNoteBody("普通留言 [Review] 不是前缀")).toEqual({
      kind: "generic",
      body: "普通留言 [Review] 不是前缀",
    });
  });
});

describe("parseNoteBody step notes", () => {
  it("labels each workflow step note", () => {
    expect(parseNoteBody("[Packing] 纸箱加固")).toEqual({ kind: "packing", body: "纸箱加固" });
    expect(parseNoteBody("[Ordering] 已选云途")).toEqual({ kind: "ordering", body: "已选云途" });
    expect(parseNoteBody("[Inspection] 无缺件")).toEqual({ kind: "inspection", body: "无缺件" });
    expect(parseNoteBody("[Tail] 尾程已补")).toEqual({ kind: "tail", body: "尾程已补" });
  });
});
