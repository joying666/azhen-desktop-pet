(function () {
  "use strict";

  const DEFAULT_OPTIONS = {
    state: "working",
    scale: 0.38,
    draggable: true,
    returnState: "working",
    waterReminderIntervalMs: null,
  };

  function parseClock(value) {
    const parts = String(value || "").split(":");
    if (parts.length !== 2) return null;
    const hours = Number(parts[0]);
    const minutes = Number(parts[1]);
    if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
    if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
    return hours * 60 + minutes;
  }

  function isWithinWorkHours(workHours, now) {
    if (!workHours || !workHours.start || !workHours.end) return true;
    const start = parseClock(workHours.start);
    const end = parseClock(workHours.end);
    if (start === null || end === null) return true;
    const current = now.getHours() * 60 + now.getMinutes();
    if (start <= end) return current >= start && current <= end;
    return current >= start || current <= end;
  }

  function resolveState(manifest, nameOrEvent) {
    if (!manifest || !manifest.states) return null;
    if (manifest.states[nameOrEvent]) return nameOrEvent;
    for (const [stateName, state] of Object.entries(manifest.states)) {
      if ((state.eventAliases || []).includes(nameOrEvent)) return stateName;
    }
    return null;
  }

  function createAzhenPet(root, manifest, options) {
    const opts = Object.assign({}, DEFAULT_OPTIONS, options || {});
    let timer = null;
    let activeState = null;
    let manualLock = false;
    let media = null;

    root.classList.add("azhen-pet");
    root.style.setProperty("--pet-scale", String(opts.scale));

    function isVideoFile(src) {
      return /\.(webm|mp4|mov)(\?|#|$)/i.test(src || "");
    }

    function createMediaElement(state) {
      const src = String(state.file || "");
      const next = isVideoFile(src) ? document.createElement("video") : document.createElement("img");
      next.className = "azhen-pet-video";
      next.setAttribute("aria-label", "阿真桌宠");
      next.draggable = false;
      if (next.tagName === "VIDEO") {
        next.muted = true;
        next.playsInline = true;
        next.autoplay = true;
        next.preload = "auto";
        next.disablePictureInPicture = true;
      }
      return next;
    }

    function setMediaSource(state) {
      const needsVideo = isVideoFile(state.file);
      const hasVideo = media && media.tagName === "VIDEO";
      if (!media || needsVideo !== hasVideo) {
        if (media) media.remove();
        media = createMediaElement(state);
        root.appendChild(media);
      }

      if (media.tagName === "VIDEO") {
        media.loop = Boolean(state.loop);
        media.src = state.file;
        media.currentTime = 0;
        media.play().catch(function () {});
      } else {
        media.src = state.file;
      }
    }

    function emitStateChange(stateName, state, previousState, transition, playbackState) {
      root.dispatchEvent(new CustomEvent("azhenpet:statechange", {
        detail: { stateName, state, previousState, manual: Boolean(transition.manual), source: transition.source, locked: manualLock, loop: Boolean(playbackState.loop) }
      }));
    }

    function setState(nameOrEvent, options) {
      const transition = Object.assign({ manual: false, force: false, source: "" }, options || {});
      const stateName = resolveState(manifest, nameOrEvent);
      if (!stateName) return false;
      if (manualLock && !transition.manual && !transition.force) return false;
      if (transition.manual) {
        manualLock = true;
      }
      transition.source = transition.source || (transition.manual ? "manual" : "event");
      const state = manifest.states[stateName];
      const playbackState = transition.manual ? Object.assign({}, state, { loop: true, autoReturnTo: null }) : state;
      const previousState = activeState;
      if (timer) window.clearTimeout(timer);
      timer = null;
      activeState = stateName;

      setMediaSource(playbackState);
      root.dataset.state = stateName;
      emitStateChange(stateName, state, previousState, transition, playbackState);

      if (!manualLock && !playbackState.loop && playbackState.autoReturnTo) {
        timer = window.setTimeout(function () {
          setState(playbackState.autoReturnTo);
        }, Number(playbackState.holdMs || 4200));
      }
      return true;
    }

    function getState() {
      return activeState;
    }

    function dispatchEvent(name, options) {
      return setState(name, options);
    }

    function startWaterReminder() {
      const reminder = manifest.reminders && manifest.reminders.water;
      if (!reminder || !reminder.enabled) return function () {};
      const intervalMs = Number(opts.waterReminderIntervalMs || Number(reminder.intervalMinutes || 60) * 60 * 1000);
      const id = window.setInterval(function () {
        if (isWithinWorkHours(reminder.workHours, new Date())) {
          setState(reminder.state || "water");
        }
      }, intervalMs);
      return function () {
        window.clearInterval(id);
      };
    }

    function enableDrag() {
      let dragging = false;
      let startX = 0;
      let startY = 0;
      let originX = 0;
      let originY = 0;

      root.addEventListener("pointerdown", function (event) {
        if (!opts.draggable) return;
        dragging = true;
        startX = event.clientX;
        startY = event.clientY;
        const rect = root.getBoundingClientRect();
        originX = rect.left;
        originY = rect.top;
        root.setPointerCapture(event.pointerId);
      });

      root.addEventListener("pointermove", function (event) {
        if (!dragging) return;
        const x = originX + event.clientX - startX;
        const y = originY + event.clientY - startY;
        root.style.left = `${Math.max(0, x)}px`;
        root.style.top = `${Math.max(0, y)}px`;
        root.style.right = "auto";
        root.style.bottom = "auto";
      });

      root.addEventListener("pointerup", function (event) {
        dragging = false;
        try {
          root.releasePointerCapture(event.pointerId);
        } catch (_) {}
      });
    }

    enableDrag();
    setState(opts.state || manifest.defaultState || "working");

    return {
      setState,
      dispatchEvent,
      getState,
      isManualLocked() {
        return manualLock;
      },
      startWaterReminder,
      get video() {
        return media && media.tagName === "VIDEO" ? media : null;
      },
      get media() {
        return media;
      },
      root,
    };
  }

  window.createAzhenPet = createAzhenPet;
})();
