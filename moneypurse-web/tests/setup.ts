// Loaded via `node --import` before the test suite runs (see package.json's "test" script).
// Installs jsdom globals so React Testing Library has a DOM to render into - jsdom is a pure-JS
// package (no native binary), consistent with this project's toolchain constraints.
//
// Node itself now ships built-in (read-only, getter-based) globals for navigator and
// localStorage, so a plain `globalThis.x = ...` throws "has only a getter". Object.defineProperty
// with configurable/writable overrides those instead of assigning to them.
import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/" });

function setGlobal(name: string, value: unknown): void {
  Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
}

setGlobal("window", dom.window);
setGlobal("document", dom.window.document);
setGlobal("navigator", dom.window.navigator);
setGlobal("localStorage", dom.window.localStorage);
setGlobal("HTMLElement", dom.window.HTMLElement);
setGlobal("Node", dom.window.Node);
