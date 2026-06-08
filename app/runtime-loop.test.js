const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

class FakeElement {
  constructor(tagName) {
    this.tagName = String(tagName || "div").toUpperCase();
    this.children = [];
    this.listeners = {};
    this.dataset = {};
    this.attributes = {};
    this.className = "";
    this.draggable = true;
    this.loop = false;
    this.src = "";
    this.currentTime = 0;
    this.parentNode = null;
    this.classList = {
      add: () => {},
    };
    this.style = {
      setProperty: () => {},
    };
  }

  appendChild(child) {
    child.parentNode = this;
    this.children.push(child);
    return child;
  }

  remove() {
    if (!this.parentNode) return;
    this.parentNode.children = this.parentNode.children.filter((child) => child !== this);
    this.parentNode = null;
  }

  setAttribute(name, value) {
    this.attributes[name] = String(value);
  }

  addEventListener(type, listener) {
    this.listeners[type] = this.listeners[type] || [];
    this.listeners[type].push(listener);
  }

  dispatchEvent(event) {
    for (const listener of this.listeners[event.type] || []) {
      listener(event);
    }
    return true;
  }

  setPointerCapture() {}

  releasePointerCapture() {}

  getBoundingClientRect() {
    return { left: 0, top: 0 };
  }

  play() {
    return Promise.resolve();
  }
}

class FakeCustomEvent {
  constructor(type, init) {
    this.type = type;
    this.detail = init && init.detail;
  }
}

const timers = new Set();
const intervals = new Set();
const document = {
  createElement(tagName) {
    return new FakeElement(tagName);
  },
};
const window = {
  document,
  CustomEvent: FakeCustomEvent,
  setTimeout(handler, delay) {
    const timer = { handler, delay };
    timers.add(timer);
    return timer;
  },
  clearTimeout(timer) {
    timers.delete(timer);
  },
  setInterval(handler, delay) {
    const interval = { handler, delay };
    intervals.add(interval);
    return interval;
  },
  clearInterval(interval) {
    intervals.delete(interval);
  },
};

const context = {
  console,
  document,
  window,
  CustomEvent: FakeCustomEvent,
  Promise,
};

const runtimePath = path.join(__dirname, "桌宠运行时.js");
vm.runInNewContext(fs.readFileSync(runtimePath, "utf8"), context, { filename: runtimePath });

const manifest = {
  defaultState: "working",
  states: {
    working: {
      file: "working.webm",
      loop: true,
      eventAliases: ["agent.task.running"],
    },
    done: {
      file: "done.gif",
      loop: false,
      holdMs: 20,
      autoReturnTo: "paused",
      eventAliases: ["agent.task.done"],
    },
    failed: {
      file: "failed.webp",
      loop: false,
      holdMs: 20,
      autoReturnTo: "paused",
      eventAliases: ["agent.task.failed"],
    },
    paused: {
      file: "paused.webp",
      loop: true,
      eventAliases: ["agent.waiting.user"],
    },
    water: {
      file: "water.webm",
      loop: false,
      holdMs: 20,
      autoReturnTo: "working",
      eventAliases: ["reminder.water.hourly"],
    },
  },
};

const root = new FakeElement("div");
const changes = [];
root.addEventListener("azhenpet:statechange", (event) => changes.push(event.detail));

const pet = context.window.createAzhenPet(root, manifest, { state: "working", draggable: false });
assert.equal(pet.getState(), "working");
assert.equal(root.dataset.state, "working");
assert.equal(changes.at(-1).loop, true);
assert.equal(changes.at(-1).locked, false);

const manualCases = [
  ["agent.task.running", "working"],
  ["agent.task.done", "done"],
  ["agent.task.failed", "failed"],
  ["agent.waiting.user", "paused"],
  ["reminder.water.hourly", "water"],
];

for (const [eventName, stateName] of manualCases) {
  assert.equal(pet.dispatchEvent(eventName, { manual: true, source: "test" }), true);
  assert.equal(pet.getState(), stateName);
  assert.equal(root.dataset.state, stateName);
  assert.equal(pet.isManualLocked(), true);
  assert.equal(changes.at(-1).stateName, stateName);
  assert.equal(changes.at(-1).loop, true);
  assert.equal(changes.at(-1).locked, true);

  assert.equal(pet.dispatchEvent("agent.task.running", { source: "auto-test" }), false);
  assert.equal(pet.getState(), stateName);
}

assert.equal(pet.media.tagName, "VIDEO");
assert.equal(pet.media.loop, true);
assert.equal(timers.size, 0);

console.log("runtime state loop behavior passed");
