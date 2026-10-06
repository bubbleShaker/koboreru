// Web Audio で合成する控えめな効果音
const Sound = (() => {
  let ac = null;
  let master = null;
  let muted = false;
  let hum = null;
  const NOTES = [523.25, 587.33, 659.25, 783.99, 880.0, 1046.5]; // ペンタトニック

  function init() {
    if (ac) { ac.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ac = new AC();
    master = ac.createGain();
    master.gain.value = muted ? 0 : 0.5;
    master.connect(ac.destination);
  }

  function tone(freq, { type = 'sine', dur = 0.8, vol = 0.2, slide = 0, delay = 0 } = {}) {
    if (!ac || muted) return;
    const t = ac.currentTime + delay;
    const o = ac.createOscillator();
    const g = ac.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(freq * slide, t + dur);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(master);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  return {
    init,
    catch() {
      const f = NOTES[Math.floor(Math.random() * NOTES.length)];
      tone(f, { dur: 1.2, vol: 0.12 });
      tone(f * 2, { dur: 0.6, vol: 0.03 });
    },
    spill() {
      tone(392, { type: 'triangle', dur: 1.4, vol: 0.12, slide: 0.5 });
    },
    fade() {
      tone(1318.5, { dur: 1.8, vol: 0.05, slide: 0.98 });
    },
    humStart() {
      if (!ac || muted || hum) return;
      const o = ac.createOscillator();
      const g = ac.createGain();
      o.frequency.value = 261.63;
      g.gain.setValueAtTime(0, ac.currentTime);
      g.gain.linearRampToValueAtTime(0.06, ac.currentTime + 0.3);
      o.connect(g).connect(master);
      o.start();
      hum = { o, g };
    },
    humStop() {
      if (!hum) return;
      const { o, g } = hum;
      hum = null;
      g.gain.cancelScheduledValues(ac.currentTime);
      g.gain.setValueAtTime(g.gain.value, ac.currentTime);
      g.gain.linearRampToValueAtTime(0, ac.currentTime + 0.3);
      o.stop(ac.currentTime + 0.35);
    },
    toggle() {
      muted = !muted;
      if (master) master.gain.value = muted ? 0 : 0.5;
      if (muted) this.humStop();
      return !muted;
    },
  };
})();
