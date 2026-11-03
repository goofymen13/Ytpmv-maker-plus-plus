/* The word-order builder: phrases made of word chips you can click, drag and type. */
(function (YT) {
  'use strict';
  const U = YT.util, { el } = U;
  const A = YT.app;
  let selected = null;
  let dragState = null;

  const findWord = id => A.allWords().find(w => w.id === id);

  function chipFor(word, extra = {}) {
    return el('button', { class: 'chip', style: { '--chip': word.color }, title: `${word.name} · ${YT.wordDur(word).toFixed(2)} s`, ...extra }, el('span', null, word.name));
  }

  function selectPhrase(id) {
    selected = id;
    render();
  }

  /* Editing a phrase means it no longer follows its clip's word list automatically. */
  function edited(phrase) {
    phrase.auto = false;
    A.invalidate('compile');
    render();
    A.emit('phrases-edited');
  }

  function addStep(phrase, step, at) {
    if (at == null) phrase.steps.push(step);
    else phrase.steps.splice(at, 0, step);
    edited(phrase);
  }

  function stepLabel(step) {
    if (step.type === 'rest') return { name: 'rest', cls: 'rest', title: 'A silent step: the note it lands on is skipped' };
    if (step.type === 'hold') return { name: 'hold', cls: 'hold', title: 'Keeps singing the previous word’s vowel on this note, with no new consonant' };
    const w = findWord(step.wordId);
    return w ? { name: w.name, word: w } : { name: '?', cls: 'rest' };
  }

  function stepChip(phrase, step, index) {
    const label = stepLabel(step);
    const chip = el('div', {
      class: `chip ${label.cls || ''}`, draggable: true, tabIndex: 0, role: 'button',
      title: label.title || 'Drag to reorder. Click to hear it.', style: label.word ? { '--chip': label.word.color } : null
    },
      el('span', { class: 'num' }, index + 1),
      el('span', null, label.name),
      el('span', {
        class: 'x', title: 'Remove', onclick: e => {
          e.stopPropagation();
          phrase.steps.splice(index, 1);
          edited(phrase);
        }
      }, '×')
    );
    chip.addEventListener('click', () => { if (label.word) A.audition(label.word).catch(reportError); });
    chip.addEventListener('dragstart', e => {
      dragState = { phrase, index };
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', 'step');
      requestAnimationFrame(() => chip.classList.add('dragging'));
    });
    chip.addEventListener('dragend', () => { dragState = null; chip.classList.remove('dragging'); });
    chip.addEventListener('dragover', e => {
      if (!dragState) return;
      e.preventDefault();
      e.stopPropagation();
      const after = e.offsetX > chip.offsetWidth / 2;
      chip.classList.toggle('drop-after', after);
      chip.classList.toggle('drop-before', !after);
    });
    chip.addEventListener('dragleave', () => chip.classList.remove('drop-after', 'drop-before'));
    chip.addEventListener('drop', e => {
      if (!dragState) return;
      e.preventDefault();
      e.stopPropagation();
      const after = e.offsetX > chip.offsetWidth / 2;
      moveStep(phrase, after ? index + 1 : index);
    });
    chip.addEventListener('keydown', e => {
      // Keyboard reordering for people not using drag and drop.
      if (e.key === 'ArrowLeft' && index > 0) { swap(phrase, index, index - 1); e.preventDefault(); }
      else if (e.key === 'ArrowRight' && index < phrase.steps.length - 1) { swap(phrase, index, index + 1); e.preventDefault(); }
      else if (e.key === 'Delete' || e.key === 'Backspace') { phrase.steps.splice(index, 1); edited(phrase); e.preventDefault(); }
    });
    return chip;
  }

  function swap(phrase, a, b) {
    [phrase.steps[a], phrase.steps[b]] = [phrase.steps[b], phrase.steps[a]];
    edited(phrase);
  }

  function moveStep(target, at) {
    if (!dragState) return;
    const { phrase, index } = dragState;
    const [step] = phrase.steps.splice(index, 1);
    let to = at;
    if (phrase === target && index < at) to--;
    target.steps.splice(to, 0, step);
    if (phrase !== target) phrase.auto = false;
    dragState = null;
    edited(target);
  }

  /* "mr beast mr _ ~" -> steps. Word names are matched without caring about case. */
  function parseText(text) {
    const words = A.allWords();
    const steps = [], unknown = [];
    for (const token of text.trim().split(/[\s,]+/).filter(Boolean)) {
      if (token === '_' || token === '-' || token.toLowerCase() === 'rest') steps.push({ type: 'rest' });
      else if (token === '~' || token.toLowerCase() === 'hold') steps.push({ type: 'hold' });
      else {
        const w = words.find(x => x.name.toLowerCase() === token.toLowerCase());
        if (w) steps.push({ type: 'word', wordId: w.id });
        else unknown.push(token);
      }
    }
    return { steps, unknown };
  }
  const stepsToText = phrase => phrase.steps.map(s => (s.type === 'rest' ? '_' : s.type === 'hold' ? '~' : findWord(s.wordId)?.name || '?')).join(' ');

  async function testPhrase(phrase) {
    const token = (testPhrase.token = (testPhrase.token || 0) + 1);
    for (const step of phrase.steps) {
      if (token !== testPhrase.token) return;
      if (step.type === 'rest') { await U.sleep(250); continue; }
      if (step.type === 'hold') { await U.sleep(200); continue; }
      const word = findWord(step.wordId);
      if (word) await A.audition(word);
    }
  }

  function reportError(err) {
    console.error(err);
    A.status(err.message, 'error');
  }

  function render() {
    const root = U.$('phrases');
    root.replaceChildren();
    const words = A.allWords();
    if (!words.length) {
      root.append(el('p', { class: 'hint' }, 'Add a clip and its words appear here. Then build the order they should be sung in, like “mr beast mr mr beast”.'));
      return;
    }
    const phrases = A.prj.phrases;
    if (!phrases.some(p => p.id === selected)) selected = phrases[0]?.id ?? null;
    const current = phrases.find(p => p.id === selected);

    root.append(el('p', { class: 'library-title' }, current ? `Click a word to add it to “${current.name}”:` : 'Your words:'));
    root.append(el('div', { class: 'library' },
      words.map(w => chipFor(w, {
        onclick: () => { if (current) addStep(current, { type: 'word', wordId: w.id }); },
        ondragstart: null
      })),
      el('button', { class: 'chip rest', title: 'Add a silent step', onclick: () => { if (current) addStep(current, { type: 'rest' }); } }, el('span', null, 'rest')),
      el('button', { class: 'chip hold', title: 'Add a step that keeps holding the last word’s vowel', onclick: () => { if (current) addStep(current, { type: 'hold' }); } }, el('span', null, 'hold'))
    ));

    for (const phrase of phrases) {
      const box = el('div', { class: `phrase ${phrase.id === selected ? 'selected' : ''}` });
      box.addEventListener('click', e => {
        if (phrase.id !== selected && !e.target.closest('button,input,.chip')) selectPhrase(phrase.id);
      });
      const nameInput = el('input', { type: 'text', value: phrase.name, 'aria-label': 'Phrase name' });
      nameInput.addEventListener('focus', () => { selected = phrase.id; });
      nameInput.addEventListener('change', () => {
        phrase.name = nameInput.value || phrase.name;
        render();
        A.emit('phrases-edited');
      });
      const head = el('div', { class: 'phrase-head' }, nameInput,
        el('button', { class: 'ghost small icon', title: 'Hear this phrase', 'aria-label': 'Hear this phrase', onclick: () => testPhrase(phrase).catch(reportError) }, '▶'),
        el('button', { class: 'ghost small icon', title: 'Duplicate', 'aria-label': 'Duplicate phrase', onclick: () => duplicate(phrase) }, '⧉'),
        el('button', { class: 'ghost small icon', title: 'Delete phrase', 'aria-label': 'Delete phrase', onclick: () => remove(phrase) }, '✕')
      );
      const steps = el('div', { class: `phrase-steps ${phrase.steps.length ? '' : 'empty'}` }, phrase.steps.map((s, i) => stepChip(phrase, s, i)));
      steps.addEventListener('dragover', e => { if (dragState) { e.preventDefault(); steps.classList.add('over'); } });
      steps.addEventListener('dragleave', () => steps.classList.remove('over'));
      steps.addEventListener('drop', e => { if (dragState) { e.preventDefault(); moveStep(phrase, phrase.steps.length); } });
      box.append(head, steps);

      if (phrase.id === selected) {
        const input = el('input', { type: 'text', value: stepsToText(phrase), placeholder: 'mr beast mr mr beast', 'aria-label': 'Type the word order', title: 'Type word names. _ is a rest, ~ holds the last vowel.' });
        const error = el('div', { class: 'phrase-error', hidden: true });
        const apply = () => {
          const { steps: parsed, unknown } = parseText(input.value);
          error.hidden = !unknown.length;
          error.textContent = unknown.length ? `No word called: ${unknown.join(', ')}` : '';
          if (unknown.length) return;
          phrase.steps = parsed;
          edited(phrase);
        };
        input.addEventListener('keydown', e => { if (e.key === 'Enter') apply(); });
        box.append(el('div', { class: 'phrase-text' }, input, el('button', { class: 'ghost small', onclick: apply }, 'Set')), error);
      }
      root.append(box);
    }
    root.append(el('button', { class: 'ghost small', onclick: () => { selectPhrase(A.addPhrase().id); } }, '＋ New phrase'));
  }

  function duplicate(phrase) {
    const copy = A.addPhrase(`${phrase.name} copy`);
    copy.steps = phrase.steps.map(s => ({ ...s }));
    selectPhrase(copy.id);
    A.emit('phrases-edited');
  }

  function remove(phrase) {
    A.prj.phrases = A.prj.phrases.filter(p => p !== phrase);
    for (const cfg of A.prj.tracks) if (cfg.source === phrase.id) cfg.source = '';
    A.autoAssign();
    A.recompile();
    render();
    A.emit('phrases-edited');
  }

  YT.phrasesUI = { render, select: selectPhrase, parseText };
})(window.YT);
