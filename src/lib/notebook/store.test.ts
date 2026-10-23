import { describe, expect, it } from "vitest";
import type { PageDto } from "@/lib/client/api";
import { buildSave, hasDirty, initialState, reducer } from "./store";
import { inkStyleFor, makeInk } from "./ops";

const page = (id: string, position: number): PageDto => ({
  id, position, pageType: "RULED", width: 816, height: 1056, documentId: null, pdfPageNumber: null, objects: [],
});
const ink = (id: string) =>
  makeInk(id, { points: [{ x: 0, y: 0 }, { x: 5, y: 5 }], pressures: [], times: [], hasPressure: false }, inkStyleFor("pen", "#000000", 2), 1);

describe("notebook store", () => {
  const start = initialState([page("p1", 0), page("p2", 1)]);

  it("commits, marks dirty, undoes and redoes", () => {
    const a = ink("ink_aaaaaaaa");
    let s = reducer(start, { type: "commit", pageId: "p1", changes: [{ before: null, after: a }] });
    expect(s.pages[0]!.objects).toHaveLength(1);
    expect(hasDirty(s)).toBe(true);
    s = reducer(s, { type: "undo" });
    expect(s.pages[0]!.objects).toHaveLength(0);
    // the undone creation must still be persisted as a delete
    expect(buildSave(s.pages[0]!, s.dirty.p1!).deletes).toEqual(["ink_aaaaaaaa"]);
    s = reducer(s, { type: "redo" });
    expect(s.pages[0]!.objects).toHaveLength(1);
    expect(buildSave(s.pages[0]!, s.dirty.p1!).upserts).toHaveLength(1);
  });

  it("clears redo on a new commit", () => {
    let s = reducer(start, { type: "commit", pageId: "p1", changes: [{ before: null, after: ink("ink_aaaaaaaa") }] });
    s = reducer(s, { type: "undo" });
    s = reducer(s, { type: "commit", pageId: "p1", changes: [{ before: null, after: ink("ink_bbbbbbbb") }] });
    expect(s.redoStack).toHaveLength(0);
  });

  it("keeps edits made during a save dirty (revision check)", () => {
    let s = reducer(start, { type: "commit", pageId: "p1", changes: [{ before: null, after: ink("ink_aaaaaaaa") }] });
    const snapshot = buildSave(s.pages[0]!, s.dirty.p1!);
    const moved = { ...ink("ink_aaaaaaaa"), x: 50 };
    s = reducer(s, { type: "commit", pageId: "p1", changes: [{ before: s.pages[0]!.objects[0]!, after: moved }] });
    s = reducer(s, { type: "saved", pageId: "p1", revs: snapshot.revs });
    expect(hasDirty(s)).toBe(true);
    const again = buildSave(s.pages[0]!, s.dirty.p1!);
    s = reducer(s, { type: "saved", pageId: "p1", revs: again.revs });
    expect(hasDirty(s)).toBe(false);
  });

  it("silent updates are not undoable but are saved", () => {
    const a = ink("ink_aaaaaaaa");
    let s = reducer(start, { type: "commit", pageId: "p1", changes: [{ before: null, after: a }] });
    s = reducer(s, { type: "silent", pageId: "p1", changes: [{ before: a, after: { ...a, height: 99 } }] });
    expect(s.undoStack).toHaveLength(1);
    expect(s.pages[0]!.objects[0]!.height).toBe(99);
  });

  it("drops history for a deleted page and moves the current page", () => {
    let s = reducer(start, { type: "commit", pageId: "p2", changes: [{ before: null, after: ink("ink_aaaaaaaa") }] });
    s = reducer(s, { type: "setPage", pageId: "p2" });
    s = reducer(s, { type: "pageRemoved", pageId: "p2", remaining: [{ id: "p1", position: 0 }] });
    expect(s.pages.map((p) => p.id)).toEqual(["p1"]);
    expect(s.currentPageId).toBe("p1");
    expect(s.undoStack).toHaveLength(0);
  });

  it("inserts a page at its position and reorders", () => {
    let s = reducer(start, { type: "pageAdded", page: page("p3", 1) });
    expect(s.pages.map((p) => p.id)).toEqual(["p1", "p3", "p2"]);
    s = reducer(s, { type: "pagesReordered", order: [{ id: "p2", position: 0 }, { id: "p1", position: 1 }, { id: "p3", position: 2 }] });
    expect(s.pages.map((p) => p.id)).toEqual(["p2", "p1", "p3"]);
  });
});
